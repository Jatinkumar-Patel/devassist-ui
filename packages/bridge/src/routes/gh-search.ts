import { Router, Request, Response } from 'express';
import https from 'https';

export const ghSearchRouter = Router();

// Proxy GitHub API search — browser can't call api.github.com from localhost (CORS)
ghSearchRouter.get('/code', (req: Request, res: Response) => {
  const token = req.headers['x-github-token'] as string;
  if (!token) return res.status(401).json({ error: 'Missing X-GitHub-Token header' });

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
