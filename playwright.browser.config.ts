import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'browser.spec.ts',
  outputDir: '.cache/qa/browser',
  reporter: [['list'], ['json', { outputFile: '.cache/qa/browser-results.json' }]],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
