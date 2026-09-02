#!/usr/bin/env node
import { createServer } from './server';
import open from 'open';

const PORT = parseInt(process.env.BRIDGE_PORT ?? '7447', 10);
const HOST = process.env.BRIDGE_HOST ?? '127.0.0.1';
const SPA_ORIGIN = process.env.SPA_ORIGIN ?? 'https://jatinkumar-patel.github.io';
// The GitHub Pages URL where the SPA is deployed
const PAGES_URL = process.env.PAGES_URL ?? 'https://jatinkumar-patel.github.io/devassist-ui/';
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? `${SPA_ORIGIN},https://jatinkumar-patel.github.io,http://localhost:5173`)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const BRIDGE_BANNER_VERSION = '0.2.0';
const OPEN_LOCAL_UI_ONLY = process.env.DEVASSIST_OPEN_LOCAL_UI === '1';
const AUTO_OPEN_BROWSER = process.env.BRIDGE_OPEN_BROWSER === '1';

const app = createServer({ spaOrigin: SPA_ORIGIN, pagesUrl: PAGES_URL, allowedOrigins: CORS_ORIGINS });

const server = app.listen(PORT, HOST, () => {
  const localUrl = `http://localhost:${PORT}`;
  const listenUrl = `http://${HOST}:${PORT}`;
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║             DevAssist  v${BRIDGE_BANNER_VERSION}                      ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`  Bridge:     ${listenUrl}`);
  console.log(`  SNOW auth:  ${process.platform === 'win32' ? '✓ Windows session (no password needed)' : '✗ Windows only'}`);
  console.log(`  CORS:       ${CORS_ORIGINS.join(', ')}`);
  const webUrl = `${PAGES_URL}?bridgeUrl=${encodeURIComponent(localUrl)}&v=${Date.now()}#/triage`;
  console.log(`\n  Open the app (latest web build, local bridge APIs):\n  → ${webUrl}\n`);
  console.log(`  Local fallback UI:\n  → ${localUrl}\n`);
  console.log(`  GitHub Pages (may be stale/cached):\n  → ${PAGES_URL}\n`);
  console.log('  Press Ctrl+C to stop.\n');

  if (!process.argv.includes('--no-open') && AUTO_OPEN_BROWSER) {
    // Prefer the local built UI first so the browser always lands on the current workspace build.
    const preferredUrl = OPEN_LOCAL_UI_ONLY ? webUrl : localUrl;
    const fallbackUrl = OPEN_LOCAL_UI_ONLY ? localUrl : webUrl;
    open(preferredUrl).catch(() => open(fallbackUrl).catch(() => open(PAGES_URL).catch(() => {})));
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\nDevAssist Bridge is already running on ${HOST}:${PORT}`);
    console.log('Use the existing window/browser tab. Do not start a second bridge instance.\n');
    process.exit(0);
  }
  console.error('Bridge failed to start:', err.message);
  process.exit(1);
});
