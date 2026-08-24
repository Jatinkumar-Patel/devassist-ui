import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Bridge runs on 7447; SPA proxies /api/* to it during development
export default defineConfig({
  plugins: [react()],
  // /devassist-ui/ base for GitHub Pages; / for local bridge serving
  base: process.env.GITHUB_ACTIONS ? '/devassist-ui/' : '/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7447',
        changeOrigin: true,
      },
    },
  },
});
