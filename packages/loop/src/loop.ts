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
  cache?: {
    messages: types.ReplayCache;
    secrets: Record<string, string>;
  };
  summarize?: boolean;
  onBeforeTurn?: (params: { turn: number, conversation: types.Conversation, sizes: Sizes, totalUsage: types.Usage }) => Promise<'stop' | undefined | void>;
};

export class Loop {
  private _provider: types.Provider;
  private _loopOptions: LoopOptions;
  private _cacheOutput: types.ReplayCache = {};
  private _history: { category: string, content: string }[] = [];
  private _state: Record<string, string> = {};

  constructor(loopName: 'openai' | 'github' | 'anthropic' | 'google', options: LoopOptions) {
    this._provider = getProvider(loopName);
    this._loopOptions = options;
  }

  async run<T>(task: string, runOptions: Omit<LoopOptions, 'model'> & { model?: string } = {}): Promise<T | undefined> {
    const options: LoopOptions = { ...this._loopOptions, ...runOptions };
    const allTools: types.Tool[] = [...options.tools || []];
    allTools.push({
      name: 'report_result',
      description: 'Report the result of the task.',
      inputSchema: options.resultSchema ?? defaultResultSchema,
    });

    this._history = [];
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
      const status = await options.onBeforeTurn?.({ turn, conversation, sizes: this._sizes(conversation), totalUsage });
      if (status === 'stop')
        return undefined;

      const caches = options.cache ? {
        input: options.cache.messages,
        output: this._cacheOutput,
        secrets: options.cache.secrets
      } : undefined;

      debug?.('lowire:loop')(`Request`, JSON.stringify({ ...conversation, tools: `${conversation.tools.length} tools` }, null, 2));
      const { result: assistantMessage, usage } = await cachedComplete(this._provider, conversation, caches, options);
      const text = assistantMessage.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
      debug?.('lowire:loop')('Usage', `input: ${usage.input}, output: ${usage.output}`);
      debug?.('lowire:loop')('Assistant', text, JSON.stringify(assistantMessage.content, null, 2));

      totalUsage.input += usage.input;
      totalUsage.output += usage.output;
      conversation.messages.push(assistantMessage);
      this._history.push({ category: '', content: `\n### Turn ${turn + 1}` });
      this._history.push({ category: 'assistant', content: text });

      const toolCalls = assistantMessage.content.filter(part => part.type === 'tool_call') as types.ToolCallContentPart[];
      if (toolCalls.length === 0) {
        const errorText = 'Tool call expected. Call the "report_result" tool when the task is complete.';
        this._history.push({ category: 'error', content: errorText });
        conversation.messages.push({
          role: 'user',
          content: errorText,
        });
        continue;
      }

      for (const toolCall of toolCalls)
        this._history.push({ category: 'tool_call', content: `${toolCall.name}(${JSON.stringify(toolCall.arguments)})` });

      const toolResults: Array<{ toolName: string; toolCallId: string; callArgs: Record<string, any>; result: types.ToolResult }> = [];
      for (const toolCall of toolCalls) {
        const { name, arguments: args, id } = toolCall;

        debug?.('lowire:loop')('Call tool', name, JSON.stringify(args, null, 2));
        if (name === 'report_result')
          return args;

        try {
          const result = await options.callTool!({
            name,
            arguments: args,
          });
          const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
          debug?.('lowire:loop')('Tool result', text, JSON.stringify(result, null, 2));

          this._history.push(...(result._meta?.['dev.lowire/history'] ?? []));
          for (const [name, state] of Object.entries(result._meta?.['dev.lowire/state'] || {}))
            this._state[name] = state;

          toolResults.push({
            toolName: name,
            callArgs: args,
            toolCallId: id,
            result,
          });
        } catch (error) {
          const errorMessage = `Error while executing tool "${name}": ${error instanceof Error ? error.message : String(error)}\n\nPlease try to recover and complete the task.`;
          debug?.('lowire:loop')('Tool error', errorMessage, String(error));
          this._history.push({ category: 'error', content: errorMessage });

          toolResults.push({
            toolName: name,
            callArgs: args,
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
              callArgs: args,
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
          toolName: toolResult.toolName,
          toolCallId: toolResult.toolCallId,
          result: toolResult.result,
        });
      }

      if (options.summarize) {
        const prompt = this._prompt(task);
        // eslint-disable-next-line no-console
        console.log(prompt);
        conversation.messages = [
          { role: 'user', content: prompt },
        ];
      }
    }

    if (options.summarize)
      return this._prompt(task) as unknown as T;
    throw new Error('Failed to perform step, max attempts reached');
  }

  private _prompt(task: string) {
    return `
## Task
${task}

## History
${this._history.map(entry => {
    const prefix = entry.category ? `[${entry.category}] ` : '';
    return `${prefix} ${entry.content}`;
  }).join('\n')}

${Object.entries(this._state).map(([key, value]) => `## ${key}\n${value}`).join('\n\n\n')}
`;
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
