import { Router, Request, Response } from 'express';
import https from 'https';

export const adoRouter = Router();

const ADO_BASE = 'https://alm-prod-app1.rd.allscripts.com/tfs/boc_projects';

function serverSideAdoAuthHeader(): string | null {
  const pat = process.env.AZURE_DEVOPS_PAT?.trim();
  if (!pat) return null;
  const token = Buffer.from(`:${pat}`, 'utf-8').toString('base64');
  return `Basic ${token}`;
}

// Proxy ADO REST calls to avoid CORS issues with on-prem TFS
// Authorization header is forwarded from the SPA (PAT as Basic auth)
adoRouter.use('*', (req: Request, res: Response) => {
  const adoPath = req.params[0] ?? '';
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const targetUrl = `${ADO_BASE}${adoPath}${query}`;

  const incomingAuth = req.headers['authorization'];
  const authHeader = (typeof incomingAuth === 'string' ? incomingAuth : null) ?? serverSideAdoAuthHeader();
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header and no server-side AZURE_DEVOPS_PAT configured' });
  }

  const options = {
    method: req.method,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    // on-prem TFS uses an internal CA not in the default trust store
    rejectUnauthorized: false,
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
