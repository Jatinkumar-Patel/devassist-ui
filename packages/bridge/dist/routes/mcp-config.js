"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mcpRouter = void 0;
const express_1 = require("express");
const mcp_secrets_1 = require("../utils/mcp-secrets");
exports.mcpRouter = (0, express_1.Router)();
// GET /api/mcp-config — return only presence metadata; never return raw PATs.
exports.mcpRouter.get('/', (_req, res) => {
    const secrets = (0, mcp_secrets_1.readMcpSecrets)();
    const found = Boolean(secrets.adoPat || secrets.githubPat || secrets.adoOrgUrl);
    return res.json({
        found,
        hasAdoPat: Boolean(secrets.adoPat),
        hasGithubPat: Boolean(secrets.githubPat),
        adoOrgUrl: secrets.adoOrgUrl,
        // Legacy keys kept for backward compatibility; never populated with raw secrets.
        adoPat: null,
        githubPat: null,
    });
});
