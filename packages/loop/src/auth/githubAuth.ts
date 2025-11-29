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

import { kEditorHeaders } from '../providers/github';

/* eslint-disable no-console */

// The Client ID for VS Code. This is public knowledge but technically "internal" to VS Code.
// Using this ID allows the script to impersonate VS Code to get the correct scopes.
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const SCOPE = 'read:user share:copilot';

type DeviceData = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
};

async function initiateDeviceFlow(): Promise<DeviceData> {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: kEditorHeaders,
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: SCOPE
    })
  });
  return await response.json() as DeviceData;
}

type AccessTokenResponse = {
  access_token: string;
  error: string;
  error_description: string;
} | {
  error: 'authorization_pending' | 'slow_down';
  error_description: string;
  error_uri: string;
};

async function pollForToken(deviceCode: string, interval: number): Promise<string> {
  console.log('Waiting for user authorization...');

  return new Promise((resolve, reject) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: kEditorHeaders,
          body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        });
        const data = await response.json() as AccessTokenResponse;
        if ('access_token' in data) {
          clearInterval(pollInterval);
          resolve(data.access_token);
        } else if (data.error === 'authorization_pending') {
          process.stdout.write('.');
        } else if (data.error === 'slow_down') {
          console.log('(slow down)');
        } else {
          clearInterval(pollInterval);
          reject(new Error(data.error_description || data.error));
        }
      } catch (error) {
        clearInterval(pollInterval);
        reject(error);
      }
    }, (interval + 1) * 1000);
  });
}

void (async () => {
  const deviceData = await initiateDeviceFlow();

  console.log('\n**************************************************');
  console.log(`Please go to: ${deviceData.verification_uri}`);
  console.log(`And enter code: ${deviceData.user_code}`);
  console.log('**************************************************\n');

  const oauthToken = await pollForToken(deviceData.device_code, deviceData.interval);
  console.log('\n✔ Authentication successful!');
  console.log(`COPILOT_API_KEY=${oauthToken}`);
})();
