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

import crypto from 'crypto';
import * as types from './types';

export function cachedComplete(provider: types.Provider, caches: types.ReplayCaches, secrets: Record<string, string>): types.Provider['complete'] {
  return async (conversation: types.Conversation) => {
    const c = hideSecrets(conversation, secrets);
    const key = calculateSha1(JSON.stringify(c));

    if (caches.before[key]) {
      caches.after[key] = caches.before[key];
      return unhideSecrets(caches.before[key] ?? caches.after[key], secrets);
    }
    if (caches.after[key])
      return unhideSecrets(caches.after[key], secrets);
    const result = await provider.complete(conversation);
    caches.after[key] = hideSecrets(result, secrets);
    return result;
  };
}

type Reply = { result: types.AssistantMessage, usage: types.Usage };

function hideSecrets<T>(conversation: T, secrets: Record<string, string>): T {
  let text = JSON.stringify(conversation);
  for (const [key, value] of Object.entries(secrets))
    text = text.replaceAll(value, `<${key}>`);
  return JSON.parse(text);
}

function unhideSecrets(message: Reply, secrets: Record<string, string>): Reply {
  let text = JSON.stringify(message);
  for (const [key, value] of Object.entries(secrets))
    text = text.replaceAll(`<${key}>`, value);
  return JSON.parse(text);
}

function calculateSha1(text: string): string {
  const hash = crypto.createHash('sha1');
  hash.update(text);
  return hash.digest('hex');
}
