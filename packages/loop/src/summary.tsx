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

import { jsx } from './jsx/jsx-runtime';
import type * as types from './types';

export function summarizeConversation(task: string, conversation: types.Conversation, options: Pick<types.CompletionOptions, 'debug'>): { summary: string, lastMessage: types.AssistantMessage } {
  const summary: string[] = ['## Task', task];
  const combinedState: Record<string, string> = {};

  const assistantMessages: types.AssistantMessage[] = conversation.messages.filter(message => message.role === 'assistant');
  for (let turn = 0; turn < assistantMessages.length - 1; ++turn) {
    if (turn === 0) {
      summary.push('');
      summary.push('## History');
    }
    summary.push(``);

    const text = assistantMessages[turn].content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    const toolCalls = assistantMessages[turn].content.filter(part => part.type === 'tool_call');
    for (const toolCall of toolCalls) {
      if (toolCall.result) {
        for (const [name, state] of Object.entries(toolCall.result._meta?.['dev.lowire/state'] || {}))
          combinedState[name] = state;
      }
    }

    const message = assistantMessages[turn];
    summary.push(<step turn={turn + 1}>
      <title>{text}</title>
      {toolCalls.map(toolCall =>
        <tool-call>
          <name>{toolCall.name}</name>
          {Object.keys(toolCall.arguments).length > 0 && <arguments>{
            Object.entries(toolCall.arguments).map(([key, value]) => jsx(key, { children: [JSON.stringify(value)] }))
          }</arguments>}
        </tool-call>)}
      {toolCalls.map(toolCall =>
        toolCall.result?._meta?.['dev.lowire/history'] || []).flat().map(h => jsx(h.category, { children: [h.content] }))}
      {message.toolError && <error>{message.toolError}</error>}
    </step>);
  }

  const lastMessage: types.AssistantMessage | undefined = assistantMessages[assistantMessages.length - 1];
  if (lastMessage) {   // Remove state from combined state as it'll be a part of the last assistant message.
    for (const part of lastMessage.content.filter(part => part.type === 'tool_call')) {
      for (const name of Object.keys(part.result?._meta?.['dev.lowire/state'] || {}))
        delete combinedState[name];
    }
  }

  for (const [name, state] of Object.entries(combinedState)) {
    summary.push('');
    summary.push(<state name={name}>{state}</state>);
  }

  options.debug?.('lowire:summary')(summary.join('\n'));
  options.debug?.('lowire:summary')(JSON.stringify(lastMessage, null, 2));
  return { summary: summary.join('\n'), lastMessage };
}
