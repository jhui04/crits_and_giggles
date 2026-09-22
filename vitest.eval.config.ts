import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/evals/**/*.eval.test.js'],
    testTimeout: 60000,
  },
});
