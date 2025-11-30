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

import dotenv from 'dotenv';
import debug from 'debug';
import * as loop from '@lowire/loop';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
dotenv.config({ quiet: true });

async function main() {
  const { tools, callTool, close } = await loop.createMcpTools({
    playwright: {
      command: 'npx',
      args: ['playwright', 'run-mcp-server', '--isolated'],
      cwd: process.cwd(),
      stderr: 'pipe',
    }
  }, {
    rootDir: process.cwd()
  });

  const ll = new loop.Loop('github', {
    model: 'claude-sonnet-4.5',
    tools,
    callTool: params => callToolAdapter(callTool, params),
  });

  const task = 'Navigate to https://demo.playwright.dev/todomvc/ and perform acceptance testing of the functionality';
  const result = await ll.run(task, { debug, summarize: true, maxTurns: 30 });
  console.log('Intermediate result:', result);
  await close();
}

async function callToolAdapter(callTool: loop.ToolCallback, params: { name: string; arguments: any; id?: string }): Promise<loop.ToolResult> {
  const result = await callTool({
    name: params.name,
    arguments: params.arguments,
  });
  const parsedResult = parseResponse(result);
  result._meta = result._meta || {};
  const history: { category: string; content: string }[] = [];
  result._meta['dev.lowire/history'] = history;
  if (parsedResult.code)
    history!.push({ category: 'code', content: parsedResult.code.trim() });
  if (parsedResult.result)
    history!.push({ category: 'result', content: parsedResult.result.trim() });
  if (parsedResult.consoleMessages)
    history!.push({ category: 'console', content: parsedResult.consoleMessages.trim() });

  if (parsedResult.pageState)
    result._meta!['dev.lowire/state'] = { 'Page state': parsedResult.pageState.trim() };
  return result;
}

function parseResponse(response: CallToolResult) {
  if (response?.content?.[0].type !== 'text')
    throw new Error('Unexpected response format');
  const text = stripAnsiEscapes(response.content[0].text);
  const sections = parseSections(text);
  const result = sections.get('Result');
  const code = sections.get('Ran Playwright code');
  const tabs = sections.get('Open tabs');
  const pageState = sections.get('Page state');
  const consoleMessages = sections.get('New console messages');
  const modalState = sections.get('Modal state');
  const downloads = sections.get('Downloads');
  const codeNoFrame = code?.replace(/^```js\n/, '').replace(/\n```$/, '');
  const isError = response.isError;

  return {
    result,
    code: codeNoFrame,
    tabs,
    pageState,
    consoleMessages,
    modalState,
    downloads,
    isError,
  };
}

function parseSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  const sectionHeaders = text.split(/^### /m).slice(1); // Remove empty first element

  for (const section of sectionHeaders) {
    const firstNewlineIndex = section.indexOf('\n');
    if (firstNewlineIndex === -1)
      continue;

    const sectionName = section.substring(0, firstNewlineIndex);
    const sectionContent = section.substring(firstNewlineIndex + 1).trim();
    sections.set(sectionName, sectionContent);
  }

  return sections;
}

const ansiRegex = new RegExp('([\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~])))', 'g');
function stripAnsiEscapes(str: string): string {
  return str.replace(ansiRegex, '');
}

void main();
