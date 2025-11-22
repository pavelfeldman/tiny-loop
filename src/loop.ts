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

import { OpenAI } from './openai';
import { Copilot } from './copilot';
import { Claude } from './claude';

import type { Tool, ImageContent, TextContent, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type * as llm from './llm';

export type Logger = (category: string, text: string, details?: string) => void;

export type RunLoopOptions = {
  tools?: Tool[];
  callTool?: (params: { name: string, arguments: any}) => Promise<CallToolResult>;
  maxTurns?: number;
  resultSchema?: Tool['inputSchema'];
  logger?: Logger;
};

export class Loop {
  private _llm: llm.LLM;

  constructor(loopName: 'openai' | 'copilot' | 'claude' = 'openai') {
    this._llm = getLlm(loopName);
  }

  async run<T>(task: string, options: RunLoopOptions = {}): Promise<T> {
    return runLoop<T>(this._llm, task, options);
  }
}

async function runLoop<T>(llm: llm.LLM, task: string, options: RunLoopOptions = {}): Promise<T> {
  const taskContent = `Perform following task: ${task}. Once the task is complete, call the "report_result" tool.`;
  const allTools: Tool[] = [
    ...(options.tools ?? []),
    {
      name: 'report_result',
      description: 'Report the result of the task.',
      inputSchema: options.resultSchema ?? defaultResultSchema,
    },
  ];

  const conversation: llm.Conversation = {
    messages: [{
      role: 'user',
      content: taskContent,
    }],
    tools: allTools,
  };

  const log = options.logger || (() => {});
  log('loop:loop', 'Starting loop', taskContent);
  const maxTurns = options.maxTurns || 100;
  for (let iteration = 0; iteration < maxTurns; ++iteration) {
    log('loop:turn', `${iteration + 1} of ${maxTurns}`);
    const assistantMessage = await llm.complete(conversation);

    conversation.messages.push(assistantMessage);
    const { content, toolCalls } = assistantMessage;

    log('loop:usage', `input: ${llm.usage.inputTokens}, output: ${llm.usage.outputTokens}`);
    log('loop:assistant', content, JSON.stringify(toolCalls, null, 2));

    if (toolCalls.length === 0) {
      conversation.messages.push({
        role: 'user',
        content: `Tool call expected. Call the "report_result" tool when the task is complete.`,
      });
      continue;
    }

    const toolResults: Array<{ toolCallId: string; content: string; isError?: boolean }> = [];
    for (const toolCall of toolCalls) {
      const { name, arguments: args, id } = toolCall;

      log('loop:call-tool', name, JSON.stringify(args, null, 2));
      if (name === 'report_result')
        return args;

      try {
        const response = await options.callTool!({
          name,
          arguments: args,
        });

        const responseContent = (response.content || []) as (TextContent | ImageContent)[];
        const text = responseContent.filter(part => part.type === 'text').map(part => part.text).join('\n');
        log('loop:tool-result', '', text);

        toolResults.push({
          toolCallId: id,
          content: text,
        });
      } catch (error) {
        const errorMessage = `Error while executing tool "${name}": ${error instanceof Error ? error.message : String(error)}\n\nPlease try to recover and complete the task.`;
        log('loop:tool-error', errorMessage, String(error));

        toolResults.push({
          toolCallId: id,
          content: errorMessage,
          isError: true,
        });

        // Skip remaining tool calls for this iteration
        for (const remainingToolCall of toolCalls.slice(toolCalls.indexOf(toolCall) + 1)) {
          toolResults.push({
            toolCallId: remainingToolCall.id,
            content: `This tool call is skipped due to previous error.`,
            isError: true,
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

function getLlm(loopName: 'openai' | 'copilot' | 'claude'): llm.LLM {
  if (loopName === 'openai')
    return new OpenAI();
  if (loopName === 'copilot')
    return new Copilot();
  if (loopName === 'claude')
    return new Claude();
  throw new Error(`Unknown loop LLM: ${loopName}`);
}

const defaultResultSchema: Tool['inputSchema'] = {
  type: 'object',
  properties: {
    result: {
      type: 'string',
    },
  },
  required: ['result'],
};
