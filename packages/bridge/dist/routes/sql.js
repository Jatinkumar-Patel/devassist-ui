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
function normalizeTimeoutMs(value) {
    return Math.min(30000, Math.max(3000, Number(value ?? 10000)));
}
function normalizeDatabase(value) {
    return String(value ?? '').trim() || 'master';
}
function normalizeTextQuery(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}
function readOnlyQueryViolation(query) {
    if (!query)
        return 'SQL query is required.';
    const lowered = query.toLowerCase();
    const blocked = [' insert ', ' update ', ' delete ', ' merge ', ' drop ', ' alter ', ' create ', ' truncate ', ' grant ', ' revoke ', ' deny '];
    if (blocked.some((token) => lowered.includes(token))) {
        return 'Only read-only SQL queries are allowed (SELECT/WITH/EXEC sp_help).';
    }
    if (!/^(select|with|exec\s+sp_)/i.test(query)) {
        return 'Query must start with SELECT, WITH, or EXEC sp_.';
    }
    return null;
}
function resolveConnection(body) {
    const server = normalizeServer(body.server);
    const authMode = body.authMode === 'windows' ? 'windows' : 'sql-login';
    const database = normalizeDatabase(body.database);
    const encrypt = body.encrypt !== false;
    const trustServerCertificate = body.trustServerCertificate !== false;
    const connectionTimeout = normalizeTimeoutMs(body.connectionTimeoutMs);
    const port = normalizePort(body.port);
    const user = String(body.user ?? '').trim();
    const password = String(body.password ?? '');
    return { server, authMode, database, encrypt, trustServerCertificate, connectionTimeout, port, user, password };
}
async function executeWindowsQuery(connectionString, query) {
    const output = await (0, powershell_1.execPowerShell)(`
$conn = '${psQuote(connectionString)}'
$query = '${psQuote(query)}'
$sqlConn = New-Object System.Data.SqlClient.SqlConnection($conn)
$reader = $null
try {
  $sqlConn.Open()
  $cmd = $sqlConn.CreateCommand()
  $cmd.CommandText = $query
  $reader = $cmd.ExecuteReader()
  $rows = @()
  while ($reader.Read()) {
    $obj = [ordered]@{}
    for ($i = 0; $i -lt $reader.FieldCount; $i++) {
      $obj[$reader.GetName($i)] = if ($reader.IsDBNull($i)) { $null } else { $reader.GetValue($i) }
    }
    $rows += [PSCustomObject]$obj
  }
  $columns = @()
  for ($i = 0; $i -lt $reader.FieldCount; $i++) {
    $columns += $reader.GetName($i)
  }
  [PSCustomObject]@{ columns = $columns; rows = $rows } | ConvertTo-Json -Compress -Depth 6
} finally {
  if ($reader) { $reader.Close() }
  $sqlConn.Close()
}
  `);
    const parsed = JSON.parse(String(output ?? '').trim() || '{}');
    return {
        columns: Array.isArray(parsed?.columns) ? parsed.columns : [],
        rows: Array.isArray(parsed?.rows) ? parsed.rows : [],
    };
}
async function executeSqlLoginQuery(config, query) {
    let pool = null;
    try {
        pool = await mssql_1.default.connect(config);
        const result = await pool.request().query(query);
        const rows = Array.isArray(result.recordset) ? result.recordset : [];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return { columns, rows };
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
}
async function executeQuery(connection, query) {
    if (connection.authMode === 'windows') {
        const conn = `Server=${connection.server},${connection.port};Database=${connection.database};Integrated Security=True;Encrypt=${connection.encrypt ? 'True' : 'False'};TrustServerCertificate=${connection.trustServerCertificate ? 'True' : 'False'};Connection Timeout=${Math.max(3, Math.floor(connection.connectionTimeout / 1000))};`;
        return executeWindowsQuery(conn, query);
    }
    const config = {
        server: connection.server,
        database: connection.database,
        port: connection.port,
        user: connection.user,
        password: connection.password,
        options: {
            encrypt: connection.encrypt,
            trustServerCertificate: connection.trustServerCertificate,
        },
        connectionTimeout: connection.connectionTimeout,
        requestTimeout: connection.connectionTimeout,
    };
    return executeSqlLoginQuery(config, query);
}
exports.sqlRouter.post('/test', async (req, res) => {
    const body = req.body;
    const connection = resolveConnection(body);
    if (!connection.server) {
        return res.status(400).json({ ok: false, error: 'SQL server is required.' });
    }
    if (connection.authMode === 'sql-login') {
        if (!connection.user || !connection.password) {
            return res.status(400).json({ ok: false, error: 'SQL Login requires user and password.' });
        }
    }
    const startedAt = Date.now();
    try {
        const result = await executeQuery(connection, 'SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName');
        const row = result.rows?.[0];
        return res.json({
            ok: true,
            server: String(row?.serverName ?? connection.server),
            database: String(row?.dbName ?? connection.database),
            authMode: connection.authMode,
            elapsedMs: Date.now() - startedAt,
            message: 'SQL connection successful.',
        });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            authMode: connection.authMode,
            elapsedMs: Date.now() - startedAt,
            error: String(error?.message ?? 'SQL connection failed').slice(0, 600),
        });
    }
});
exports.sqlRouter.post('/query', async (req, res) => {
    const body = req.body;
    const connection = resolveConnection(body);
    const query = normalizeTextQuery(body.query);
    if (!connection.server)
        return res.status(400).json({ ok: false, error: 'SQL server is required.' });
    if (connection.authMode === 'sql-login' && (!connection.user || !connection.password)) {
        return res.status(400).json({ ok: false, error: 'SQL Login requires user and password.' });
    }
    const violation = readOnlyQueryViolation(query);
    if (violation)
        return res.status(400).json({ ok: false, error: violation });
    const startedAt = Date.now();
    try {
        const result = await executeQuery(connection, query);
        return res.json({
            ok: true,
            columns: result.columns,
            rows: result.rows.slice(0, 200),
            rowCount: result.rows.length,
            truncated: result.rows.length > 200,
            elapsedMs: Date.now() - startedAt,
        });
    }
    catch (error) {
        return res.status(502).json({ ok: false, error: String(error?.message ?? 'SQL query failed').slice(0, 600), elapsedMs: Date.now() - startedAt });
    }
});
exports.sqlRouter.post('/metadata', async (req, res) => {
    const body = req.body;
    const connection = resolveConnection(body);
    if (!connection.server)
        return res.status(400).json({ ok: false, error: 'SQL server is required.' });
    if (connection.authMode === 'sql-login' && (!connection.user || !connection.password)) {
        return res.status(400).json({ ok: false, error: 'SQL Login requires user and password.' });
    }
    const search = String(body.search ?? '').trim().toLowerCase();
    const kinds = Array.isArray(body.kinds) && body.kinds.length ? body.kinds : ['table', 'view', 'procedure'];
    const escaped = search.replace(/'/g, "''");
    const clause = search
        ? `AND LOWER(o.name) LIKE '%${escaped}%'`
        : '';
    const kindMap = {
        table: "'U'",
        view: "'V'",
        procedure: "'P'",
    };
    const typeList = kinds.filter((k) => k in kindMap).map((k) => kindMap[k]).join(',');
    const objectQuery = `
SELECT TOP 150
  o.name AS objectName,
  s.name AS schemaName,
  o.type_desc AS objectType,
  o.create_date AS createdAt,
  o.modify_date AS modifiedAt
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE o.type IN (${typeList || "'U','V','P'"})
${clause}
ORDER BY o.modify_date DESC, s.name, o.name`;
    const startedAt = Date.now();
    try {
        const result = await executeQuery(connection, normalizeTextQuery(objectQuery));
        return res.json({
            ok: true,
            items: result.rows,
            count: result.rows.length,
            elapsedMs: Date.now() - startedAt,
        });
    }
    catch (error) {
        return res.status(502).json({ ok: false, error: String(error?.message ?? 'SQL metadata lookup failed').slice(0, 600), elapsedMs: Date.now() - startedAt });
    }
});
