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

import type * as types from './types';

type ReplayCaches = {
  input: types.ReplayCache;
  output: types.ReplayCache;
  secrets: Record<string, string>;
};

export async function cachedComplete(provider: types.Provider, conversation: types.Conversation, caches: ReplayCaches | undefined, options: types.CompletionOptions): ReturnType<types.Provider['complete']> {
  if (!caches)
    return await provider.complete(conversation, options);

  const secrets = caches.secrets || {};
  const c = hideSecrets(conversation, secrets);
  const key = calculateSha1(JSON.stringify(c));

  if (!process.env.LOWIRE_NO_CACHE && caches.input[key]) {
    caches.output[key] = caches.input[key];
    return unhideSecrets(caches.input[key] ?? caches.output[key], secrets);
  }

  if (!process.env.LOWIRE_NO_CACHE && caches.output[key])
    return unhideSecrets(caches.output[key], secrets);

  if (process.env.LOWIRE_FORCE_CACHE)
    throw new Error('Cache missing but TL_FORCE_CACHE is set' + JSON.stringify(conversation, null, 2));

  const result = await provider.complete(conversation, options);
  caches.output[key] = hideSecrets(result, secrets);
  return result;
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
