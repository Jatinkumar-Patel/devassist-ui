import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

export const skillsRouter = Router();

// Skill files live in the workspace — search common locations
const SKILL_SEARCH_ROOTS = [
  'C:\\Users\\jpatel.CORPORATE\\source\\AIrepos\\allscriptshealthcare\\plhlt-aimanager-npm\\skills\\devassist-triage',
  path.join(process.cwd(), 'skills', 'devassist-triage'),
  path.join(process.cwd(), '..', 'skills', 'devassist-triage'),
];

function findSkillRoot(): string | null {
  for (const r of SKILL_SEARCH_ROOTS) {
    if (fs.existsSync(path.join(r, 'SKILL.md'))) return r;
  }
  return null;
}

function readFile(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
}

// GET /api/skills/area/:areaId — return the full skill content for an area
// areaId: sunrise-mobile | compass-scm | clindoc-scm
skillsRouter.get('/area/:areaId', (_req: Request, res: Response) => {
  const { areaId } = _req.params;
  const root = findSkillRoot();
  if (!root) return res.status(404).json({ error: 'Skill root not found on this machine' });

  const areaDir = path.join(root, 'areas', areaId);
  if (!fs.existsSync(areaDir)) return res.status(404).json({ error: `Area '${areaId}' not found` });

  // Read all skill files for the area + shared references
  const files: Record<string, string> = {};

  // Area-specific files
  for (const f of fs.readdirSync(areaDir)) {
    if (f.endsWith('.md')) files[f] = readFile(path.join(areaDir, f));
  }

  // Shared references relevant to analysis
  const refs = ['reasoning-framework.md', 'log-triage.md', 'report-format.md'];
  for (const f of refs) {
    const content = readFile(path.join(root, 'references', f));
    if (content) files[`references/${f}`] = content;
  }

  return res.json({ areaId, root, files, available: Object.keys(files) });
});

// GET /api/skills/list — list available areas
skillsRouter.get('/list', (_req: Request, res: Response) => {
  const root = findSkillRoot();
  if (!root) return res.json({ found: false, areas: [] });
  const areasDir = path.join(root, 'areas');
  const areas = fs.existsSync(areasDir)
    ? fs.readdirSync(areasDir).filter(d => !d.startsWith('_') && fs.statSync(path.join(areasDir, d)).isDirectory())
    : [];
  return res.json({ found: true, root, areas });
});
