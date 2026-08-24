import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const mcpRouter = Router();

/** Candidate locations for the VS Code mcp.json, in priority order */
function mcpCandidates(): string[] {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return [
    path.join(appData, 'Code', 'User', 'mcp.json'),
    path.join(appData, 'Code - Insiders', 'User', 'mcp.json'),
    path.join(os.homedir(), '.config', 'Code', 'User', 'mcp.json'), // Linux/macOS
  ];
}

/** Strip JS-style comments from JSONC before parsing */
function parseJsonc(text: string): unknown {
  const stripped = text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(stripped);
}

function readMcp(): Record<string, unknown> | null {
  for (const p of mcpCandidates()) {
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      return parseJsonc(raw) as Record<string, unknown>;
    } catch { /* try next */ }
  }
  return null;
}

// GET /api/mcp-config — return PATs found in VS Code mcp.json
// Only accessible on loopback; same user who owns the file.
mcpRouter.get('/', (_req: Request, res: Response) => {
  const config = readMcp();
  if (!config) {
    return res.json({ found: false, adoPat: null, githubPat: null, adoOrgUrl: null });
  }

  const servers = (config as any).servers ?? {};

  const adoEnv  = servers?.ado?.env ?? {};
  const ghEnv   = servers?.github?.env ?? {};

  const adoPat    = adoEnv['AZURE_DEVOPS_PAT']          ?? null;
  const adoOrgUrl = adoEnv['AZURE_DEVOPS_ORG_URL']      ?? null;
  const githubPat = ghEnv['GITHUB_PERSONAL_ACCESS_TOKEN'] ?? null;

  // Never return placeholder / empty values
  const clean = (v: string | null) =>
    v && v.trim() && !['REDACTED','changeme','<PAT>',''].includes(v.trim()) ? v : null;

  return res.json({
    found: true,
    adoPat:    clean(adoPat),
    githubPat: clean(githubPat),
    adoOrgUrl: adoOrgUrl ?? null,
  });
});
