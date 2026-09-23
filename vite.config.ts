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
    // server/**/*.test.js integration tests all share one real on-disk
    // SQLite file (server/db.js has no per-test isolation). Running test
    // files across parallel worker processes gives each its own connection
    // to that same file, which collides under WAL as SQLITE_BUSY /
    // SQLITE_BUSY_SNAPSHOT errors on concurrent writes. Keeping file
    // execution sequential (single process, single connection) avoids that
    // without having to rearchitect the tests around per-file DB isolation.
    fileParallelism: false,
  },
})

