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
  },
})

