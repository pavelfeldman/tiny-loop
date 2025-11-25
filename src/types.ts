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

export type ToolCallPart = {
  type: 'tool_call';
  name: string;
  arguments: any;
  id: string;
  geminiThoughtSignature?: string;
  openaiId?: string;
  openaiStatus?: 'completed' | 'incomplete' | 'in_progress';
};

export type ToolCallback = (params: {
  name: string;
  arguments: any;
}) => Promise<ToolResult>;

export type Usage = {
  input: number;
  output: number;
};

export type BaseMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool_result';
};

export type SystemMessage = BaseMessage & {
  role: 'system';
  content: string;
};

export type UserMessage = BaseMessage & {
  role: 'user';
  content: string;
};

export type AssistantMessage = BaseMessage & {
  role: 'assistant';
  content: (TextContentPart | ToolCallPart | ThinkingContentPart)[];
  openaiId?: string;
  openaiStatus?: 'completed' | 'incomplete' | 'in_progress';
};

export type TextContentPart = {
  type: 'text';
  text: string;
  geminiThoughtSignature?: string;
};

export type ImageContentPart = {
  type: 'image';
  data: string;
  mimeType: string;
};

export type ThinkingContentPart = {
  type: 'thinking';
  thinking: string;
  signature: string;
};

export type ResultContentPart = TextContentPart | ImageContentPart;

export type ToolResult = {
  content: ResultContentPart[];
  isError?: boolean;
};

export type ToolResultMessage = BaseMessage & {
  role: 'tool_result';
  toolName: string;
  toolCallId: string;
  result: ToolResult;
};

export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;

export type Conversation = {
  messages: Message[];
  tools: Tool[];
};

export interface Model {
  readonly usage: Usage;
  complete(conversation: Conversation): Promise<AssistantMessage>;
}

export type CompletionOptions = {
  model: string;
  maxTokens?: number;
  reasoning?: boolean;
};

export type Logger = (category: string, text: string, details?: string) => void;

export type ReplayCache = Record<string, { result: AssistantMessage, usage: Usage }>;
export type ReplayCaches = {
  before: ReplayCache;
  after: ReplayCache;
};

export type CacheOptions = {
  caches?: ReplayCaches;
  secrets?: Record<string, string>;
};

export type RunLoopOptions = Omit<CompletionOptions, 'model'> & {
  tools?: Tool[];
  callTool?: ToolCallback;
  maxTurns?: number;
  resultSchema?: Schema;
};

export interface Provider {
  name: string;
  systemPrompt: string;
  complete(conversation: Conversation, options: CompletionOptions): Promise<{ result: AssistantMessage, usage: Usage }>;
}
