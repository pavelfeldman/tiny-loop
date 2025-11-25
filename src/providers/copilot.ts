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

import { OpenAICompletions } from './openaiCompletions';

import type { Endpoint } from './openaiCompletions';
import type * as types from '../types';

type CopilotTokenResponse = {
  token: string;
};

export const kEditorHeaders = {
  'Editor-Version': 'vscode/1.96.0',
  'Editor-Plugin-Version': 'copilot-chat/0.24.0',
  'User-Agent': 'GitHubCopilotChat/0.24.0',
  'Accept': 'application/json',
  'Content-Type': 'application/json'
};


// Copilot endpoint does not reply with content+tool_call, it instead
// replies with the content and expects continuation. I.e. instead of navigating
// to a page it will reply with "Navigating to <url>" w/o tool call. Mitigate it
// via injecting a tool call intent and then converting it into the assistant
// message content.
export class Copilot extends OpenAICompletions {
  override readonly name = 'copilot';
  override readonly systemPrompt = systemPrompt;
  override async connect(): Promise<Endpoint> {
    return {
      baseUrl: 'https://api.githubcopilot.com',
      apiKey: await getCopilotToken(),
      headers: kEditorHeaders
    };
  }

  override async complete(conversation: types.Conversation, options: types.CompletionOptions) {
    const message = await super.complete(conversation, { ...options, injectIntent: true });
    const textPart = message.result.content.find(part => part.type === 'text');
    if (!textPart) {
      const content: string[] = [];
      const toolCalls = message.result.content.filter(part => part.type === 'tool_call');
      for (const toolCall of toolCalls) {
        content.push(toolCall.arguments?._intent ?? '');
        delete toolCall.arguments._intent;
      }
      const text = content.join(' ').trim();
      if (text.trim())
        message.result.content.unshift({ type: 'text', text: content.join(' ') });
    }
    return message;
  }
}

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

const systemPrompt = `
  - Your reply MUST be a tool call and nothing but the tool call.
  - NEVER respond with text content, only tool calls.
  - Do NOT describe your plan, do NOT explain what you are doing, do NOT describe what you see, call tools.
  - Provide thoughts in the '_intent' property of the tool calls instead.
`;
