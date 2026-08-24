import { Router, Request, Response } from 'express';
import https from 'https';

export const adoRouter = Router();

const ADO_BASE = 'https://alm-prod-app1.rd.allscripts.com/tfs/boc_projects';

// Proxy ADO REST calls to avoid CORS issues with on-prem TFS
// Authorization header is forwarded from the SPA (PAT as Basic auth)
adoRouter.use('*', (req: Request, res: Response) => {
  const adoPath = req.params[0] ?? '';
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const targetUrl = `${ADO_BASE}${adoPath}${query}`;

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header (ADO PAT required)' });
  }

  const options = {
    method: req.method,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };

  const proxyReq = https.request(targetUrl, options, (proxyRes) => {
    res.status(proxyRes.statusCode ?? 502);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => res.status(502).json({ error: err.message }));

  if (req.body && ['POST', 'PATCH', 'PUT'].includes(req.method)) {
    proxyReq.write(JSON.stringify(req.body));
  }
  proxyReq.end();
});
