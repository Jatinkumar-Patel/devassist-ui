import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { snowRouter } from './routes/snow';
import { adoRouter } from './routes/ado';
import { statusRouter } from './routes/status';
import { mcpRouter } from './routes/mcp-config';
import { ghSearchRouter } from './routes/gh-search';
import { logAnalysisRouter } from './routes/log-analysis';
import { aiAnalysisRouter } from './routes/ai-analysis';
import { registryRouter } from './routes/registry';
import { skillsRouter } from './routes/skills';
import { secretsRouter } from './routes/secrets';

interface ServerOptions {
  spaOrigin: string;
  pagesUrl: string;
}

export function createServer({ spaOrigin, pagesUrl }: ServerOptions) {
  const app = express();

  const allowedExactOrigins = new Set([
    spaOrigin,
    'https://jatinkumar-patel.github.io',
  ]);

  const isLocalhostOrigin = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

  app.use(cors({
    // Allow GitHub Pages + local dev SPA on any localhost port.
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // non-browser clients (curl, tools)
      if (allowedExactOrigins.has(origin) || isLocalhostOrigin(origin)) return callback(null, true);
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: false,
  }));
  app.use(express.json());

  // API routes
  app.use('/api/status', statusRouter);
  app.use('/api/mcp-config', mcpRouter);
  app.use('/api/snow', snowRouter);
  app.use('/api/ado', adoRouter);
  app.use('/api/gh-search', ghSearchRouter);
  app.use('/api/log-analysis', logAnalysisRouter);
  app.use('/api/ai-analyze', aiAnalysisRouter);
  app.use('/api/skills', skillsRouter);
  app.use('/api/registry', registryRouter);
  app.use('/api/secrets', secretsRouter);

  // Prevent unknown API routes from falling through to SPA HTML.
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({
      error: `Unknown API route: ${req.method} ${req.path}`,
      hint: 'Bridge may be outdated. Update and restart bridge to use newly added endpoints.',
    });
  });

  // Serve the built SPA if it exists alongside the bridge dist
  const spaPath = path.resolve(__dirname, '../../spa/dist');
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
    next();
  });

  app.get('/', (_req: Request, res: Response) => {
    const localBridgeUrl = 'http://localhost:7447';
    const redirectUrl = `${pagesUrl}?bridgeUrl=${encodeURIComponent(localBridgeUrl)}&v=${Date.now()}#/triage`;
    res.redirect(302, redirectUrl);
  });

  app.use(express.static(spaPath));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(spaPath, 'index.html'), (err) => {
      if (err) {
        res.status(404).json({
          error: 'SPA not found. From repo root run: npm run build (or npm run bridge, which now builds automatically).',
        });
      }
    });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  });

  return app;
}
