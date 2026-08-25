import { Router, Request, Response } from 'express';
import { readMcpSecrets } from '../utils/mcp-secrets';

export const mcpRouter = Router();

// GET /api/mcp-config — return only presence metadata; never return raw PATs.
mcpRouter.get('/', (_req: Request, res: Response) => {
  const secrets = readMcpSecrets();
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
