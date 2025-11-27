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

import { test, expect } from './fixtures';
import * as types from '../lib/types';

test('on before call', async ({ loop }) => {
  const tools: types.Tool[] = [
    {
      name: 'counter',
      description: 'Query counter value',
      inputSchema: { type: 'object', properties: {}, },
    }
  ];
  const callTool: types.ToolCallback = async params => {
    expect(params.name).toBe('counter');
    return { content: [{ type: 'text', text: 'Counter value is 43' }] };
  };

  const log: any[] = [];
  const result = await loop.run('Query counter value and report it', {
    tools,
    callTool,
    onBeforeTurn: async ({ turn, sizes, totalUsage }) => {
      log.push({ turn, sizes, totalUsage });
    },
  });
  expect(result).toEqual({ result: expect.stringContaining('43') });
  const anyNumber = expect.any(Number);
  const anySizes = { headers: anyNumber, messages: anyNumber, toolsResults: anyNumber };
  const anyTotalUsage = { input: anyNumber, output: anyNumber };
  expect(log[0]).toEqual({ turn: 0, sizes: anySizes, totalUsage: anyTotalUsage });
});
