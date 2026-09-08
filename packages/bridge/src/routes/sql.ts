import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { execPowerShell } from '../utils/powershell';

export const sqlRouter = Router();

type SqlAuthMode = 'sql-login' | 'windows';

interface SqlTestRequest {
  server: string;
  database?: string;
  port?: number;
  authMode?: SqlAuthMode;
  user?: string;
  password?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  connectionTimeoutMs?: number;
}

function normalizeServer(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizePort(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1433;
  return Math.min(65535, Math.max(1, Math.floor(parsed)));
}

function psQuote(value: string): string {
  return value.replace(/'/g, "''");
}

sqlRouter.post('/test', async (req: Request, res: Response) => {
  const body = req.body as SqlTestRequest;
  const server = normalizeServer(body.server);
  if (!server) {
    return res.status(400).json({ ok: false, error: 'SQL server is required.' });
  }

  const authMode: SqlAuthMode = body.authMode === 'windows' ? 'windows' : 'sql-login';
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

  let pool: sql.ConnectionPool | null = null;
  const startedAt = Date.now();

  try {
    if (authMode === 'windows') {
      const conn = `Server=${server},${port};Database=${database};Integrated Security=True;Encrypt=${encrypt ? 'True' : 'False'};TrustServerCertificate=${trustServerCertificate ? 'True' : 'False'};Connection Timeout=${Math.max(3, Math.floor(connectionTimeout / 1000))};`;
      const output = await execPowerShell(`
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

      let row: any = {};
      try {
        row = JSON.parse(String(output ?? '').trim() || '{}');
      } catch {
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

    const config: sql.config = {
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

    pool = await sql.connect(config);
    const pingResult = await pool.request().query('SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName');
    const row = pingResult.recordset?.[0] ?? {};

    return res.json({
      ok: true,
      server: String((row as any).serverName ?? server),
      database: String((row as any).dbName ?? database),
      authMode,
      elapsedMs: Date.now() - startedAt,
      message: 'SQL connection successful.',
    });
  } catch (error: any) {
    return res.status(502).json({
      ok: false,
      authMode,
      elapsedMs: Date.now() - startedAt,
      error: String(error?.message ?? 'SQL connection failed').slice(0, 600),
    });
  } finally {
    try {
      if (pool) await pool.close();
    } catch {
      // ignore
    }
  }
});
