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

import fs from 'fs';
import path from 'path';

import { test as baseTest } from '@playwright/test';
import { Loop } from '../lib/loop';
import { TestServer } from './testServer';

import type * as types from '../src/types';

export { expect } from '@playwright/test';

export type TestOptions = {
  provider: 'openai' | 'copilot' | 'claude' | 'gemini';
  model: string;
};

type TestFixtures = {
  loop: Loop;
  server: TestServer;
};

type WorkerFixtures = {
  _workerPort: number;
  _workerServer: TestServer;
};

export const test = baseTest.extend<TestOptions & TestFixtures, WorkerFixtures>({
  provider: ['copilot', { option: true }],
  model: ['', { option: true }],
  loop: async ({ provider, _workerPort, model }, use) => {
    const cacheFile = path.join(__dirname, '__cache__', provider, sanitizeFileName(test.info().titlePath.join(' ')) + '.json');
    const dataBefore = await fs.promises.readFile(cacheFile, 'utf-8').catch(() => '{}');
    let cache: types.ReplayCache = {};
    try {
      cache = JSON.parse(dataBefore) as types.ReplayCache;
    } catch {
      cache = {};
    }
    const caches: types.ReplayCaches = { before: cache, after: {} };
    await use(new Loop(provider, {
      model,
      caches,
      secrets: { PORT: String(_workerPort) }
    }));
    const dataAfter = JSON.stringify(caches.after, null, 2);
    if (dataBefore !== dataAfter) {
      await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.promises.writeFile(cacheFile, JSON.stringify(caches.after, null, 2));
    }
  },

  _workerPort: [async ({ }, use, workerInfo) => {
    const port = 8907 + workerInfo.workerIndex * 2;
    await use(port);
  }, { scope: 'worker' }],

  _workerServer: [async ({ _workerPort }, use) => {
    const server = await TestServer.create(_workerPort);
    await use(server);
    await server.stop();
  }, { scope: 'worker' }],

  server: async ({ _workerServer }, use) => {
    _workerServer.reset();
    await use(_workerServer);
  },
});

function sanitizeFileName(name: string): string {
  return name.replace('.spec.ts', '').replace(/[^a-zA-Z0-9_]+/g, '-');
}
