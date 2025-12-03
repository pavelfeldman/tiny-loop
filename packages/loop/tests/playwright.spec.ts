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

import { test, expect } from './fixtures';
import { createMcpTools } from './mcp';

test('integration', async ({ loop, server }, testInfo) => {
  server.setContent('/', `
    <html>
      <button>Welcome to lowire!</button>
    </html>
  `, 'text/html');
  const toolSupport = await createMcpTools({
    playwright: {
      command: 'npx',
      args: ['playwright', 'run-mcp-server', '--headless', '--output-dir', path.join(testInfo.outputPath(), 'output')],
      cwd: testInfo.outputPath(),
      stderr: 'pipe',
    }
  }, {
    rootDir: testInfo.outputPath()
  });
  const result = await loop.run<{ result: string }>(
    `Navigate to ${server.PREFIX} via Playwright MCP and tell me what is on that page.
     Use snapshot in the navigation result, do not take snapshots or screenshots.`, {
    ...toolSupport
  });
  await toolSupport.close();
  expect(result!.result).toContain('Welcome to lowire!');
});
