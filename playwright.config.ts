import path from 'path';
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

import { TestOptions } from './tests/fixtures';

dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });

export default defineConfig<TestOptions>({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'copilot',
      use: {
        provider: 'copilot',
        model: 'claude-sonnet-4.5',
      }
    },
    {
      name: 'openai',
      use: {
        provider: 'openai',
        model: 'gpt-4.1',
      }
    },
    {
      name: 'claude',
      use: {
        provider: 'claude',
        model: 'claude-sonnet-4-5',
      }
    },
    {
      name: 'gemini',
      use: {
        provider: 'gemini',
        model: 'gemini-2.5-pro',
      }
    },
  ],
});
