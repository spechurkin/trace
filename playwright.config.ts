import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/desktop',
  testMatch: ['app.spec.ts', 'board-limit.spec.ts'],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
