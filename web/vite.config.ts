import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      watch: { usePolling: env.VITE_USE_POLLING === 'true' },
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
      },
    },
  }
})
