import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { readMcpSecrets } from '../utils/mcp-secrets';

export const skillsRouter = Router();

interface GithubTreeRef {
  owner: string;
  repo: string;
  ref: string;
  treePath: string;
}

function resolveGithubToken(): string | null {
  const mcpToken = readMcpSecrets().githubPat;
  if (mcpToken) return mcpToken;
  const envToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim();
  return envToken || null;
}

function requestJson(url: string, token?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'devassist-bridge/0.2.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = https.request(url, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString('utf-8'); });
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) {
          return reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 300)}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid GitHub response: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function requestText(url: string, token?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': 'devassist-bridge/0.2.0',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = https.request(url, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString('utf-8'); });
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

function parseGithubTreeUrl(url: string): GithubTreeRef | null {
  const text = String(url ?? '').trim();
  if (!/^https:\/\/github\.com\//i.test(text)) return null;
  const m = text.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/(tree|blob)\/([^\/]+)\/(.+)$/i);
  if (!m) return null;
  const [, owner, repo, _kind, ref, treePath] = m;
  return { owner, repo, ref, treePath };
}

async function readGithubMarkdownFile(owner: string, repo: string, ref: string, filePath: string, token?: string): Promise<string> {
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

async function loadGithubSkillFiles(areaId: string, githubSkillPaths: string[]): Promise<Record<string, string>> {
  const token = resolveGithubToken() ?? undefined;
  const files: Record<string, string> = {};

  const addFile = (name: string, content: string) => {
    if (!content.trim()) return;
    if (!files[name]) files[name] = content;
  };

  for (const rawPath of githubSkillPaths) {
    const parsed = parseGithubTreeUrl(rawPath);
    if (!parsed) continue;

    const targets = new Set<string>();
    const normalized = parsed.treePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

    if (/\/areas\//i.test(normalized)) {
      targets.add(normalized);
    } else {
      targets.add(`${normalized}/areas/${areaId}`);
      targets.add(`${normalized}/references`);
    }

    for (const target of targets) {
      const listUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${target}?ref=${encodeURIComponent(parsed.ref)}`;
      try {
        const entries = await requestJson(listUrl, token);
        if (!Array.isArray(entries)) continue;

        for (const entry of entries) {
          if (entry?.type !== 'file') continue;
          if (typeof entry?.name !== 'string' || !entry.name.toLowerCase().endsWith('.md')) continue;
          const relPath = String(entry.path ?? '').replace(/\\/g, '/');
          if (!relPath) continue;
          const content = await readGithubMarkdownFile(parsed.owner, parsed.repo, parsed.ref, relPath, token);

          const key = target.toLowerCase().endsWith('/references')
            ? `references/${entry.name}`
            : entry.name;
          addFile(key, content);
        }
      } catch {
        // Non-fatal: continue with other targets/paths.
      }
    }
  }

  return files;
}

function buildSkillSearchRoots(): string[] {
  const userProfile = process.env.USERPROFILE ?? '';
  const systemDrive = process.env.SystemDrive ?? 'C:';
  const configured = process.env.DEVASSIST_SKILL_ROOT ?? '';
  const configuredList = (process.env.DEVASSIST_SKILL_ROOTS ?? '')
    .split(path.delimiter)
    .map((v) => v.trim())
    .filter(Boolean);

  const roots = [
    configured,
    ...configuredList,
    path.join(userProfile, 'devassist-triage'),
    path.join(userProfile, 'source', 'devassist-triage'),
    path.join(systemDrive, 'devassist-triage'),
    path.join(systemDrive, 'source', 'devassist-triage'),
    path.join(process.cwd(), 'skills', 'devassist-triage'),
    path.join(process.cwd(), '..', 'skills', 'devassist-triage'),
    path.join(process.cwd(), 'devassist-triage'),
    path.join(process.cwd(), '..', 'devassist-triage'),
  ]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);

  return Array.from(new Set(roots));
}

function findSkillRoot(): string | null {
  for (const r of buildSkillSearchRoots()) {
    if (fs.existsSync(path.join(r, 'SKILL.md'))) return r;
  }
  return null;
}

function readFile(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
}

// GET /api/skills/area/:areaId — return the full skill content for an area
// areaId: sunrise-mobile | compass-scm | clindoc-scm
skillsRouter.get('/area/:areaId', (_req: Request, res: Response) => {
  const { areaId } = _req.params;
  const root = findSkillRoot();
  if (!root) return res.status(404).json({ error: 'Skill root not found on this machine' });

  const areaDir = path.join(root, 'areas', areaId);
  if (!fs.existsSync(areaDir)) return res.status(404).json({ error: `Area '${areaId}' not found` });

  // Read all skill files for the area + shared references
  const files: Record<string, string> = {};

  // Area-specific files
  for (const f of fs.readdirSync(areaDir)) {
    if (f.endsWith('.md')) files[f] = readFile(path.join(areaDir, f));
  }

  // Shared references relevant to analysis
  const refs = ['reasoning-framework.md', 'log-triage.md', 'report-format.md'];
  for (const f of refs) {
    const content = readFile(path.join(root, 'references', f));
    if (content) files[`references/${f}`] = content;
  }

  return res.json({ areaId, root, files, available: Object.keys(files) });
});

// GET /api/skills/list — list available areas
skillsRouter.get('/list', (_req: Request, res: Response) => {
  const root = findSkillRoot();
  if (!root) return res.json({ found: false, areas: [] });
  const areasDir = path.join(root, 'areas');
  const areas = fs.existsSync(areasDir)
    ? fs.readdirSync(areasDir).filter(d => !d.startsWith('_') && fs.statSync(path.join(areasDir, d)).isDirectory())
    : [];
  return res.json({ found: true, root, areas });
});

// POST /api/skills/github-area/:areaId — load area skill markdown from GitHub tree paths
skillsRouter.post('/github-area/:areaId', async (req: Request, res: Response) => {
  const { areaId } = req.params;
  const githubSkillPaths = Array.isArray(req.body?.githubSkillPaths)
    ? req.body.githubSkillPaths.map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
    : [];

  if (!githubSkillPaths.length) {
    return res.status(400).json({ error: 'githubSkillPaths is required' });
  }

  try {
    const files = await loadGithubSkillFiles(areaId, githubSkillPaths);
    return res.json({ areaId, files, available: Object.keys(files) });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'Failed to load GitHub skill files' });
  }
});
