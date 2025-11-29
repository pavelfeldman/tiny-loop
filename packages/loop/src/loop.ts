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
import { cachedComplete } from './cache';

import type * as types from './types';

export type Logger = (category: string, text: string, details?: string) => void;

type Sizes = {
  headers: number;
  messages: number;
  toolsResults: number;
};

export type LoopOptions = types.CompletionOptions & {
  tools?: types.Tool[];
  callTool?: types.ToolCallback;
  maxTurns?: number;
  resultSchema?: types.Schema;
  log?: Logger;
  cache?: {
    messages: types.ReplayCache;
    secrets: Record<string, string>;
  };
  onBeforeTurn?: (params: { turn: number, conversation: types.Conversation, sizes: Sizes, totalUsage: types.Usage }) => Promise<'stop' | undefined | void>;
};

export class Loop {
  private _provider: types.Provider;
  private _loopOptions: LoopOptions;
  private _cacheOutput: types.ReplayCache = {};

  constructor(loopName: 'openai' | 'github' | 'anthropic' | 'google', options: LoopOptions) {
    this._provider = getProvider(loopName);
    this._loopOptions = options;
  }

  async run<T>(task: string, runOptions: Omit<LoopOptions, 'model'> & { model?: string } = {}): Promise<T | undefined> {
    const options: LoopOptions = { ...this._loopOptions, ...runOptions };
    const allTools: types.Tool[] = [
      ...(options.tools || []),
      {
        name: 'report_result',
        description: 'Report the result of the task.',
        inputSchema: options.resultSchema ?? defaultResultSchema,
      },
    ];

    const conversation: types.Conversation = {
      systemPrompt,
      messages: [
        { role: 'user', content: task },
      ],
      tools: allTools,
    };

    const log = options.log ?? (() => {});
    const totalUsage: types.Usage = { input: 0, output: 0 };

    log('loop:loop', `Starting ${this._provider.name} loop`, task);
    const maxTurns = options.maxTurns || 100;

    for (let turn = 0; turn < maxTurns; ++turn) {
      log('loop:turn', `${turn + 1} of (max ${maxTurns})`);

      const status = await options.onBeforeTurn?.({ turn, conversation, sizes: this._sizes(conversation), totalUsage });
      if (status === 'stop')
        return undefined;

      const caches = options.cache ? {
        input: options.cache.messages,
        output: this._cacheOutput,
        secrets: options.cache.secrets
      } : undefined;

      const { result: assistantMessage, usage } = await cachedComplete(this._provider, conversation, caches, options);
      totalUsage.input += usage.input;
      totalUsage.output += usage.output;
      conversation.messages.push(assistantMessage);
      const text = assistantMessage.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
      const toolCalls = assistantMessage.content.filter(part => part.type === 'tool_call') as types.ToolCallContentPart[];

      log('loop:usage', `input: ${usage.input}, output: ${usage.output}`);
      log('loop:assistant', text, JSON.stringify(assistantMessage.content, null, 2));

      if (toolCalls.length === 0) {
        conversation.messages.push({
          role: 'user',
          content: `Tool call expected. Call the "report_result" tool when the task is complete.`,
        });
        continue;
      }

      const toolResults: Array<{ toolName: string; toolCallId: string; result: types.ToolResult }> = [];
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
            toolName: name,
            toolCallId: id,
            result,
          });
        } catch (error) {
          const errorMessage = `Error while executing tool "${name}": ${error instanceof Error ? error.message : String(error)}\n\nPlease try to recover and complete the task.`;
          log('loop:tool-error', errorMessage, String(error));

          toolResults.push({
            toolName: name,
            toolCallId: id,
            result: {
              content: [{ type: 'text', text: errorMessage }],
              isError: true,
            }
          });

          // Skip remaining tool calls for this iteration
          for (const remainingToolCall of toolCalls.slice(toolCalls.indexOf(toolCall) + 1)) {
            toolResults.push({
              toolName: remainingToolCall.name,
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
          role: 'tool_result',
          ...toolResult,
        });
      }
    }

    throw new Error('Failed to perform step, max attempts reached');
  }

  private _sizes(conversation: types.Conversation): Sizes {
    const headers = conversation.systemPrompt.length + JSON.stringify(conversation.tools).length;
    const messages = JSON.stringify(conversation.messages).length;
    let toolsResults = 0;
    for (const message of conversation.messages) {
      if (message.role !== 'tool_result')
        continue;
      toolsResults += JSON.stringify(message.result).length;
    }
    return {
      headers,
      messages,
      toolsResults,
    };
  }

  cache(): types.ReplayCache {
    return this._cacheOutput;
  }
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

const systemPrompt = `
You are an autonomous agent designed to complete tasks by interacting with tools. Perform the user task.
`;
