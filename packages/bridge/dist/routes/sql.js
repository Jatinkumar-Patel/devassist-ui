"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sqlRouter = void 0;
const express_1 = require("express");
const mssql_1 = __importDefault(require("mssql"));
const powershell_1 = require("../utils/powershell");
exports.sqlRouter = (0, express_1.Router)();
function normalizeServer(value) {
    return String(value ?? '').trim();
}
function normalizePort(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return 1433;
    return Math.min(65535, Math.max(1, Math.floor(parsed)));
}
function psQuote(value) {
    return value.replace(/'/g, "''");
}
exports.sqlRouter.post('/test', async (req, res) => {
    const body = req.body;
    const server = normalizeServer(body.server);
    if (!server) {
        return res.status(400).json({ ok: false, error: 'SQL server is required.' });
    }
    const authMode = body.authMode === 'windows' ? 'windows' : 'sql-login';
    const database = String(body.database ?? '').trim() || 'master';
    const encrypt = body.encrypt !== false;
    const trustServerCertificate = body.trustServerCertificate !== false;
    const connectionTimeout = Math.min(30000, Math.max(3000, Number(body.connectionTimeoutMs ?? 10000)));
    const port = normalizePort(body.port);
    if (authMode === 'sql-login') {
        const user = String(body.user ?? '').trim();
        const password = String(body.password ?? '');
        if (!user || !password) {
            return res.status(400).json({ ok: false, error: 'SQL Login requires user and password.' });
        }
    }
    let pool = null;
    const startedAt = Date.now();
    try {
        if (authMode === 'windows') {
            const conn = `Server=${server},${port};Database=${database};Integrated Security=True;Encrypt=${encrypt ? 'True' : 'False'};TrustServerCertificate=${trustServerCertificate ? 'True' : 'False'};Connection Timeout=${Math.max(3, Math.floor(connectionTimeout / 1000))};`;
            const output = await (0, powershell_1.execPowerShell)(`
$conn = '${psQuote(conn)}'
$query = 'SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName'
$sqlConn = New-Object System.Data.SqlClient.SqlConnection($conn)
try {
  $sqlConn.Open()
  $cmd = $sqlConn.CreateCommand()
  $cmd.CommandText = $query
  $reader = $cmd.ExecuteReader()
  if ($reader.Read()) {
    $result = [PSCustomObject]@{
      serverName = [string]$reader['serverName']
      dbName = [string]$reader['dbName']
    }
    $result | ConvertTo-Json -Compress
  } else {
    [PSCustomObject]@{ serverName='${psQuote(server)}'; dbName='${psQuote(database)}' } | ConvertTo-Json -Compress
  }
} finally {
  if ($reader) { $reader.Close() }
  $sqlConn.Close()
}
      `);
            let row = {};
            try {
                row = JSON.parse(String(output ?? '').trim() || '{}');
            }
            catch {
                row = {};
            }
            return res.json({
                ok: true,
                server: String(row.serverName ?? server),
                database: String(row.dbName ?? database),
                authMode,
                elapsedMs: Date.now() - startedAt,
                message: 'SQL connection successful.',
            });
        }
        const config = {
            server,
            database,
            port,
            options: {
                encrypt,
                trustServerCertificate,
            },
            connectionTimeout,
            requestTimeout: connectionTimeout,
        };
        if (authMode === 'sql-login') {
            config.user = String(body.user ?? '').trim();
            config.password = String(body.password ?? '');
        }
        pool = await mssql_1.default.connect(config);
        const pingResult = await pool.request().query('SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName');
        const row = pingResult.recordset?.[0] ?? {};
        return res.json({
            ok: true,
            server: String(row.serverName ?? server),
            database: String(row.dbName ?? database),
            authMode,
            elapsedMs: Date.now() - startedAt,
            message: 'SQL connection successful.',
        });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            authMode,
            elapsedMs: Date.now() - startedAt,
            error: String(error?.message ?? 'SQL connection failed').slice(0, 600),
        });
    }
    finally {
        try {
            if (pool)
                await pool.close();
        }
        catch {
            // ignore
        }
    }
});
