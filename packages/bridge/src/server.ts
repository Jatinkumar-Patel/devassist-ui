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

interface ServerOptions {
  spaOrigin: string;
}

export function createServer({ spaOrigin }: ServerOptions) {
  const app = express();

  app.use(cors({
    // Allow GitHub Pages origin + local dev
    origin: [
      spaOrigin,
      'https://jatinkumar-patel.github.io',
      'http://localhost:5173',
      'http://localhost:7447',
    ],
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

  // Serve the built SPA if it exists alongside the bridge dist
  const spaPath = path.resolve(__dirname, '../../spa/dist');
  app.use(express.static(spaPath));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(spaPath, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: 'SPA not found — run npm run build in packages/spa' });
    });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  });

  return app;
}
