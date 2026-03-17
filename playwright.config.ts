import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:8000',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
