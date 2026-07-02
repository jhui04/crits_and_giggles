import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60 * 1000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npx vite preview --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 120 * 1000,
      env: {
        VITE_API_TARGET: 'http://localhost:3005'
      }
    },
    {
      command: 'node server/index.js',
      url: 'http://localhost:3005/api/campaigns',
      reuseExistingServer: false,
      timeout: 120 * 1000,
      env: {
        PORT: '3005',
        DB_MODE: 'memory',
        NODE_ENV: 'test'
      }
    }
  ],
});
