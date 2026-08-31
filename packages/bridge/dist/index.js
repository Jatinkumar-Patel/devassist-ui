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
app.listen(PORT, '127.0.0.1', () => {
    const localUrl = `http://localhost:${PORT}`;
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║             DevAssist  v0.1.0                      ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');
    console.log(`  Bridge:     ${localUrl}`);
    console.log(`  SNOW auth:  ${process.platform === 'win32' ? '✓ Windows session (no password needed)' : '✗ Windows only'}`);
    console.log(`\n  Open the app:\n  → ${PAGES_URL}\n`);
    console.log('  Press Ctrl+C to stop.\n');
    if (!process.argv.includes('--no-open')) {
        // Open GitHub Pages URL (serves the SPA; it connects back to this bridge)
        (0, open_1.default)(PAGES_URL).catch(() => (0, open_1.default)(localUrl).catch(() => { }));
    }
});
