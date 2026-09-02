"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusRouter = void 0;
const express_1 = require("express");
const powershell_1 = require("../utils/powershell");
const mcp_secrets_1 = require("../utils/mcp-secrets");
exports.statusRouter = (0, express_1.Router)();
const BRIDGE_VERSION = '0.2.0';
// Cache last SNOW check so /api/status responds instantly
let snowStatus = process.platform === 'win32' ? 'checking…' : 'unavailable (Windows only)';
let snowChecked = false;
function checkSnowInBackground() {
    if (process.platform !== 'win32' || snowChecked)
        return;
    (0, powershell_1.execPowerShell)(`Invoke-WebRequest -Uri 'https://servicenowviewer.allscripts.com/api/SNData/GetInstance/' ` +
        `-UseDefaultCredentials -UseBasicParsing -TimeoutSec 5 | Out-Null`).then(() => {
        snowStatus = 'ok';
        snowChecked = true;
    }).catch(() => {
        snowStatus = 'unreachable — check VPN';
        snowChecked = true;
    });
}
// Respond instantly; SNOW check runs in background after first call
exports.statusRouter.get('/', (_req, res) => {
    checkSnowInBackground();
    const secrets = (0, mcp_secrets_1.readMcpSecrets)();
    const adoReady = Boolean(process.env.AZURE_DEVOPS_PAT?.trim() || secrets.adoPat);
    const githubReady = Boolean(process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim() || secrets.githubPat);
    res.json({
        bridge: 'ok',
        version: BRIDGE_VERSION,
        platform: process.platform,
        snowAuth: snowStatus,
        adoAuth: adoReady ? 'ok' : 'missing',
        githubAuth: githubReady ? 'ok' : 'missing',
        timestamp: new Date().toISOString(),
    });
});
