import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

export const registryRouter = Router();

// Per-user registry stored next to the bridge dist, survives SPA rebuilds
const USER_REGISTRY_PATH = path.join(__dirname, '..', '..', 'data', 'user-registry.json');
const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', '..', '..', 'spa', 'dist', 'config', 'product-registry.json');

function readRegistry(): object {
  // User's saved copy takes priority
  if (fs.existsSync(USER_REGISTRY_PATH)) {
    return JSON.parse(fs.readFileSync(USER_REGISTRY_PATH, 'utf-8'));
  }
  if (fs.existsSync(DEFAULT_REGISTRY_PATH)) {
    return JSON.parse(fs.readFileSync(DEFAULT_REGISTRY_PATH, 'utf-8'));
  }
  return { version: 2, products: [], groups: [] };
}

registryRouter.get('/', (_req: Request, res: Response) => {
  try {
    res.json(readRegistry());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

registryRouter.put('/', (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data || !Array.isArray(data.products)) {
      return res.status(400).json({ error: 'Invalid registry payload' });
    }
    fs.mkdirSync(path.dirname(USER_REGISTRY_PATH), { recursive: true });
    data.version = (data.version ?? 2) + 1;
    data.savedAt = new Date().toISOString();
    fs.writeFileSync(USER_REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf-8');
    // Also update the SPA dist copy so static fetch still works
    if (fs.existsSync(path.dirname(DEFAULT_REGISTRY_PATH))) {
      fs.writeFileSync(DEFAULT_REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf-8');
    }
    return res.json({ ok: true, version: data.version });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});
