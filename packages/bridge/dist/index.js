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
const BRIDGE_BANNER_VERSION = '0.2.0';
const OPEN_LOCAL_UI_ONLY = process.env.DEVASSIST_OPEN_LOCAL_UI === '1';
const app = (0, server_1.createServer)({ spaOrigin: SPA_ORIGIN, pagesUrl: PAGES_URL });
const server = app.listen(PORT, '127.0.0.1', () => {
    const localUrl = `http://localhost:${PORT}`;
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log(`║             DevAssist  v${BRIDGE_BANNER_VERSION}                      ║`);
    console.log('╚══════════════════════════════════════════════════════╝\n');
    console.log(`  Bridge:     ${localUrl}`);
    console.log(`  SNOW auth:  ${process.platform === 'win32' ? '✓ Windows session (no password needed)' : '✗ Windows only'}`);
    const webUrl = `${PAGES_URL}?bridgeUrl=${encodeURIComponent(localUrl)}&v=${Date.now()}#/triage`;
    console.log(`\n  Open the app (latest web build, local bridge APIs):\n  → ${webUrl}\n`);
    console.log(`  Local fallback UI:\n  → ${localUrl}\n`);
    console.log(`  GitHub Pages (may be stale/cached):\n  → ${PAGES_URL}\n`);
    console.log('  Press Ctrl+C to stop.\n');
    if (!process.argv.includes('--no-open')) {
        // Enterprise default: prefer latest web build while continuing to use local bridge APIs.
        const preferredUrl = OPEN_LOCAL_UI_ONLY ? localUrl : webUrl;
        const fallbackUrl = OPEN_LOCAL_UI_ONLY ? webUrl : localUrl;
        (0, open_1.default)(preferredUrl).catch(() => (0, open_1.default)(fallbackUrl).catch(() => (0, open_1.default)(PAGES_URL).catch(() => { })));
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
