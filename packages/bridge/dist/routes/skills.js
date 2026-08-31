"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.skillsRouter = void 0;
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
exports.skillsRouter = (0, express_1.Router)();
// Skill files live in the workspace — search common locations
const SKILL_SEARCH_ROOTS = [
    'C:\\Users\\jpatel.CORPORATE\\source\\AIrepos\\allscriptshealthcare\\plhlt-aimanager-npm\\skills\\devassist-triage',
    path_1.default.join(process.cwd(), 'skills', 'devassist-triage'),
    path_1.default.join(process.cwd(), '..', 'skills', 'devassist-triage'),
];
function findSkillRoot() {
    for (const r of SKILL_SEARCH_ROOTS) {
        if (fs_1.default.existsSync(path_1.default.join(r, 'SKILL.md')))
            return r;
    }
    return null;
}
function readFile(filePath) {
    try {
        return fs_1.default.readFileSync(filePath, 'utf-8');
    }
    catch {
        return '';
    }
}
// GET /api/skills/area/:areaId — return the full skill content for an area
// areaId: sunrise-mobile | compass-scm | clindoc-scm
exports.skillsRouter.get('/area/:areaId', (_req, res) => {
    const { areaId } = _req.params;
    const root = findSkillRoot();
    if (!root)
        return res.status(404).json({ error: 'Skill root not found on this machine' });
    const areaDir = path_1.default.join(root, 'areas', areaId);
    if (!fs_1.default.existsSync(areaDir))
        return res.status(404).json({ error: `Area '${areaId}' not found` });
    // Read all skill files for the area + shared references
    const files = {};
    // Area-specific files
    for (const f of fs_1.default.readdirSync(areaDir)) {
        if (f.endsWith('.md'))
            files[f] = readFile(path_1.default.join(areaDir, f));
    }
    // Shared references relevant to analysis
    const refs = ['reasoning-framework.md', 'log-triage.md', 'report-format.md'];
    for (const f of refs) {
        const content = readFile(path_1.default.join(root, 'references', f));
        if (content)
            files[`references/${f}`] = content;
    }
    return res.json({ areaId, root, files, available: Object.keys(files) });
});
// GET /api/skills/list — list available areas
exports.skillsRouter.get('/list', (_req, res) => {
    const root = findSkillRoot();
    if (!root)
        return res.json({ found: false, areas: [] });
    const areasDir = path_1.default.join(root, 'areas');
    const areas = fs_1.default.existsSync(areasDir)
        ? fs_1.default.readdirSync(areasDir).filter(d => !d.startsWith('_') && fs_1.default.statSync(path_1.default.join(areasDir, d)).isDirectory())
        : [];
    return res.json({ found: true, root, areas });
});
