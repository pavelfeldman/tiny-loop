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

import type Anthropic from '@anthropic-ai/sdk';
import type { Provider } from '../types';
import type * as types from '../types';

const model = 'claude-sonnet-4-5';

export class Claude implements Provider {
  readonly name = 'claude';
  readonly systemPrompt = systemPrompt;

  async complete(conversation: types.Conversation) {
    const response = await create({
      model,
      max_tokens: 10000,
      messages: toClaudeMessages(conversation.messages),
      tools: conversation.tools.map(toClaudeTool),
    });

    const textContent = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
    const toolCalls = response.content.filter(block => block.type === 'tool_use').map(toToolCall);
    const result: types.AssistantMessage = {
      role: 'assistant',
      content: textContent,
      toolCalls,
    };
    const usage: types.Usage = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    };
    return { result, usage };
  }
}

async function create(body: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY!,
    'anthropic-version': '2023-06-01',
  };

  const response = await fetch(`https://api.anthropic.com/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok)
    throw new Error(`API error: ${response.status} ${response.statusText} ${await response.text()}`);

  return await response.json() as Anthropic.Messages.Message;
}

function toClaudeTool(tool: types.Tool): Anthropic.Messages.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function toToolCall(toolCall: Anthropic.Messages.ToolUseBlock): types.ToolCall {
  return {
    name: toolCall.name,
    arguments: toolCall.input as any,
    id: toolCall.id,
  };
}

function toClaudeContentPart(part: types.ContentPart): Anthropic.Messages.ContentBlockSourceContent {
  if (part.type === 'text') {
    return {
      type: 'text',
      text: part.text,
    };
  }
  if (part.type === 'image') {
    return {
      type: 'image',
      source: {
        type: 'base64',
        data: part.data,
        media_type: part.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
      },
    };
  }
  throw new Error(`Unsupported content part type: ${(part as any).type}`);
}

function toClaudeMessages(messages: types.Message[]): Anthropic.Messages.MessageParam[] {
  const claudeMessages: Anthropic.Messages.MessageParam[] = [];

  for (const message of messages) {
    if (message.role === 'user' || message.role === 'system') {
      claudeMessages.push({
        role: 'user',
        content: message.content
      });
      continue;
    }

    if (message.role === 'assistant') {
      const content: Anthropic.Messages.ContentBlock[] = [];

      // Add text content
      if (message.content) {
        content.push({
          type: 'text',
          text: message.content,
          citations: []
        });
      }

      // Add tool calls
      if (message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.arguments
          });
        }
      }

      claudeMessages.push({
        role: 'assistant',
        content
      });

      continue;
    }

    if (message.role === 'tool') {
      // Tool results are added differently - we need to find if there's already a user message with tool results
      const lastMessage = claudeMessages[claudeMessages.length - 1];
      const toolResult: Anthropic.Messages.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.result.content.map(toClaudeContentPart),
        is_error: message.result.isError,
      };

      if (lastMessage && lastMessage.role === 'user' && Array.isArray(lastMessage.content)) {
        // Add to existing tool results message
        (lastMessage.content as Anthropic.Messages.ToolResultBlockParam[]).push(toolResult);
      } else {
        // Create new tool results message
        claudeMessages.push({
          role: 'user',
          content: [toolResult]
        });
      }

      continue;
    }
  }

  return claudeMessages;
}

const systemPrompt = `
- Make sure every message contains a tool call.
- When you use a tool, you may provide a brief thought or explanation in the content field
  immediately before the tool_call. Do not split this into separate messages.
- Every reply must include a tool call.
`;
