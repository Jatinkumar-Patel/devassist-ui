"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readMcpSecrets = readMcpSecrets;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
/** Candidate locations for VS Code mcp.json */
function mcpCandidates() {
    const appData = process.env.APPDATA ?? path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming');
    return [
        path_1.default.join(appData, 'Code', 'User', 'mcp.json'),
        path_1.default.join(appData, 'Code - Insiders', 'User', 'mcp.json'),
        path_1.default.join(os_1.default.homedir(), '.config', 'Code', 'User', 'mcp.json'),
    ];
}
/** Strip JS-style comments from JSONC while preserving strings. */
function stripJsonComments(text) {
    let out = '';
    let i = 0;
    let inString = false;
    let escaped = false;
    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];
        if (inString) {
            out += ch;
            if (escaped) {
                escaped = false;
            }
            else if (ch === '\\') {
                escaped = true;
            }
            else if (ch === '"') {
                inString = false;
            }
            i += 1;
            continue;
        }
        if (ch === '"') {
            inString = true;
            out += ch;
            i += 1;
            continue;
        }
        if (ch === '/' && next === '/') {
            i += 2;
            while (i < text.length && text[i] !== '\n')
                i += 1;
            continue;
        }
        if (ch === '/' && next === '*') {
            i += 2;
            while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/'))
                i += 1;
            i += 2;
            continue;
        }
        out += ch;
        i += 1;
    }
    return out;
}
function cleanSecret(v) {
    if (typeof v !== 'string')
        return null;
    const t = v.trim();
    if (!t)
        return null;
    if (['REDACTED', 'changeme', '<PAT>'].includes(t))
        return null;
    return t;
}
function readMcpSecrets() {
    for (const candidate of mcpCandidates()) {
        try {
            const raw = fs_1.default.readFileSync(candidate, 'utf-8');
            const config = JSON.parse(stripJsonComments(raw));
            const servers = config?.servers ?? {};
            const adoEnv = servers?.ado?.env ?? {};
            const ghEnv = servers?.github?.env ?? {};
            return {
                adoPat: cleanSecret(adoEnv?.AZURE_DEVOPS_PAT),
                githubPat: cleanSecret(ghEnv?.GITHUB_PERSONAL_ACCESS_TOKEN),
                adoOrgUrl: typeof adoEnv?.AZURE_DEVOPS_ORG_URL === 'string' ? adoEnv.AZURE_DEVOPS_ORG_URL : null,
            };
        }
        catch {
            // try next candidate
        }
    }
    return { adoPat: null, githubPat: null, adoOrgUrl: null };
}
