import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    watch: {
      ignored: [
        '**/dnd_beyond/**',
        '**/data/**',
        '**/server/**',
        '**/tests/**',
        '**/*.sqlite3*',
        '**/*.log'
      ]
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.js'],
    exclude: ['**/node_modules/**', '**/dist/**', 'server/evals/**'],
    testTimeout: 20000,
    // Each test file gets its own in-memory SQLite DB (see env/setupFiles
    // below), so files can't collide on a shared database. They still run
    // sequentially to keep resource use and timing predictable.
    fileParallelism: false,
    // Never let tests touch data/campaigns.sqlite3; the module graph is
    // isolated per file, so each file gets a fresh in-memory DB.
    env: { DB_MODE: 'memory' },
    setupFiles: ['server/testSetup.js'],
  },
})

