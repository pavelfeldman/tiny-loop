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
import { summarizeConversation } from './summary';

import type * as types from './types';

export type LoopOptions = types.CompletionOptions & {
  tools?: types.Tool[];
  callTool?: types.ToolCallback;
  maxTurns?: number;
  resultSchema?: types.Schema;
  cache?: {
    messages: types.ReplayCache;
    secrets: Record<string, string>;
  };
  summarize?: boolean;
};

export class Loop {
  private _provider: types.Provider;
  private _loopOptions: LoopOptions;
  private _cacheOutput: types.ReplayCache = {};

  constructor(loopName: 'openai' | 'github' | 'anthropic' | 'google', options: LoopOptions) {
    this._provider = getProvider(loopName);
    this._loopOptions = options;
  }

  async run<T>(task: string, runOptions: Omit<LoopOptions, 'model'> & { model?: string } = {}): Promise<T> {
    const options: LoopOptions = { ...this._loopOptions, ...runOptions };
    const allTools: types.Tool[] = [...options.tools || []];
    allTools.push({
      name: 'report_result',
      description: 'Report the result of the task.',
      inputSchema: options.resultSchema ?? defaultResultSchema,
    });

    const conversation: types.Conversation = {
      systemPrompt,
      messages: [
        { role: 'user', content: task },
      ],
      tools: allTools,
    };

    const debug = options.debug;
    const totalUsage: types.Usage = { input: 0, output: 0 };

    debug?.('lowire:loop')(`Starting ${this._provider.name} loop`, task);
    const maxTurns = options.maxTurns || 100;

    for (let turn = 0; turn < maxTurns; ++turn) {
      debug?.('lowire:loop')(`Turn ${turn + 1} of (max ${maxTurns})`);
      const caches = options.cache ? {
        input: options.cache.messages,
        output: this._cacheOutput,
        secrets: options.cache.secrets
      } : undefined;

      const summarizedConversation = options.summarize ? this._summarizeConversation(task, conversation, options) : conversation;
      debug?.('lowire:loop')(`Request`, JSON.stringify({ ...summarizedConversation, tools: `${summarizedConversation.tools.length} tools` }, null, 2));
      const { result: assistantMessage, usage } = await cachedComplete(this._provider, summarizedConversation, caches, options);
      const text = assistantMessage.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
      debug?.('lowire:loop')('Usage', `input: ${usage.input}, output: ${usage.output}`);
      debug?.('lowire:loop')('Assistant', text, JSON.stringify(assistantMessage.content, null, 2));

      totalUsage.input += usage.input;
      totalUsage.output += usage.output;
      conversation.messages.push(assistantMessage);

      const toolCalls = assistantMessage.content.filter(part => part.type === 'tool_call') as types.ToolCallContentPart[];
      if (toolCalls.length === 0) {
        assistantMessage.toolError = 'Error: tool call is expected in every assistant message. Call the "report_result" tool when the task is complete.';
        continue;
      }

      for (const toolCall of toolCalls) {
        const { name, arguments: args } = toolCall;
        debug?.('lowire:loop')('Call tool', name, JSON.stringify(args, null, 2));
        if (name === 'report_result')
          return args;

        try {
          const result = await options.callTool!({
            name,
            arguments: {
              ...args,
              _meta: {
                'dev.lowire/history': true,
                'dev.lowire/state': true,
              }
            }
          });
          const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
          debug?.('lowire:loop')('Tool result', text, JSON.stringify(result, null, 2));

          toolCall.result = result;
        } catch (error) {
          const errorMessage = `Error while executing tool "${name}": ${error instanceof Error ? error.message : String(error)}\n\nPlease try to recover and complete the task.`;
          debug?.('lowire:loop')('Tool error', errorMessage, String(error));

          toolCall.result = {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };

          // Skip remaining tool calls for this iteration
          for (const remainingToolCall of toolCalls.slice(toolCalls.indexOf(toolCall) + 1)) {
            remainingToolCall.result = {
              content: [{ type: 'text', text: `This tool call is skipped due to previous error.` }],
              isError: true,
            };
          }
          break;
        }
      }
    }

    if (options.summarize)
      return this._summarizeConversation(task, conversation, options) as any;
    throw new Error('Failed to perform step, max attempts reached');
  }

  private _summarizeConversation(task: string, conversation: types.Conversation, options: LoopOptions): types.Conversation {
    const { summary, lastMessage } = summarizeConversation(task, conversation, options);
    return {
      ...conversation,
      messages: [
        { role: 'user', content: summary },
        ...lastMessage ? [lastMessage] : [],
      ],
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
