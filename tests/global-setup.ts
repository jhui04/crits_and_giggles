import { type FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  // Database seeding is now handled by individual test suites using the /api/danger/reset endpoint.
  // This ensures perfect isolation and robustness against server restarts.
}

export default globalSetup;
