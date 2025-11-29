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

import path from 'path';
import url from 'url';

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { test, expect } from './fixtures';
import { mcpTools } from '../lib/mcp/index';

test('integration', async ({ loop, server }, testInfo) => {
  server.setContent('/', `
    <html>
      <button>Welcome to lowire!</button>
    </html>
  `, 'text/html');
  const client = await connectToPlaywrightMcp(testInfo.outputPath());
  const toolSupport = await mcpTools(client);
  const result = await loop.run<{ result: string }>(
    `Navigate to ${server.PREFIX} via Playwright MCP and tell me what is on that page.
     Use snapshot in the navigation result, do not take snapshots or screenshots.`, {
    ...toolSupport
  });
  expect(result!.result).toContain('Welcome to lowire!');
});

async function connectToPlaywrightMcp(workspaceDir: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['playwright', 'run-mcp-server', '--headless', '--output-dir', path.join(workspaceDir, 'output')],
    cwd: workspaceDir,
    stderr: 'pipe',
  });
  const client = new Client({name: 'test', version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, async request => {
    return {
      roots: [{ name: 'workspace', uri: url.pathToFileURL(workspaceDir).toString() }],
    };
  });
  client.connect(transport);
  return client;
}
