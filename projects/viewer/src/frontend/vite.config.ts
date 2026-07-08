import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    hmr: {
      protocol: 'wss',
      clientPort: 443,
    },
    proxy: {
      '/api': {
        target: 'http://viewer-api:3000',
        changeOrigin: true,
      },
      '/sse': {
        target: 'http://viewer-mcp:3001',
        changeOrigin: true,
      },
      '/messages': {
        target: 'http://viewer-mcp:3001',
        changeOrigin: true,
      },
    },
  },
})