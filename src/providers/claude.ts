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
import type * as types from '../types';

export class Claude implements types.Provider {
  readonly name = 'claude';
  readonly systemPrompt = systemPrompt;

  async complete(conversation: types.Conversation, options: types.CompletionOptions) {
    const response = await create({
      model: options.model,
      max_tokens: options.maxTokens ?? 32768,
      messages: conversation.messages.map(toClaudeMessagePart),
      tools: conversation.tools.map(toClaudeTool),
      thinking: options.reasoning ? {
        type: 'enabled',
        budget_tokens: options.maxTokens ? Math.round(options.maxTokens / 10) : 1024,
      } : undefined,
    });
    const result = toAssistantMessage(response);
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

function toContentPart(block: Anthropic.Messages.ContentBlock): types.TextContentPart | types.ToolCallPart | types.ThinkingContentPart | null {
  if (block.type === 'text') {
    return {
      type: 'text',
      text: block.text,
    };
  }

  if (block.type === 'tool_use') {
    return {
      type: 'tool_call',
      name: block.name,
      arguments: block.input as any,
      id: block.id,
    };
  }

  if (block.type === 'thinking') {
    return {
      type: 'thinking',
      thinking: block.thinking,
      signature: block.signature,
    };
  }

  return null;
}

function toClaudeResultParam(part: types.ResultContentPart): Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam {
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

function toAssistantMessage(message: Anthropic.Messages.Message): types.AssistantMessage {
  return {
    role: 'assistant',
    content: message.content.map(toContentPart).filter(Boolean) as types.AssistantMessage['content'],
  };
}

function toClaudeTool(tool: types.Tool): Anthropic.Messages.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function toClaudeAssistantMessageParam(message: types.AssistantMessage): Anthropic.Messages.MessageParam {
  const content: Anthropic.Messages.ContentBlock[] = [];

  for (const part of message.content) {
    if (part.type === 'text') {
      content.push({ ...part, citations: [] });
      continue;
    }

    if (part.type === 'tool_call') {
      content.push({
        type: 'tool_use',
        id: part.id,
        name: part.name,
        input: part.arguments
      });
      continue;
    }

    if (part.type === 'thinking') {
      content.push({
        type: 'thinking',
        thinking: part.thinking,
        signature: part.signature,
      });
      continue;
    }
  }

  return {
    role: 'assistant',
    content
  };
}

function toClaudeToolResultMessage(message: types.ToolResultMessage): Anthropic.Messages.MessageParam {
  const toolResult: Anthropic.Messages.ToolResultBlockParam = {
    type: 'tool_result',
    tool_use_id: message.toolCallId,
    content: message.result.content.map(toClaudeResultParam),
    is_error: message.result.isError,
  };

  return {
    role: 'user',
    content: [toolResult]
  };
}

function toClaudeMessagePart(message: types.Message): Anthropic.Messages.MessageParam {
  if (message.role === 'user' || message.role === 'system') {
    return {
      role: 'user',
      content: message.content
    };
  }

  if (message.role === 'assistant')
    return toClaudeAssistantMessageParam(message);

  if (message.role === 'tool_result')
    return toClaudeToolResultMessage(message);

  throw new Error(`Unsupported message role: ${(message as any).role}`);
}

const systemPrompt = `
- Make sure every message contains a tool call.
- When you use a tool, you may provide a brief thought or explanation in the content field
  immediately before the tool_call. Do not split this into separate messages.
- Every reply must include a tool call.
`;
