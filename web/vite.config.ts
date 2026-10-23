import { defineConfig } from 'vite'
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.GWENT_API_TARGET ?? 'http://127.0.0.1:8080',
        ws: true,
        changeOrigin: false,
      },
      '/healthz': process.env.GWENT_API_TARGET ?? 'http://127.0.0.1:8080',
    },
  },
  build: { outDir: 'dist', assetsDir: 'assets' },
})
