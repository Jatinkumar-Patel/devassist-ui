import { Router, Request, Response } from 'express';
import https from 'https';

export const ghSearchRouter = Router();

function resolveGithubToken(req: Request): string | null {
  const fromHeader = req.headers['x-github-token'];
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
  const fromEnv = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  return null;
}

// Proxy GitHub API search — browser can't call api.github.com from localhost (CORS)
ghSearchRouter.get('/code', (req: Request, res: Response) => {
  const token = resolveGithubToken(req);
  if (!token) return res.status(401).json({ error: 'Missing X-GitHub-Token header and no server-side GITHUB_PERSONAL_ACCESS_TOKEN configured' });

  const q = req.query.q as string;
  const perPage = req.query.per_page ?? '10';
  const url = `https://api.github.com/search/code?q=${q}&per_page=${perPage}`;

  const options = {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'devassist-bridge/0.1.0',
    },
  };

  const proxyReq = https.request(url, options, (proxyRes) => {
    res.status(proxyRes.statusCode ?? 502);
    res.setHeader('Content-Type', 'application/json');
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => res.status(502).json({ error: err.message }));
  proxyReq.end();
});

// Commit search — requires Accept: application/vnd.github.cloak-preview
ghSearchRouter.get('/commits', (req: Request, res: Response) => {
  const token = resolveGithubToken(req);
  if (!token) return res.status(401).json({ error: 'Missing X-GitHub-Token header and no server-side GITHUB_PERSONAL_ACCESS_TOKEN configured' });

  const q = req.query.q as string;
  const perPage = req.query.per_page ?? '10';
  const url = `https://api.github.com/search/commits?q=${q}&per_page=${perPage}&sort=author-date&order=desc`;

  const options = {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.cloak-preview+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'devassist-bridge/0.1.0',
    },
  };

  const proxyReq = https.request(url, options, (proxyRes) => {
    res.status(proxyRes.statusCode ?? 502);
    res.setHeader('Content-Type', 'application/json');
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => res.status(502).json({ error: err.message }));
  proxyReq.end();
});
