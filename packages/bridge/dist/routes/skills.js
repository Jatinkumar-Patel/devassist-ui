"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.skillsRouter = void 0;
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const mcp_secrets_1 = require("../utils/mcp-secrets");
exports.skillsRouter = (0, express_1.Router)();
function resolveGithubToken() {
    const mcpToken = (0, mcp_secrets_1.readMcpSecrets)().githubPat;
    if (mcpToken)
        return mcpToken;
    const envToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim();
    return envToken || null;
}
function requestJson(url, token) {
    return new Promise((resolve, reject) => {
        const headers = {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'devassist-bridge/0.2.0',
            'X-GitHub-Api-Version': '2022-11-28',
        };
        if (token)
            headers.Authorization = `Bearer ${token}`;
        const req = https_1.default.request(url, { method: 'GET', headers }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString('utf-8'); });
            res.on('end', () => {
                if ((res.statusCode ?? 500) >= 400) {
                    return reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 300)}`));
                }
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    reject(new Error(`Invalid GitHub response: ${data.slice(0, 300)}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}
function requestText(url, token) {
    return new Promise((resolve, reject) => {
        const headers = {
            'User-Agent': 'devassist-bridge/0.2.0',
        };
        if (token)
            headers.Authorization = `Bearer ${token}`;
        const req = https_1.default.request(url, { method: 'GET', headers }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString('utf-8'); });
            res.on('end', () => {
                if ((res.statusCode ?? 500) >= 400) {
                    return reject(new Error(`GitHub raw fetch ${res.statusCode}: ${data.slice(0, 300)}`));
                }
                resolve(data);
            });
        });
        req.on('error', reject);
        req.end();
    });
}
function parseGithubTreeUrl(url) {
    const text = String(url ?? '').trim();
    if (!/^https:\/\/github\.com\//i.test(text))
        return null;
    const m = text.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/(tree|blob)\/([^\/]+)\/(.+)$/i);
    if (!m)
        return null;
    const [, owner, repo, _kind, ref, treePath] = m;
    return { owner, repo, ref, treePath };
}
async function readGithubMarkdownFile(owner, repo, ref, filePath, token) {
    const api = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`;
    const node = await requestJson(api, token);
    if (typeof node?.content === 'string' && node.content.length > 0) {
        return Buffer.from(node.content, 'base64').toString('utf-8');
    }
    if (typeof node?.download_url === 'string' && node.download_url) {
        return requestText(node.download_url, token);
    }
    return '';
}
async function loadGithubSkillFiles(areaId, githubSkillPaths) {
    const token = resolveGithubToken() ?? undefined;
    const files = {};
    const addFile = (name, content) => {
        if (!content.trim())
            return;
        if (!files[name])
            files[name] = content;
    };
    for (const rawPath of githubSkillPaths) {
        const parsed = parseGithubTreeUrl(rawPath);
        if (!parsed)
            continue;
        const targets = new Set();
        const normalized = parsed.treePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (/\/areas\//i.test(normalized)) {
            targets.add(normalized);
        }
        else {
            targets.add(`${normalized}/areas/${areaId}`);
            targets.add(`${normalized}/references`);
        }
        for (const target of targets) {
            const listUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${target}?ref=${encodeURIComponent(parsed.ref)}`;
            try {
                const entries = await requestJson(listUrl, token);
                if (!Array.isArray(entries))
                    continue;
                for (const entry of entries) {
                    if (entry?.type !== 'file')
                        continue;
                    if (typeof entry?.name !== 'string' || !entry.name.toLowerCase().endsWith('.md'))
                        continue;
                    const relPath = String(entry.path ?? '').replace(/\\/g, '/');
                    if (!relPath)
                        continue;
                    const content = await readGithubMarkdownFile(parsed.owner, parsed.repo, parsed.ref, relPath, token);
                    const key = target.toLowerCase().endsWith('/references')
                        ? `references/${entry.name}`
                        : entry.name;
                    addFile(key, content);
                }
            }
            catch {
                // Non-fatal: continue with other targets/paths.
            }
        }
    }
    return files;
}
function buildSkillSearchRoots() {
    const userProfile = process.env.USERPROFILE ?? '';
    const systemDrive = process.env.SystemDrive ?? 'C:';
    const configured = process.env.DEVASSIST_SKILL_ROOT ?? '';
    const configuredList = (process.env.DEVASSIST_SKILL_ROOTS ?? '')
        .split(path_1.default.delimiter)
        .map((v) => v.trim())
        .filter(Boolean);
    const roots = [
        configured,
        ...configuredList,
        path_1.default.join(userProfile, 'devassist-triage'),
        path_1.default.join(userProfile, 'source', 'devassist-triage'),
        path_1.default.join(systemDrive, 'devassist-triage'),
        path_1.default.join(systemDrive, 'source', 'devassist-triage'),
        path_1.default.join(process.cwd(), 'skills', 'devassist-triage'),
        path_1.default.join(process.cwd(), '..', 'skills', 'devassist-triage'),
        path_1.default.join(process.cwd(), 'devassist-triage'),
        path_1.default.join(process.cwd(), '..', 'devassist-triage'),
    ]
        .map((v) => String(v ?? '').trim())
        .filter(Boolean);
    return Array.from(new Set(roots));
}
function findSkillRoot() {
    for (const r of buildSkillSearchRoots()) {
        if (fs_1.default.existsSync(path_1.default.join(r, 'SKILL.md')))
            return r;
    }
    return null;
}
function readFile(filePath) {
    try {
        return fs_1.default.readFileSync(filePath, 'utf-8');
    }
    catch {
        return '';
    }
}
// GET /api/skills/area/:areaId — return the full skill content for an area
// areaId: sunrise-mobile | compass-scm | clindoc-scm
exports.skillsRouter.get('/area/:areaId', (_req, res) => {
    const { areaId } = _req.params;
    const root = findSkillRoot();
    if (!root)
        return res.status(404).json({ error: 'Skill root not found on this machine' });
    const areaDir = path_1.default.join(root, 'areas', areaId);
    if (!fs_1.default.existsSync(areaDir))
        return res.status(404).json({ error: `Area '${areaId}' not found` });
    // Read all skill files for the area + shared references
    const files = {};
    // Area-specific files
    for (const f of fs_1.default.readdirSync(areaDir)) {
        if (f.endsWith('.md'))
            files[f] = readFile(path_1.default.join(areaDir, f));
    }
    // Shared references relevant to analysis
    const refs = ['reasoning-framework.md', 'log-triage.md', 'report-format.md'];
    for (const f of refs) {
        const content = readFile(path_1.default.join(root, 'references', f));
        if (content)
            files[`references/${f}`] = content;
    }
    return res.json({ areaId, root, files, available: Object.keys(files) });
});
// GET /api/skills/list — list available areas
exports.skillsRouter.get('/list', (_req, res) => {
    const root = findSkillRoot();
    if (!root)
        return res.json({ found: false, areas: [] });
    const areasDir = path_1.default.join(root, 'areas');
    const areas = fs_1.default.existsSync(areasDir)
        ? fs_1.default.readdirSync(areasDir).filter(d => !d.startsWith('_') && fs_1.default.statSync(path_1.default.join(areasDir, d)).isDirectory())
        : [];
    return res.json({ found: true, root, areas });
});
// POST /api/skills/github-area/:areaId — load area skill markdown from GitHub tree paths
exports.skillsRouter.post('/github-area/:areaId', async (req, res) => {
    const { areaId } = req.params;
    const githubSkillPaths = Array.isArray(req.body?.githubSkillPaths)
        ? req.body.githubSkillPaths.map((v) => String(v ?? '').trim()).filter(Boolean)
        : [];
    if (!githubSkillPaths.length) {
        return res.status(400).json({ error: 'githubSkillPaths is required' });
    }
    try {
        const files = await loadGithubSkillFiles(areaId, githubSkillPaths);
        return res.json({ areaId, files, available: Object.keys(files) });
    }
    catch (err) {
        return res.status(502).json({ error: err?.message ?? 'Failed to load GitHub skill files' });
    }
});
