import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import pkg from './package.json';

function getBuildLabel(): string {
  let commit = 'local';
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // Fall back to local when git metadata is unavailable.
  }

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  return `v${pkg.version} ${commit} ${stamp} UTC`;
}

// Bridge runs on 7447; SPA proxies /api/* to it during development
export default defineConfig({
  define: {
    __APP_BUILD__: JSON.stringify(getBuildLabel()),
  },
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
