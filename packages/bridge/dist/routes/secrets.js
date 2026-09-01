"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.secretsRouter = void 0;
const express_1 = require("express");
const mcp_secrets_1 = require("../utils/mcp-secrets");
exports.secretsRouter = (0, express_1.Router)();
exports.secretsRouter.get('/', (_req, res) => {
    return res.json({
        ...(0, mcp_secrets_1.getBridgeSecretStatus)(),
    });
});
exports.secretsRouter.put('/', (req, res) => {
    try {
        const body = req.body;
        (0, mcp_secrets_1.saveBridgeSecrets)({
            adoPat: body.adoPat,
            githubPat: body.githubPat,
        });
        return res.json((0, mcp_secrets_1.getBridgeSecretStatus)());
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.secretsRouter.delete('/', (_req, res) => {
    (0, mcp_secrets_1.clearBridgeSecrets)();
    return res.json({ hasAdoPat: false, hasGithubPat: false });
});
