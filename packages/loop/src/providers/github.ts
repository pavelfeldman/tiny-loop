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

export class Github implements types.Provider {
  readonly name: string = 'github';
  private _apiKey: string | undefined;

  private async _bearer(): Promise<string> {
    if (!this._apiKey)
      this._apiKey = await getCopilotToken();
    return this._apiKey;
  }

  async complete(conversation: types.Conversation, options: types.CompletionOptions) {
    // Convert generic messages to OpenAI format
    const systemMessage: openai.OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
      role: 'system',
      content: systemPrompt(conversation.systemPrompt)
    };
    const openaiMessages = [systemMessage, ...conversation.messages.map(toCopilotMessages).flat()];
    const openaiTools = conversation.tools.map(t => toCopilotTool(t));

    const bearer = await this._bearer();
    let response: openai.OpenAI.Chat.Completions.ChatCompletion | undefined;

    // Github provider is unreliable, retry up to 3 times.
    for (let i = 0; i < 3; ++i) {
      response = await create({
        model: options.model,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        messages: openaiMessages,
        tools: openaiTools,
        tool_choice: conversation.tools.length > 0 ? 'auto' : undefined,
        reasoning_effort: options.reasoning ? 'medium' : undefined,
        parallel_tool_calls: false,
      }, bearer, options);
      if (response.choices.length)
        break;
    }

    if (!response || !response.choices.length)
      throw new Error('Failed to get response from GitHub Copilot');

    const result: types.AssistantMessage = { role: 'assistant', content: [] };
    for (const choice of response.choices) {
      const message = choice.message;
      if (message.content)
        result.content.push({ type: 'text', text: message.content });
      for (const entry of message.tool_calls || []) {
        if (entry.type !== 'function')
          continue;
        const { toolCall, intent } = toToolCall(entry);
        if (intent)
          result.content.push({ type: 'text', text: intent, copilotToolCallId: toolCall.id });
        result.content.push(toolCall);
      }
    }

    const usage: types.Usage = {
      input: response.usage?.prompt_tokens ?? 0,
      output: response.usage?.completion_tokens ?? 0,
    };
    return { result, usage };
  }
}

async function create(createParams: openai.OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, bearer: string, options: types.CompletionOptions): Promise<openai.OpenAI.Chat.Completions.ChatCompletion> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${bearer}`,
    ...kEditorHeaders,
  };

  const debugBody = { ...createParams, tools: `${createParams.tools?.length ?? 0} tools` };
  options.debug?.('lowire:github')('Request:', JSON.stringify(debugBody, null, 2));

  const response = await fetch(`https://api.githubcopilot.com/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(createParams),
  });

  if (!response.ok) {
    options.debug?.('lowire:github')('Response:', response.status);
    throw new Error(`API error: ${response.status} ${response.statusText} ${await response.text()}`);
  }

  const responseBody = await response.json() as openai.OpenAI.Chat.Completions.ChatCompletion;
  options.debug?.('lowire:github')('Response:', JSON.stringify(responseBody, null, 2));
  return responseBody;
}

function toCopilotResultContentPart(part: types.ResultPart): openai.OpenAI.Chat.Completions.ChatCompletionContentPart {
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

function toCopilotMessages(message: types.Message): openai.OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (message.role === 'user') {
    return [{
      role: 'user',
      content: message.content
    }];
  }

  if (message.role === 'assistant') {
    const assistantMessage: openai.OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
      role: 'assistant'
    };

    const toolIntents = new Map<string, string>();
    for (const part of message.content) {
      if (part.type === 'text' && part.copilotToolCallId)
        toolIntents.set(part.copilotToolCallId, part.text);
    }

    const textParts = message.content.filter(part => part.type === 'text' && !part.copilotToolCallId) as types.TextContentPart[];
    const toolCallParts = message.content.filter(part => part.type === 'tool_call');
    if (textParts.length === 1)
      assistantMessage.content = textParts[0].text;
    else
      assistantMessage.content = textParts;

    const toolCalls: openai.OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
    const toolResultMessages: openai.OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    for (const toolCall of toolCallParts) {
      const args = { ...toolCall.arguments };
      if (toolIntents.has(toolCall.id))
        args['_intent'] = toolIntents.get(toolCall.id);
      toolCalls.push({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(args)
        }
      });
      if (toolCall.result) {
        toolResultMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolCall.result.content.map(toCopilotResultContentPart) as openai.OpenAI.Chat.Completions.ChatCompletionContentPartText[],
        });
      }
    }

    if (toolCalls.length > 0)
      assistantMessage.tool_calls = toolCalls;

    if (message.toolError) {
      toolResultMessages.push({
        role: 'user',
        content: [{
          type: 'text',
          text: message.toolError,
        }]
      });
    }

    return [assistantMessage, ...toolResultMessages];
  }

  throw new Error(`Unsupported message role: ${(message as any).role}`);
}

// Copilot endpoint does not reply with content+tool_call, it instead
// replies with the content and expects continuation. I.e. instead of navigating
// to a page it will reply with "Navigating to <url>" w/o tool call. Mitigate it
// via injecting a tool call intent and then converting it into the assistant
// message content.

function toCopilotTool(tool: types.Tool): openai.OpenAI.Chat.Completions.ChatCompletionTool {
  const parameters = { ...tool.inputSchema };
  parameters.properties = {
    _intent: { type: 'string', description: 'Describe the intent of this tool call' },
    ...parameters.properties || {},
  };

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
    },
  };
}

function toToolCall(entry: openai.OpenAI.Chat.Completions.ChatCompletionMessageToolCall): { toolCall: types.ToolCallContentPart, intent?: string } {
  const toolCall: types.ToolCallContentPart = {
    type: 'tool_call',
    name: entry.type === 'function' ? entry.function.name : entry.custom.name,
    arguments: JSON.parse(entry.type === 'function' ? entry.function.arguments : entry.custom.input),
    id: entry.id,
  };
  const intent = toolCall.arguments['_intent'];
  delete toolCall.arguments['_intent'];
  return { toolCall, intent };
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

type CopilotTokenResponse = {
  token: string;
};

export const kEditorHeaders = {
  'Editor-Version': 'vscode/1.96.0',
  'Editor-Plugin-Version': 'copilot-chat/0.24.0',
  'User-Agent': 'GitHubCopilotChat/0.24.0',
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'Copilot-Vision-Request': 'true',
};

async function getCopilotToken(): Promise<string> {
  const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
    method: 'GET',
    headers: { 'Authorization': `token ${process.env.COPILOT_API_KEY}`, ...kEditorHeaders }
  });
  const data = await response.json() as CopilotTokenResponse;
  if (data.token)
    return data.token;
  throw new Error('Failed to get Copilot token');
}
