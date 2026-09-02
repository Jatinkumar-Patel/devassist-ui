#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./server");
const open_1 = __importDefault(require("open"));
const PORT = parseInt(process.env.BRIDGE_PORT ?? '7447', 10);
const SPA_ORIGIN = process.env.SPA_ORIGIN ?? 'https://jatinkumar-patel.github.io';
// The GitHub Pages URL where the SPA is deployed
const PAGES_URL = process.env.PAGES_URL ?? 'https://jatinkumar-patel.github.io/devassist-ui/';
const app = (0, server_1.createServer)({ spaOrigin: SPA_ORIGIN });
const server = app.listen(PORT, '127.0.0.1', () => {
    const localUrl = `http://localhost:${PORT}`;
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║             DevAssist  v0.1.0                      ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');
    console.log(`  Bridge:     ${localUrl}`);
    console.log(`  SNOW auth:  ${process.platform === 'win32' ? '✓ Windows session (no password needed)' : '✗ Windows only'}`);
    console.log(`\n  Open the app (latest local build):\n  → ${localUrl}\n`);
    console.log(`  GitHub Pages (may be stale/cached):\n  → ${PAGES_URL}\n`);
    console.log('  Press Ctrl+C to stop.\n');
    if (!process.argv.includes('--no-open')) {
        // Prefer local bridge-served SPA to avoid stale GitHub Pages cache.
        (0, open_1.default)(localUrl).catch(() => (0, open_1.default)(PAGES_URL).catch(() => { }));
    }
});
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`\nDevAssist Bridge is already running on http://localhost:${PORT}`);
        console.log('Use the existing window/browser tab. Do not start a second bridge instance.\n');
        process.exit(0);
    }
    console.error('Bridge failed to start:', err.message);
    process.exit(1);
});
