import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@sitekit': fileURLToPath(new URL('../kit/web/src', import.meta.url)),
    },
  },
  test: { include: ['src/**/*.test.ts', '../kit/web/src/**/*.test.ts'] },
})
