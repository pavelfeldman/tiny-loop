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

import * as fs from 'fs';
import * as path from 'path';

import { test, expect } from './fixtures';
import * as types from '../lib/types';

test('completion', async ({ loop }) => {
  const result = await loop.run('This is a test, reply with just "Hello world"');
  expect(result).toEqual({ result: 'Hello world' });
});

test('typed reply', async ({ loop }) => {
  const result = await loop.run('Reply with 42 using the given schema', {
    resultSchema: { type: 'object', properties: { magic: { type: 'number' } }, required: ['magic'] },
  });
  expect(result).toEqual({ magic: 42 });
});

test('tool call', async ({ loop }) => {
  const tools: types.Tool[] = [
    {
      name: 'add',
      description: 'Adds two numbers together. Input and output are in JSON format.',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'The first number' },
          b: { type: 'number', description: 'The second number' },
        },
        required: ['a', 'b'],
      },
    }
  ];
  const resultSchema: types.Schema = {
    type: 'object',
    properties: {
      sum: { type: 'number', description: 'The sum of the two numbers' },
    },
    required: ['sum'],
  };

  const callTool: types.ToolCallback = async params => {
    expect(params.name).toBe('add');
    const { a, b } = params.arguments;
    return { content: [{ type: 'text', text: JSON.stringify({ result: a + b }) }] };
  };

  const result = await loop.run('Use add tool to add 2 and 3.', { tools, callTool, resultSchema });
  expect(result).toEqual({ sum: 5 });
});

test('tool call - image reply', async ({ loop, provider }) => {
  const tools: types.Tool[] = [
    {
      name: 'capture_image',
      description: 'Captures an image.',
      inputSchema: { type: 'object', properties: {} },
    }
  ];

  const callTool: types.ToolCallback = async params => {
    expect(params.name).toBe('capture_image');
    const data = await fs.promises.readFile(path.resolve(__dirname, 'assets/42.png'));
    return {
      content: [{ type: 'image', mimeType: 'image/png', data: data.toString('base64') }]
    };
  };

  const resultSchema: types.Schema = {
    type: 'object',
    properties: {
      result: { type: 'number', description: 'Number that you see in the image' },
    },
    required: ['result'],
  };

  const result = await loop.run('Capture the image and tell me what number you see on it', { tools, callTool, resultSchema });
  expect(result).toEqual({ result: 42 });
});
