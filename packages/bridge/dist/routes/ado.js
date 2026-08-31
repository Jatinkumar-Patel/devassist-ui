"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adoRouter = void 0;
const express_1 = require("express");
const https_1 = __importDefault(require("https"));
const mcp_secrets_1 = require("../utils/mcp-secrets");
exports.adoRouter = (0, express_1.Router)();
const ADO_BASE = 'https://alm-prod-app1.rd.allscripts.com/tfs/boc_projects';
function serverSideAdoAuthHeader() {
    const envPat = process.env.AZURE_DEVOPS_PAT?.trim();
    const mcpPat = (0, mcp_secrets_1.readMcpSecrets)().adoPat;
    const pat = envPat || mcpPat;
    if (!pat)
        return null;
    const token = Buffer.from(`:${pat}`, 'utf-8').toString('base64');
    return `Basic ${token}`;
}
// Proxy ADO REST calls to avoid CORS issues with on-prem TFS.
// Prefer server-side credentials (env/mcp.json) to avoid browser secret exposure.
exports.adoRouter.use('*', (req, res) => {
    const adoPath = req.params[0] ?? '';
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const targetUrl = `${ADO_BASE}${adoPath}${query}`;
    const incomingAuth = req.headers['authorization'];
    const serverAuth = serverSideAdoAuthHeader();
    const authHeader = serverAuth ?? (typeof incomingAuth === 'string' ? incomingAuth : null);
    if (!authHeader) {
        return res.status(401).json({ error: 'Missing Authorization header and no server-side AZURE_DEVOPS_PAT configured' });
    }
    const options = {
        method: req.method,
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        // on-prem TFS uses an internal CA not in the default trust store
        rejectUnauthorized: false,
    };
    const proxyReq = https_1.default.request(targetUrl, options, (proxyRes) => {
        res.status(proxyRes.statusCode ?? 502);
        proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => res.status(502).json({ error: err.message }));
    if (req.body && ['POST', 'PATCH', 'PUT'].includes(req.method)) {
        proxyReq.write(JSON.stringify(req.body));
    }
    proxyReq.end();
});
