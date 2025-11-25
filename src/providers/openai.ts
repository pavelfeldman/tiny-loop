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

import type * as openai from 'openai';
import type * as types from '../types';

export class OpenAI implements types.Provider {
  readonly name: string = 'openai';
  readonly systemPrompt: string = systemPrompt;

  async complete(conversation: types.Conversation, options: types.CompletionOptions) {
    const systemMessages = conversation.messages.filter(m => m.role === 'system');
    const nonSystemMessages = conversation.messages.filter(m => m.role !== 'system');

    const inputItems: openai.OpenAI.Responses.ResponseInputItem[] = [];
    for (const message of nonSystemMessages) {
      const items = toResponseInputItems(message);
      inputItems.push(...items);
    }

    const tools = conversation.tools.map(toOpenAIFunctionTool);

    // Combine system messages into instructions
    const instructions = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n\n')
      : undefined;

    const response = await create({
      model: options.model,
      input: inputItems,
      instructions,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: conversation.tools.length > 0 ? 'auto' : undefined,
      parallel_tool_calls: false,
    });

    // Parse response output items
    const result: types.AssistantMessage = { role: 'assistant', content: [] };

    for (const item of response.output) {
      if (item.type === 'message' && item.role === 'assistant') {
        result.openaiId = item.id;
        result.openaiStatus = item.status;
        for (const contentPart of item.content) {
          if (contentPart.type === 'output_text') {
            result.content.push({
              type: 'text',
              text: contentPart.text,
            });
          }
        }
      } else if (item.type === 'function_call') {
        // Add tool call
        result.content.push(toToolCall(item));
      }
    }

    const usage: types.Usage = {
      input: response.usage?.input_tokens ?? 0,
      output: response.usage?.output_tokens ?? 0,
    };
    return { result, usage };
  }
}

async function create(body: openai.OpenAI.Responses.ResponseCreateParamsNonStreaming): Promise<openai.OpenAI.Responses.Response> {
  const apiKey = process.env.OPENAI_API_KEY!;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'Copilot-Vision-Request': 'true',
  };

  const response = await fetch(`https://api.openai.com/v1/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok)
    throw new Error(`API error: ${response.status} ${response.statusText} ${await response.text()}`);

  return await response.json() as openai.OpenAI.Responses.Response;
}

function toResultContentPart(part: types.ResultContentPart): openai.OpenAI.Responses.ResponseInputText | openai.OpenAI.Responses.ResponseInputImage {
  if (part.type === 'text') {
    return {
      type: 'input_text',
      text: part.text,
    };
  }
  if (part.type === 'image') {
    return {
      type: 'input_image',
      image_url: `data:${part.mimeType};base64,${part.data}`,
      detail: 'auto',
    };
  }
  throw new Error(`Cannot convert content part of type ${(part as any).type} to response content part`);
}

function toResponseInputItems(message: types.Message): openai.OpenAI.Responses.ResponseInputItem[] {
  if (message.role === 'user') {
    return [{
      type: 'message',
      role: 'user',
      content: message.content
    }];
  }

  if (message.role === 'assistant') {
    const textParts = message.content.filter(part => part.type === 'text');
    const toolCallParts = message.content.filter(part => part.type === 'tool_call');

    const items: openai.OpenAI.Responses.ResponseInputItem[] = [];

    // Add assistant message with text content
    if (textParts.length > 0) {
      const outputMessage: openai.OpenAI.Responses.ResponseOutputMessage = {
        id: message.openaiId!,
        status: message.openaiStatus!,
        type: 'message',
        role: 'assistant',
        content: textParts.map(part => ({
          type: 'output_text',
          text: part.text,
          annotations: [],
          logprobs: []
        }))
      };
      items.push(outputMessage);
    }

    items.push(...toolCallParts.map(toFunctionToolCall));
    return items;
  }

  if (message.role === 'tool_result') {
    return [{
      type: 'function_call_output',
      call_id: message.toolCallId,
      output: message.result.content.map(toResultContentPart),
    } as openai.OpenAI.Responses.ResponseInputItem.FunctionCallOutput];
  }

  throw new Error(`Unsupported message role: ${(message as any).role}`);
}

function toOpenAIFunctionTool(tool: types.Tool): openai.OpenAI.Responses.FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description ?? null,
    parameters: tool.inputSchema,
    strict: null,
  };
}

function toFunctionToolCall(toolCall: types.ToolCallPart): openai.OpenAI.Responses.ResponseFunctionToolCall {
  return {
    type: 'function_call',
    call_id: toolCall.id,
    name: toolCall.name,
    arguments: JSON.stringify(toolCall.arguments),
    id: toolCall.openaiId!,
    status: toolCall.openaiStatus!,
  };
}

function toToolCall(functionCall: openai.OpenAI.Responses.ResponseFunctionToolCall): types.ToolCallPart {
  return {
    type: 'tool_call',
    name: functionCall.name,
    arguments: JSON.parse(functionCall.arguments),
    id: functionCall.call_id,
    openaiId: functionCall.id,
    openaiStatus: functionCall.status,
  };
}

const systemPrompt = `
- Make sure every message contains a tool call.
- When you use a tool, you may provide a brief thought or explanation in the content field
  immediately before the tool_call. Do not split this into separate messages.
- Every reply must include a tool call.
`;
