import path from 'path';
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

import { TestOptions } from './tests/fixtures';

dotenv.config({ quiet: true });

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
        provider: 'github',
        model: 'claude-sonnet-4.5',
      }
    },
    {
      name: 'gpt',
      use: {
        provider: 'openai',
        model: 'gpt-4.1',
      }
    },
    {
      name: 'claude',
      use: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      }
    },
    {
      name: 'gemini',
      use: {
        provider: 'google',
        model: 'gemini-2.5-flash',
      }
    },
  ],
});
