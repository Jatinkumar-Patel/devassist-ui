import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Bridge runs on 7447; SPA proxies /api/* to it during development
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7447',
        changeOrigin: true,
      },
    },
  },
  // GitHub Pages deploys to /REPO-NAME/ — set base if using Pages directly
  // base: '/devassist-ui/',
});
