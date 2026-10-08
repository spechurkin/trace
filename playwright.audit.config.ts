import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'audit.spec.ts',
  outputDir: '.cache/qa/playwright',
  reporter: [['list'], ['json', { outputFile: '.cache/qa/audit-results.json' }]],
});
