"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const snow_1 = require("./routes/snow");
const ado_1 = require("./routes/ado");
const status_1 = require("./routes/status");
const mcp_config_1 = require("./routes/mcp-config");
const gh_search_1 = require("./routes/gh-search");
const log_analysis_1 = require("./routes/log-analysis");
const ai_analysis_1 = require("./routes/ai-analysis");
const registry_1 = require("./routes/registry");
const skills_1 = require("./routes/skills");
const secrets_1 = require("./routes/secrets");
function createServer({ spaOrigin }) {
    const app = (0, express_1.default)();
    const allowedExactOrigins = new Set([
        spaOrigin,
        'https://jatinkumar-patel.github.io',
    ]);
    const isLocalhostOrigin = (origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    app.use((0, cors_1.default)({
        // Allow GitHub Pages + local dev SPA on any localhost port.
        origin: (origin, callback) => {
            if (!origin)
                return callback(null, true); // non-browser clients (curl, tools)
            if (allowedExactOrigins.has(origin) || isLocalhostOrigin(origin))
                return callback(null, true);
            return callback(new Error(`Origin not allowed by CORS: ${origin}`));
        },
        credentials: false,
    }));
    app.use(express_1.default.json());
    // API routes
    app.use('/api/status', status_1.statusRouter);
    app.use('/api/mcp-config', mcp_config_1.mcpRouter);
    app.use('/api/snow', snow_1.snowRouter);
    app.use('/api/ado', ado_1.adoRouter);
    app.use('/api/gh-search', gh_search_1.ghSearchRouter);
    app.use('/api/log-analysis', log_analysis_1.logAnalysisRouter);
    app.use('/api/ai-analyze', ai_analysis_1.aiAnalysisRouter);
    app.use('/api/skills', skills_1.skillsRouter);
    app.use('/api/registry', registry_1.registryRouter);
    app.use('/api/secrets', secrets_1.secretsRouter);
    // Serve the built SPA if it exists alongside the bridge dist
    const spaPath = path_1.default.resolve(__dirname, '../../spa/dist');
    app.use((req, res, next) => {
        if (!req.path.startsWith('/api/')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
        }
        next();
    });
    app.use(express_1.default.static(spaPath));
    app.get('*', (_req, res) => {
        res.sendFile(path_1.default.join(spaPath, 'index.html'), (err) => {
            if (err) {
                res.status(404).json({
                    error: 'SPA not found. From repo root run: npm run build (or npm run bridge, which now builds automatically).',
                });
            }
        });
    });
    // Global error handler
    app.use((err, _req, res, _next) => {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    });
    return app;
}
