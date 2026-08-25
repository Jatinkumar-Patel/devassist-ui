import { Router, Request, Response } from 'express';
import { execPowerShell } from '../utils/powershell';
import { readMcpSecrets } from '../utils/mcp-secrets';

export const statusRouter = Router();

// Cache last SNOW check so /api/status responds instantly
let snowStatus = process.platform === 'win32' ? 'checking…' : 'unavailable (Windows only)';
let snowChecked = false;

function checkSnowInBackground() {
  if (process.platform !== 'win32' || snowChecked) return;
  execPowerShell(
    `Invoke-WebRequest -Uri 'https://servicenowviewer.allscripts.com/api/SNData/GetInstance/' ` +
    `-UseDefaultCredentials -UseBasicParsing -TimeoutSec 5 | Out-Null`
  ).then(() => {
    snowStatus = 'ok';
    snowChecked = true;
  }).catch(() => {
    snowStatus = 'unreachable — check VPN';
    snowChecked = true;
  });
}

// Respond instantly; SNOW check runs in background after first call
statusRouter.get('/', (_req: Request, res: Response) => {
  checkSnowInBackground();
  const secrets = readMcpSecrets();
  const adoReady = Boolean(process.env.AZURE_DEVOPS_PAT?.trim() || secrets.adoPat);
  const githubReady = Boolean(process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim() || secrets.githubPat);
  res.json({
    bridge: 'ok',
    version: '0.1.0',
    platform: process.platform,
    snowAuth: snowStatus,
    adoAuth: adoReady ? 'ok' : 'missing',
    githubAuth: githubReady ? 'ok' : 'missing',
    timestamp: new Date().toISOString(),
  });
});
