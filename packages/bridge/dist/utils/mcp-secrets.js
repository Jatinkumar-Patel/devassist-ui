"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBridgeSecrets = readBridgeSecrets;
exports.saveBridgeSecrets = saveBridgeSecrets;
exports.clearBridgeSecrets = clearBridgeSecrets;
exports.getBridgeSecretStatus = getBridgeSecretStatus;
exports.readMcpSecrets = readMcpSecrets;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const SECRET_STORE_DIR = process.env.LOCALAPPDATA
    ? path_1.default.join(process.env.LOCALAPPDATA, 'DevAssist')
    : path_1.default.join(os_1.default.homedir(), '.devassist');
const SECRET_STORE_PATH = path_1.default.join(SECRET_STORE_DIR, 'bridge-secrets.json');
const DPAPI_ENTROPY = 'DevAssist.Secrets.v1';
function isWindows() {
    return process.platform === 'win32';
}
function ensureSecretStoreDir() {
    fs_1.default.mkdirSync(SECRET_STORE_DIR, { recursive: true });
}
function protectSecret(value) {
    if (!isWindows())
        return value;
    const output = (0, child_process_1.execFileSync)('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `
$plain = [System.Text.Encoding]::UTF8.GetBytes($env:DEVASSIST_SECRET_PLAIN)
$entropy = [System.Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}')
$protected = [System.Security.Cryptography.ProtectedData]::Protect($plain, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($protected)
      `.trim(),
    ], {
        encoding: 'utf8',
        env: {
            ...process.env,
            DEVASSIST_SECRET_PLAIN: value,
        },
        windowsHide: true,
        timeout: 30_000,
    });
    return output.trim();
}
function unprotectSecret(value) {
    if (!isWindows())
        return value;
    const output = (0, child_process_1.execFileSync)('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `
$cipher = [Convert]::FromBase64String($env:DEVASSIST_SECRET_CIPHER)
$entropy = [System.Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}')
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($cipher, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.Text.Encoding]::UTF8.GetString($plain)
      `.trim(),
    ], {
        encoding: 'utf8',
        env: {
            ...process.env,
            DEVASSIST_SECRET_CIPHER: value,
        },
        windowsHide: true,
        timeout: 30_000,
    });
    return output.trim();
}
function readBridgeSecretFile() {
    try {
        if (!fs_1.default.existsSync(SECRET_STORE_PATH))
            return null;
        return JSON.parse(fs_1.default.readFileSync(SECRET_STORE_PATH, 'utf-8'));
    }
    catch {
        return null;
    }
}
function writeBridgeSecretFile(data) {
    ensureSecretStoreDir();
    fs_1.default.writeFileSync(SECRET_STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}
function readBridgeSecrets() {
    const file = readBridgeSecretFile();
    if (!file) {
        return { adoPat: null, githubPat: null, adoOrgUrl: null };
    }
    const adoPat = typeof file.adoPat === 'string' && file.adoPat.trim()
        ? unprotectSecret(file.adoPat.trim())
        : null;
    const githubPat = typeof file.githubPat === 'string' && file.githubPat.trim()
        ? unprotectSecret(file.githubPat.trim())
        : null;
    return { adoPat, githubPat, adoOrgUrl: null };
}
function saveBridgeSecrets(secrets) {
    const current = readBridgeSecretFile() ?? { version: 1 };
    const next = {
        version: 1,
        savedAt: new Date().toISOString(),
        adoPat: current.adoPat ?? null,
        githubPat: current.githubPat ?? null,
    };
    if (secrets.adoPat !== undefined) {
        next.adoPat = secrets.adoPat?.trim() ? protectSecret(secrets.adoPat.trim()) : null;
    }
    if (secrets.githubPat !== undefined) {
        next.githubPat = secrets.githubPat?.trim() ? protectSecret(secrets.githubPat.trim()) : null;
    }
    if (!next.adoPat && !next.githubPat) {
        try {
            fs_1.default.unlinkSync(SECRET_STORE_PATH);
        }
        catch { /* ignore */ }
        return;
    }
    writeBridgeSecretFile(next);
}
function clearBridgeSecrets() {
    try {
        fs_1.default.unlinkSync(SECRET_STORE_PATH);
    }
    catch {
        // ignore
    }
}
function getBridgeSecretStatus() {
    const file = readBridgeSecretFile();
    return {
        hasAdoPat: Boolean(file?.adoPat),
        hasGithubPat: Boolean(file?.githubPat),
    };
}
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
function readMcpConfigSecrets() {
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
function readMcpSecrets() {
    const bridgeSecrets = readBridgeSecrets();
    const mcpSecrets = readMcpConfigSecrets();
    return {
        adoPat: bridgeSecrets.adoPat ?? mcpSecrets.adoPat,
        githubPat: bridgeSecrets.githubPat ?? mcpSecrets.githubPat,
        adoOrgUrl: mcpSecrets.adoOrgUrl,
    };
}
