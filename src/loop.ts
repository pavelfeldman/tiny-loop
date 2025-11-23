/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { getProvider } from './providers/registry';
import { CachingProvider } from './cache';
import { prune } from './prune';

import type * as types from './types';

export type RunLoopOptions = {
  tools?: types.Tool[];
  callTool?: types.ToolCallback;
  maxTurns?: number;
  resultSchema?: types.Schema;
  logger?: types.Logger;
};

export class Loop {
  private _provider: types.Provider;
  private _caches: types.ReplayCaches | undefined;

  constructor(loopName: 'openai' | 'copilot' | 'claude', options?: { caches?: types.ReplayCaches }) {
    this._provider = getProvider(loopName);
    this._caches = options?.caches;
  }

  async run<T>(task: string, options: RunLoopOptions = {}): Promise<T> {
    const provider = this._caches ? new CachingProvider(this._provider, this._caches) : this._provider;
    return runLoop<T>(provider, task, options);
  }
}

async function runLoop<T>(provider: types.Provider, task: string, options: RunLoopOptions): Promise<T> {
  const allTools: types.Tool[] = [
    ...(options.tools?.map(decorateWithIntent) ?? []),
    {
      name: 'report_result',
      description: 'Report the result of the task.',
      inputSchema: options.resultSchema ?? defaultResultSchema,
    },
  ];

  const conversation: types.Conversation = {
    messages: [{
      role: 'system',
      content: systemPrompt,
    }, {
      role: 'user',
      content: task,
    }],
    tools: allTools,
  };

  const log = options.logger || (() => {});
  log('loop:loop', `Starting ${provider.name} loop`, task);
  const maxTurns = options.maxTurns || 100;
  for (let iteration = 0; iteration < maxTurns; ++iteration) {
    log('loop:turn', `${iteration + 1} of (max ${maxTurns})`);
    const { result: assistantMessage, usage } = await provider.complete(conversation);

    prune(conversation);

    conversation.messages.push(assistantMessage);
    const { content, toolCalls } = assistantMessage;

    log('loop:usage', `input: ${usage.input}, output: ${usage.output}`);
    log('loop:assistant', content, JSON.stringify(toolCalls, null, 2));

    if (toolCalls.length === 0) {
      conversation.messages.push({
        role: 'user',
        content: `Tool call expected. Call the "report_result" tool when the task is complete.`,
      });
      continue;
    }

    const toolResults: Array<{ toolCallId: string; result: types.ToolResult }> = [];
    for (const toolCall of toolCalls) {
      const { name, arguments: args, id } = toolCall;

      log('loop:call-tool', name, JSON.stringify(args, null, 2));
      if (name === 'report_result')
        return args;

      try {
        const result = await options.callTool!({
          name,
          arguments: args,
        });

        const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
        log('loop:tool-result', text, JSON.stringify(result, null, 2));

        toolResults.push({
          toolCallId: id,
          result,
        });
      } catch (error) {
        const errorMessage = `Error while executing tool "${name}": ${error instanceof Error ? error.message : String(error)}\n\nPlease try to recover and complete the task.`;
        log('loop:tool-error', errorMessage, String(error));

        toolResults.push({
          toolCallId: id,
          result: {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          }
        });

        // Skip remaining tool calls for this iteration
        for (const remainingToolCall of toolCalls.slice(toolCalls.indexOf(toolCall) + 1)) {
          toolResults.push({
            toolCallId: remainingToolCall.id,
            result: {
              content: [{ type: 'text', text: `This tool call is skipped due to previous error.` }],
              isError: true,
            }
          });
        }
        break;
      }
    }

    for (const toolResult of toolResults) {
      conversation.messages.push({
        role: 'tool',
        ...toolResult,
      });
    }
  }

  throw new Error('Failed to perform step, max attempts reached');
}

const defaultResultSchema: types.Schema = {
  type: 'object',
  properties: {
    result: {
      type: 'string',
    },
  },
  required: ['result'],
};

const decorateWithIntent = (tool: types.Tool): types.Tool => {
  const inputSchema = tool.inputSchema || { type: 'object', properties: {} };
  inputSchema.properties = {
    intent: { type: 'string', description: 'Describe the intent of this tool call' },
    ...inputSchema.properties || {},
  };
  return {
    ...tool,
    inputSchema,
  };
};

const systemPrompt = `
You are an autonomous agent designed to complete tasks by interacting with tools.

### Steps to perform
- Your reply MUST be a tool call and nothing but the tool call.
- NEVER respond with text messages.
- Do NOT describe your plan, do NOT explain what you are doing.
- Provide thoughts in the 'intent property of the tool calls instead.
`;
