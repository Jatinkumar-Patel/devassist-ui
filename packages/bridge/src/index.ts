#!/usr/bin/env node
import { createServer } from './server';
import open from 'open';

const PORT = parseInt(process.env.BRIDGE_PORT ?? '7447', 10);
const SPA_ORIGIN = process.env.SPA_ORIGIN ?? 'https://jatinkumar-patel.github.io';
// The GitHub Pages URL where the SPA is deployed
const PAGES_URL = process.env.PAGES_URL ?? 'https://jatinkumar-patel.github.io/devassist-ui/';
const BRIDGE_BANNER_VERSION = '0.2.0';

const app = createServer({ spaOrigin: SPA_ORIGIN });

const server = app.listen(PORT, '127.0.0.1', () => {
  const localUrl = `http://localhost:${PORT}`;
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║             DevAssist  v${BRIDGE_BANNER_VERSION}                      ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`  Bridge:     ${localUrl}`);
  console.log(`  SNOW auth:  ${process.platform === 'win32' ? '✓ Windows session (no password needed)' : '✗ Windows only'}`);
  console.log(`\n  Open the app (latest local build):\n  → ${localUrl}\n`);
  console.log(`  GitHub Pages (may be stale/cached):\n  → ${PAGES_URL}\n`);
  console.log('  Press Ctrl+C to stop.\n');

  if (!process.argv.includes('--no-open')) {
    // Prefer local bridge-served SPA to avoid stale GitHub Pages cache.
    open(localUrl).catch(() => open(PAGES_URL).catch(() => {}));
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\nDevAssist Bridge is already running on http://localhost:${PORT}`);
    console.log('Use the existing window/browser tab. Do not start a second bridge instance.\n');
    process.exit(0);
  }
  console.error('Bridge failed to start:', err.message);
  process.exit(1);
});
