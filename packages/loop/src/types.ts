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

export type Schema = {
  type: 'object';
  properties?: unknown | null;
  required?: Array<string> | null;
};

export type Tool = {
  name: string;
  description?: string;
  inputSchema: Schema;
};

export type ToolCallback = (params: {
  name: string;
  arguments: any;
}) => Promise<ToolResult>;

// Messages

export type BaseMessage = {
  role: 'user' | 'assistant' | 'tool_result';
};

export type Message =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;

// 1. User message

export type UserMessage = BaseMessage & {
  role: 'user';
  content: string;
};

// 2. Assistant message

export type AssistantMessage = BaseMessage & {
  role: 'assistant';
  content: (TextContentPart | ToolCallContentPart | ThinkingContentPart)[];
  openaiId?: string;
  openaiStatus?: 'completed' | 'incomplete' | 'in_progress';
};

export type TextContentPart = {
  type: 'text';
  text: string;
  googleThoughtSignature?: string;
  copilotToolCallId?: string;
};

export type ThinkingContentPart = {
  type: 'thinking';
  thinking: string;
  signature: string;
};

export type ToolCallContentPart = {
  type: 'tool_call';
  name: string;
  arguments: any;
  id: string;
  googleThoughtSignature?: string;
  openaiId?: string;
  openaiStatus?: 'completed' | 'incomplete' | 'in_progress';
};

// 3. Tool result message

export type ToolResultMessage = BaseMessage & {
  role: 'tool_result';
  toolName: string;
  toolCallId: string;
  result: ToolResult;
};

export type TextResultPart = {
  type: 'text';
  text: string;
};

export type ImageResultPart = {
  type: 'image';
  data: string;
  mimeType: string;
};

export type ResultPart = TextResultPart | ImageResultPart;

export type ToolResult = {
  content: ResultPart[];
  isError?: boolean;
};

// Conversation and Completion

export type Conversation = {
  systemPrompt: string;
  messages: Message[];
  tools: Tool[];
};

type Debug = (category: string) => (...args: any[]) => void;

export type CompletionOptions = {
  model: string;
  maxTokens?: number;
  reasoning?: boolean;
  temperature?: number;
  debug?: Debug;
};

export interface Provider {
  name: string;
  complete(conversation: Conversation, options: CompletionOptions): Promise<{ result: AssistantMessage, usage: Usage }>;
}

export type Usage = {
  input: number;
  output: number;
};

export type ReplayCache = Record<string, { result: AssistantMessage, usage: Usage }>;
