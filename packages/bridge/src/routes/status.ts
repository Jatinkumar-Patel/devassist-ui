import { Router, Request, Response } from 'express';
import { execPowerShell } from '../utils/powershell';

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
  res.json({
    bridge: 'ok',
    version: '0.1.0',
    platform: process.platform,
    snowAuth: snowStatus,
    timestamp: new Date().toISOString(),
  });
});
