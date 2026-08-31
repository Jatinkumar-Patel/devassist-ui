"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registryRouter = void 0;
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
exports.registryRouter = (0, express_1.Router)();
// Per-user registry stored next to the bridge dist, survives SPA rebuilds
const USER_REGISTRY_PATH = path_1.default.join(__dirname, '..', '..', 'data', 'user-registry.json');
const DEFAULT_REGISTRY_PATH = path_1.default.join(__dirname, '..', '..', '..', 'spa', 'dist', 'config', 'product-registry.json');
function readRegistry() {
    // User's saved copy takes priority
    if (fs_1.default.existsSync(USER_REGISTRY_PATH)) {
        return JSON.parse(fs_1.default.readFileSync(USER_REGISTRY_PATH, 'utf-8'));
    }
    if (fs_1.default.existsSync(DEFAULT_REGISTRY_PATH)) {
        return JSON.parse(fs_1.default.readFileSync(DEFAULT_REGISTRY_PATH, 'utf-8'));
    }
    return { version: 2, products: [], groups: [] };
}
exports.registryRouter.get('/', (_req, res) => {
    try {
        res.json(readRegistry());
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
exports.registryRouter.put('/', (req, res) => {
    try {
        const data = req.body;
        if (!data || !Array.isArray(data.products)) {
            return res.status(400).json({ error: 'Invalid registry payload' });
        }
        fs_1.default.mkdirSync(path_1.default.dirname(USER_REGISTRY_PATH), { recursive: true });
        data.version = (data.version ?? 2) + 1;
        data.savedAt = new Date().toISOString();
        fs_1.default.writeFileSync(USER_REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf-8');
        // Also update the SPA dist copy so static fetch still works
        if (fs_1.default.existsSync(path_1.default.dirname(DEFAULT_REGISTRY_PATH))) {
            fs_1.default.writeFileSync(DEFAULT_REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf-8');
        }
        return res.json({ ok: true, version: data.version });
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
