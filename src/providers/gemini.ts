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

import type * as gemini from '@google/generative-ai';
import type * as types from '../types';

const model = 'gemini-2.5-pro';

type GeminiThinkingPart = gemini.Part & { thoughtSignature?: string };

export class Gemini implements types.Provider {
  readonly name = 'gemini';
  readonly systemPrompt = systemPrompt;

  async complete(conversation: types.Conversation) {
    const contents = conversation.messages.map(toGeminiContent).flat();
    const response = await create({
      contents,
      tools: conversation.tools.length > 0 ? [{ functionDeclarations: conversation.tools.map(toGeminiTool) }] : undefined,
    });

    const [candidate] = response.candidates ?? [];
    if (!candidate)
      throw new Error('No candidates in response');

    const usage: types.Usage = {
      input: response.usageMetadata?.promptTokenCount ?? 0,
      output: response.usageMetadata?.candidatesTokenCount ?? 0,
    };

    const result = toAssistantMessage(candidate);
    return { result, usage };
  }
}

async function create(body: gemini.GenerateContentRequest): Promise<gemini.GenerateContentResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    throw new Error('GEMINI_API_KEY environment variable is required');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body)
  });

  if (!response.ok)
    throw new Error(`API error: ${response.status} ${response.statusText} ${await response.text()}`);

  return await response.json() as gemini.GenerateContentResponse;
}

function toGeminiTool(tool: types.Tool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: stripUnsupportedSchemaFields(tool.inputSchema) as any,
  };
}

function stripUnsupportedSchemaFields(schema: any): any {
  if (!schema || typeof schema !== 'object')
    return schema;

  const cleaned: any = Array.isArray(schema) ? [...schema] : { ...schema };
  delete cleaned.additionalProperties;
  for (const key in cleaned) {
    if (cleaned[key] && typeof cleaned[key] === 'object')
      cleaned[key] = stripUnsupportedSchemaFields(cleaned[key]);
  }
  return cleaned;
}

function toAssistantMessage(candidate: gemini.GenerateContentCandidate): types.AssistantMessage {
  return {
    role: 'assistant',
    content: candidate.content.parts.map(toContentPart).filter(Boolean) as (types.TextContentPart | types.ToolCallPart)[],
  };
}

function toContentPart(part: gemini.Part & { thoughtSignature?: string }): types.TextContentPart | types.ToolCallPart | null {
  if (part.text) {
    return {
      type: 'text',
      text: part.text,
      thoughtSignature: part.thoughtSignature,
    };
  }

  if (part.functionCall) {
    return {
      type: 'tool_call',
      name: part.functionCall.name,
      arguments: part.functionCall.args,
      id: `call_${Math.random().toString(36).substring(2, 15)}`,
      thoughtSignature: part.thoughtSignature,
    };
  }

  return null;
}

function toGeminiContent(message: types.Message): gemini.Content[] {
  if (message.role === 'user' || message.role === 'system') {
    return [{
      role: 'user',
      parts: [{ text: message.content }]
    }];
  }

  if (message.role === 'assistant') {
    const parts: GeminiThinkingPart[] = [];

    for (const part of message.content) {
      if (part.type === 'text') {
        parts.push({
          text: part.text,
          thoughtSignature: part.thoughtSignature,
        });
        continue;
      }
      parts.push({
        functionCall: {
          name: part.name,
          args: part.arguments
        },
        thoughtSignature: part.thoughtSignature,
      });
    }

    return [{
      role: 'model',
      parts
    }];
  }

  if (message.role === 'tool_result') {
    const responseContent: any = {};
    const textParts: string[] = [];
    const inlineDatas: any[] = [];

    for (const part of message.result.content) {
      if (part.type === 'text') {
        textParts.push(part.text);
      } else if (part.type === 'image') {
        // Store image data for inclusion in response
        inlineDatas.push({
          inline_data: {
            mime_type: part.mimeType,
            data: part.data
          }
        });
      }
    }

    if (textParts.length > 0)
      responseContent.result = textParts.join('\n');

    const result = [{
      role: 'function',
      parts: [{
        functionResponse: {
          name: message.toolName,
          response: responseContent
        }
      }]
    }];

    if (inlineDatas.length > 0) {
      result.push({
        role: 'user',
        parts: inlineDatas
      });
    }

    return result;
  }

  throw new Error(`Unsupported message role: ${(message as any).role}`);
}

const systemPrompt = `
- Make sure every message contains a tool call.
- When you use a tool, you may provide a brief thought or explanation in the content field
  immediately before the tool_call. Do not split this into separate messages.
- Every reply must include a tool call.
`;
