import { defineConfig } from '@playwright/test';
import { screenReaderConfig } from '@guidepup/playwright';
import path from 'node:path';

// Runs only inside the NVDA test VM (tools/nvda-vm/run-tests.ps1).
// NVDA is a singleton, so one worker and no parallelism (screenReaderConfig).
const resultsDir = process.env.NVDA_RESULTS_DIR ?? path.join(__dirname, 'results');

export default defineConfig({
  ...screenReaderConfig,
  testDir: './tests',
  testMatch: '**/*.nvda.spec.ts',
  // Forwards localhost:5174 / :3005 in the guest to the app servers that
  // run-tests.ps1 starts on the host (NVDA_APP_HOST).
  globalSetup: './global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: 0,
  forbidOnly: true,
  outputDir: path.join(resultsDir, 'artifacts'),
  reporter: [
    ['list'],
    ['./reporters/text-summary-reporter.ts', { outputFile: path.join(resultsDir, 'summary.txt') }],
    ['json', { outputFile: path.join(resultsDir, 'results.json') }],
  ],
  use: {
    ...screenReaderConfig.use,
    browserName: 'chromium',
    headless: false,
    viewport: { width: 1280, height: 800 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
