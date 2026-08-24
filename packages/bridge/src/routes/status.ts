import { Router, Request, Response } from 'express';
import { execPowerShell } from '../utils/powershell';

export const statusRouter = Router();

statusRouter.get('/', async (_req: Request, res: Response) => {
  const isWindows = process.platform === 'win32';
  let snowReachable = false;

  if (isWindows) {
    try {
      // /api/SNData/GetInstance/ is the correct connectivity probe per snow-viewer-api.md
      await execPowerShell(
        `Invoke-WebRequest -Uri 'https://servicenowviewer.allscripts.com/api/SNData/GetInstance/' -UseDefaultCredentials -UseBasicParsing -TimeoutSec 5 | Out-Null`
      );
      snowReachable = true;
    } catch {
      snowReachable = false;
    }
  }

  res.json({
    bridge: 'ok',
    version: '0.1.0',
    platform: process.platform,
    snowAuth: isWindows ? (snowReachable ? 'ok' : 'unreachable — check VPN') : 'unavailable (Windows only)',
    timestamp: new Date().toISOString(),
  });
});
