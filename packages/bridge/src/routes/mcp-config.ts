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

/** Strip JS-style comments from JSONC before parsing, preserving string literals. */
function stripJsonComments(text: string): string {
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
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
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
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonComments(text));
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
