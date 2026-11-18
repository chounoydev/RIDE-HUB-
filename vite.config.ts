import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const authUrl = process.env.VITE_NEON_AUTH_URL || env.VITE_NEON_AUTH_URL || env.NEON_AUTH_BASE_URL || ''

  return {
    plugins: [vue()],
    define: {
      'import.meta.env.VITE_NEON_AUTH_URL': JSON.stringify(authUrl),
    },
    server: {
      proxy: {
        '/api': 'http://localhost:3000',
      },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
