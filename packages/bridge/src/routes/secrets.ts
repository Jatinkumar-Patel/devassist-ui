import { Router, Request, Response } from 'express';
import { clearBridgeSecrets, getBridgeSecretStatus, saveBridgeSecrets } from '../utils/mcp-secrets';

export const secretsRouter = Router();

secretsRouter.get('/', (_req: Request, res: Response) => {
  return res.json({
    ...getBridgeSecretStatus(),
  });
});

secretsRouter.put('/', (req: Request, res: Response) => {
  try {
    const body = req.body as { adoPat?: string | null; githubPat?: string | null };
    saveBridgeSecrets({
      adoPat: body.adoPat,
      githubPat: body.githubPat,
    });
    return res.json(getBridgeSecretStatus());
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

secretsRouter.delete('/', (_req: Request, res: Response) => {
  clearBridgeSecrets();
  return res.json({ hasAdoPat: false, hasGithubPat: false });
});