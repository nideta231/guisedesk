import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // One worker per test file (60 jsdom environments) starves the pool on a loaded machine: the first mount then
    // exceeds the default 5 s and every test in that worker fails. Cap the workers and give the tests room.
    maxWorkers: 4,
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
})
