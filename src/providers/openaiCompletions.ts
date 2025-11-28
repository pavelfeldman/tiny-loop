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

export type Endpoint = {
  baseUrl: string;
  apiKey: string,
  headers: Record<string, string>;
};

export class OpenAICompletions implements types.Provider {
  readonly name: string = 'openai';
  private _endpoint: Endpoint | undefined;

  async endpoint(): Promise<Endpoint> {
    if (!this._endpoint)
      this._endpoint = await this.connect();
    return this._endpoint;
  }

  async connect(): Promise<Endpoint> {
    return {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY!,
      headers: {}
    };
  }

  async complete(conversation: types.Conversation, options: types.CompletionOptions & { injectIntent?: boolean }) {
    // Convert generic messages to OpenAI format
    const systemMessage: openai.OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
      role: 'system',
      content: systemPrompt(conversation.systemPrompt)
    };
    const openaiMessages = [systemMessage, ...conversation.messages.map(toOpenAIMessage)];
    const openaiTools = conversation.tools.map(t => toOpenAITool(t, options));

    const endpoint = await this.endpoint();
    const response = await create({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: conversation.tools.length > 0 ? 'auto' : undefined,
      reasoning_effort: options.reasoning ? 'medium' : undefined,
    }, endpoint);

    const result: types.AssistantMessage = { role: 'assistant', content: [] };
    const message = response.choices[0].message;
    if (message.content)
      result.content.push({ type: 'text', text: message.content });
    result.content.push(...(message.tool_calls || []).map(toToolCall));

    const usage: types.Usage = {
      input: response.usage?.prompt_tokens ?? 0,
      output: response.usage?.completion_tokens ?? 0,
    };
    return { result, usage };
  }
}

async function create(body: openai.OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, endpoint: Endpoint): Promise<openai.OpenAI.Chat.Completions.ChatCompletion> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${endpoint.apiKey}`,
    'Copilot-Vision-Request': 'true',
    ...endpoint.headers
  };

  const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok)
    throw new Error(`API error: ${response.status} ${response.statusText} ${await response.text()}`);

  return await response.json() as openai.OpenAI.Chat.Completions.ChatCompletion;
}

function toOpenAIResultContentPart(part: types.ResultPart): openai.OpenAI.Chat.Completions.ChatCompletionContentPart {
  if (part.type === 'text') {
    return {
      type: 'text',
      text: part.text,
    };
  }
  if (part.type === 'image') {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${part.mimeType};base64,${part.data}`,
      },
    };
  }
  throw new Error(`Cannot convert content part of type ${(part as any).type} to text content part`);
}

function toOpenAIMessage(message: types.Message): openai.OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (message.role === 'user') {
    return {
      role: 'user',
      content: message.content
    };
  }

  if (message.role === 'assistant') {
    const assistantMessage: openai.OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
      role: 'assistant'
    };

    const textParts = message.content.filter(part => part.type === 'text');
    const toolCallParts = message.content.filter(part => part.type === 'tool_call');
    if (textParts.length === 1)
      assistantMessage.content = textParts[0].text;
    else
      assistantMessage.content = textParts;

    const toolCalls: openai.OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
    for (const toolCall of toolCallParts) {
      toolCalls.push({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments)
        }
      });
    }

    if (toolCalls.length > 0)
      assistantMessage.tool_calls = toolCalls;

    return assistantMessage;
  }

  if (message.role === 'tool_result') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.result.content.map(toOpenAIResultContentPart) as openai.OpenAI.Chat.Completions.ChatCompletionContentPartText[],
    };
  }

  throw new Error(`Unsupported message role: ${(message as any).role}`);
}

function toOpenAITool(tool: types.Tool, options: { injectIntent?: boolean }): openai.OpenAI.Chat.Completions.ChatCompletionTool {
  const parameters = { ...tool.inputSchema };
  if (options.injectIntent) {
    parameters.properties = {
      _intent: { type: 'string', description: 'Describe the intent of this tool call' },
      ...parameters.properties || {},
    };
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
    },
  };
}

function toToolCall(toolCall: openai.OpenAI.Chat.Completions.ChatCompletionMessageToolCall): types.ToolCallContentPart {
  return {
    type: 'tool_call',
    name: toolCall.type === 'function' ? toolCall.function.name : toolCall.custom.name,
    arguments: JSON.parse(toolCall.type === 'function' ? toolCall.function.arguments : toolCall.custom.input),
    id: toolCall.id,
  };
}

const systemPrompt = (prompt: string) => `
### System instructions

${prompt}

### Tool calling instructions
- Your reply MUST be a tool call and nothing but the tool call.
- NEVER respond with text content, only tool calls.
- Do NOT describe your plan, do NOT explain what you are doing, do NOT describe what you see, call tools.
- Provide thoughts in the '_intent' property of the tool calls instead.
`;
