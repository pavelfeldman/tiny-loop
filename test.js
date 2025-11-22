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

// @ts-check

const colors = require('colors');
const dotenv = require('dotenv');
const { Loop } = require('./index');

dotenv.config({ quiet: true });

async function main() {
  const loop = new Loop('copilot');
  const { result } = await loop.run('Write a short poem about the sea.', { logger });
  console.log(result);
}

function logger(category, text, details = '') {
  const trimmedText = trim(text, 100);
  const trimmedDetails = trim(details, 100 - trimmedText.length - 1);
  console.log(colors.bold(colors.green(category)), trimmedText, colors.dim(trimmedDetails));
}

function trim(text, maxLength) {
  if (text.length <= maxLength)
    return text;
  return text.slice(0, maxLength - 3) + '...';
}

void main();
