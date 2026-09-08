import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Check, AlertCircle, Terminal, RefreshCw, ChevronDown } from 'lucide-react';
import { useSettingsStore, ORG_DEFAULTS, type SqlProfile } from '../store/settings';
import { getBridgeInstallCommands } from '../lib/bridge-install';
import { clearBridgeSecrets, fetchSecretStatus, saveBridgeSecrets } from '../lib/secret-store';

interface DiagnosticResult {
  key: 'bridge' | 'snow' | 'ado' | 'github';
  label: string;
  ok: boolean;
  details: string;
}

interface SqlTestResult {
  ok: boolean;
  message?: string;
  error?: string;
  server?: string;
  database?: string;
  elapsedMs?: number;
}

interface SqlQueryResult {
  ok: boolean;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
  truncated?: boolean;
  elapsedMs?: number;
  error?: string;
}

interface SqlMetadataResult {
  ok: boolean;
  items?: Array<Record<string, unknown>>;
  count?: number;
  elapsedMs?: number;
  error?: string;
}

function isLocalBridgeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isLocalHostPage(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

const START_BRIDGE_CMD = '"%USERPROFILE%\\source\\repos\\devassist-ui\\start.bat"';
const START_BRIDGE_POWERSHELL = '& "$env:USERPROFILE\\source\\repos\\devassist-ui\\start.bat"';

export default function SettingsPage() {
  const {
    openaiKey,
    bridgeUrl,
    sqlServer,
    sqlDatabase,
    sqlPort,
    sqlAuthMode,
    sqlUser,
    sqlEncrypt,
    sqlTrustServerCertificate,
    sqlProfiles,
    activeSqlProfileId,
    setOpenaiKey,
    setBridgeUrl,
    setSqlServer,
    setSqlDatabase,
    setSqlPort,
    setSqlAuthMode,
    setSqlUser,
    setSqlEncrypt,
    setSqlTrustServerCertificate,
    setSqlProfiles,
    setActiveSqlProfileId,
    hasAdoPat,
    hasGithubPat,
    setSecretStatus,
    clearPats,
  } = useSettingsStore();
  const installCmds = getBridgeInstallCommands();
  const [bridgeCardOpen, setBridgeCardOpen] = useState<boolean>(() => localStorage.getItem('devassist-settings-bridge-open') !== '0');
  const [adoDraft, setAdoDraft] = useState('');
  const [githubDraft, setGithubDraft] = useState('');
  const [bridgeReachable, setBridgeReachable] = useState<boolean | null>(null);
  const [sqlPassword, setSqlPassword] = useState('');
  const [showSqlPassword, setShowSqlPassword] = useState(false);
  const [sqlTesting, setSqlTesting] = useState(false);
  const [sqlTestResult, setSqlTestResult] = useState<SqlTestResult | null>(null);
  const [sqlProfileName, setSqlProfileName] = useState('');
  const [sqlQueryText, setSqlQueryText] = useState('SELECT TOP 25 name, create_date, modify_date FROM sys.tables ORDER BY modify_date DESC');
  const [sqlQueryRunning, setSqlQueryRunning] = useState(false);
  const [sqlQueryResult, setSqlQueryResult] = useState<SqlQueryResult | null>(null);
  const [sqlMetadataSearch, setSqlMetadataSearch] = useState('');
  const [sqlMetadataRunning, setSqlMetadataRunning] = useState(false);
  const [sqlMetadataKinds, setSqlMetadataKinds] = useState<Array<'table' | 'view' | 'procedure'>>(['table', 'view', 'procedure']);
  const [sqlMetadataResult, setSqlMetadataResult] = useState<SqlMetadataResult | null>(null);
  const [supportModeEnabled, setSupportModeEnabled] = useState<boolean>(() => localStorage.getItem('devassist-support-mode') === '1');
  const localBridgeMode = isLocalBridgeUrl(bridgeUrl);
  const localHostPage = isLocalHostPage();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchSecretStatus();
        if (!cancelled) setSecretStatus(status);
      } catch {
        // non-fatal
      }
    })();
    return () => { cancelled = true; };
  }, [setSecretStatus]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${bridgeUrl}/api/status`, { signal: AbortSignal.timeout(2500) });
        if (!cancelled) setBridgeReachable(res.ok);
      } catch {
        if (!cancelled) setBridgeReachable(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bridgeUrl]);

  const reRunWizard = () => {
    localStorage.removeItem('devassist-setup-done');
    window.location.reload();
  };

  const clearAllSecrets = async () => {
    await clearBridgeSecrets();
    clearPats();
    setAdoDraft('');
    setGithubDraft('');
    setSecretStatus({ hasAdoPat: false, hasGithubPat: false });
  };

  const toggleBridgeCard = () => {
    setBridgeCardOpen((prev) => {
      const next = !prev;
      localStorage.setItem('devassist-settings-bridge-open', next ? '1' : '0');
      return next;
    });
  };

  const toggleSupportMode = () => {
    setSupportModeEnabled((prev) => {
      const next = !prev;
      localStorage.setItem('devassist-support-mode', next ? '1' : '0');
      return next;
    });
  };

  const currentSqlProfilePayload = (): Omit<SqlProfile, 'id' | 'name'> => ({
    server: sqlServer.trim(),
    database: sqlDatabase.trim(),
    port: Number(sqlPort) || 1433,
    authMode: sqlAuthMode,
    user: sqlAuthMode === 'sql-login' ? sqlUser.trim() : '',
    encrypt: sqlEncrypt,
    trustServerCertificate: sqlTrustServerCertificate,
  });

  const saveSqlProfile = () => {
    const name = sqlProfileName.trim();
    const payload = currentSqlProfilePayload();
    if (!name || !payload.server) return;

    const existing = sqlProfiles.find((p) => p.id === activeSqlProfileId);
    const id = existing?.id ?? `sql-profile-${Date.now()}`;
    const nextProfile: SqlProfile = { id, name, ...payload };
    const nextProfiles = existing
      ? sqlProfiles.map((p) => (p.id === id ? nextProfile : p))
      : [...sqlProfiles, nextProfile];

    setSqlProfiles(nextProfiles);
    setActiveSqlProfileId(id);
  };

  const loadSqlProfile = (profileId: string) => {
    setActiveSqlProfileId(profileId);
    const profile = sqlProfiles.find((p) => p.id === profileId);
    if (!profile) return;
    setSqlProfileName(profile.name);
    setSqlServer(profile.server);
    setSqlDatabase(profile.database);
    setSqlPort(profile.port);
    setSqlAuthMode(profile.authMode);
    setSqlUser(profile.user);
    setSqlEncrypt(profile.encrypt);
    setSqlTrustServerCertificate(profile.trustServerCertificate);
    setSqlPassword('');
    setSqlTestResult(null);
    setSqlQueryResult(null);
    setSqlMetadataResult(null);
  };

  const deleteSqlProfile = () => {
    if (!activeSqlProfileId) return;
    const next = sqlProfiles.filter((p) => p.id !== activeSqlProfileId);
    setSqlProfiles(next);
    setActiveSqlProfileId('');
    setSqlProfileName('');
  };

  const runSqlConnectionTest = async () => {
    setSqlTesting(true);
    setSqlTestResult(null);
    try {
      const response = await fetch(`${bridgeUrl}/api/sql/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: sqlServer,
          database: sqlDatabase,
          port: sqlPort,
          authMode: sqlAuthMode,
          user: sqlAuthMode === 'sql-login' ? sqlUser : undefined,
          password: sqlAuthMode === 'sql-login' ? sqlPassword : undefined,
          encrypt: sqlEncrypt,
          trustServerCertificate: sqlTrustServerCertificate,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json() as SqlTestResult;
      setSqlTestResult(data);
    } catch (error: any) {
      setSqlTestResult({ ok: false, error: String(error?.message ?? 'SQL connection test failed') });
    } finally {
      setSqlTesting(false);
    }
  };

  const runSqlQuery = async () => {
    setSqlQueryRunning(true);
    setSqlQueryResult(null);
    try {
      const response = await fetch(`${bridgeUrl}/api/sql/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: sqlServer,
          database: sqlDatabase,
          port: sqlPort,
          authMode: sqlAuthMode,
          user: sqlAuthMode === 'sql-login' ? sqlUser : undefined,
          password: sqlAuthMode === 'sql-login' ? sqlPassword : undefined,
          encrypt: sqlEncrypt,
          trustServerCertificate: sqlTrustServerCertificate,
          query: sqlQueryText,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json() as SqlQueryResult;
      setSqlQueryResult(data);
    } catch (error: any) {
      setSqlQueryResult({ ok: false, error: String(error?.message ?? 'SQL query failed') });
    } finally {
      setSqlQueryRunning(false);
    }
  };

  const runSqlMetadataSearch = async () => {
    setSqlMetadataRunning(true);
    setSqlMetadataResult(null);
    try {
      const response = await fetch(`${bridgeUrl}/api/sql/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: sqlServer,
          database: sqlDatabase,
          port: sqlPort,
          authMode: sqlAuthMode,
          user: sqlAuthMode === 'sql-login' ? sqlUser : undefined,
          password: sqlAuthMode === 'sql-login' ? sqlPassword : undefined,
          encrypt: sqlEncrypt,
          trustServerCertificate: sqlTrustServerCertificate,
          search: sqlMetadataSearch,
          kinds: sqlMetadataKinds,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json() as SqlMetadataResult;
      setSqlMetadataResult(data);
    } catch (error: any) {
      setSqlMetadataResult({ ok: false, error: String(error?.message ?? 'SQL metadata search failed') });
    } finally {
      setSqlMetadataRunning(false);
    }
  };

  const toggleMetadataKind = (kind: 'table' | 'view' | 'procedure') => {
    setSqlMetadataKinds((prev) => {
      const has = prev.includes(kind);
      if (has && prev.length === 1) return prev;
      return has ? prev.filter((k) => k !== kind) : [...prev, kind];
    });
  };

  return (
    <div className="max-w-xl space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-gray-100 font-semibold text-xl">Settings</h1>
        <button onClick={reRunWizard}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg">
          <RefreshCw size={12} /> Re-run setup wizard
        </button>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Authentication</h2>
        <p className="text-xs text-gray-600">
          PATs are <strong className="text-gray-400">personal</strong> — each person uses their own token.
          DevAssist stores them on this device in the local bridge, not in browser localStorage.
        </p>
        <PatField
          label="Azure DevOps PAT"
          hint="Scopes needed: Work Items (Read) · Code (Read)"
          value={adoDraft}
          onChange={setAdoDraft}
          testUrl={`${bridgeUrl}/api/ado/_apis/projects?api-version=6.0`}
          testAuth={(v) => `Basic ${btoa(`:${v}`)}`}
          saved={hasAdoPat}
          onSave={async (token) => {
            const status = await saveBridgeSecrets({ adoPat: token });
            setSecretStatus(status);
            setAdoDraft('');
          }}
          onClear={async () => {
            const status = await saveBridgeSecrets({ adoPat: '' });
            setSecretStatus(status);
            setAdoDraft('');
          }}
        />
        <PatField
          label="GitHub PAT"
          hint="Scopes needed: repo (read only)"
          value={githubDraft}
          onChange={setGithubDraft}
          testUrl="https://api.github.com/user"
          testAuth={(v) => `Bearer ${v}`}
          saved={hasGithubPat}
          onSave={async (token) => {
            const status = await saveBridgeSecrets({ githubPat: token });
            setSecretStatus(status);
            setGithubDraft('');
          }}
          onClear={async () => {
            const status = await saveBridgeSecrets({ githubPat: '' });
            setSecretStatus(status);
            setGithubDraft('');
          }}
        />
        <PatField
          label="Optional OpenAI API Key"
          hint="Fallback only. Prefer the VS Code/GitHub-managed model route or a GitHub PAT already available to this machine."
          value={openaiKey}
          onChange={setOpenaiKey}
          testUrl="https://api.openai.com/v1/models"
          testAuth={(v) => `Bearer ${v}`}
          saved={Boolean(openaiKey)}
          onSave={async (token) => {
            setOpenaiKey(token);
          }}
          onClear={async () => {
            setOpenaiKey('');
          }}
        />
        <button onClick={() => { void clearAllSecrets(); }}
          className="text-xs text-red-500 hover:text-red-400 border border-red-900 hover:border-red-700 px-3 py-1.5 rounded-lg">
          Clear all PATs
        </button>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">SQL Connection</h2>
        <p className="text-xs text-gray-600">
          VS Code SQL style connection profiles for ticket-level DB verification. Password is used for live connection actions only and is not persisted.
        </p>

        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <select
              value={activeSqlProfileId}
              onChange={(e) => loadSqlProfile(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-altera-teal"
            >
              <option value="">Select saved SQL profile...</option>
              {sqlProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={deleteSqlProfile}
              disabled={!activeSqlProfileId}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={saveSqlProfile}
              disabled={!sqlProfileName.trim() || !sqlServer.trim()}
              className="text-xs px-3 py-1.5 rounded-lg border border-cyan-700 text-cyan-200 hover:border-cyan-500 disabled:opacity-50"
            >
              Save profile
            </button>
          </div>

          <label className="text-xs text-gray-400 space-y-1 block">
            <span>Profile Name</span>
            <input
              value={sqlProfileName}
              onChange={(e) => setSqlProfileName(e.target.value)}
              placeholder="Example: AMB_AUT_271 - SCM"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-altera-teal"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-gray-400 space-y-1">
              <span>Authentication Type</span>
              <select
                value={sqlAuthMode}
                onChange={(e) => setSqlAuthMode(e.target.value === 'windows' ? 'windows' : 'sql-login')}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-altera-teal"
              >
                <option value="sql-login">SQL Login</option>
                <option value="windows">Windows (Integrated)</option>
              </select>
            </label>

            <label className="text-xs text-gray-400 space-y-1">
              <span>Port</span>
              <input
                value={String(sqlPort)}
                onChange={(e) => setSqlPort(Number(e.target.value) || 1433)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-altera-teal"
              />
            </label>

            <label className="text-xs text-gray-400 space-y-1">
              <span>Server</span>
              <input
                value={sqlServer}
                onChange={(e) => setSqlServer(e.target.value)}
                placeholder="server-name or server.domain"
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-altera-teal"
              />
            </label>

            <label className="text-xs text-gray-400 space-y-1">
              <span>Database</span>
              <input
                value={sqlDatabase}
                onChange={(e) => setSqlDatabase(e.target.value)}
                placeholder="master"
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-altera-teal"
              />
            </label>

            <label className="text-xs text-gray-400 space-y-1">
              <span>User</span>
              <input
                value={sqlUser}
                onChange={(e) => setSqlUser(e.target.value)}
                placeholder={sqlAuthMode === 'windows' ? 'Optional for Windows auth' : 'SQL login user'}
                disabled={sqlAuthMode === 'windows'}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 disabled:opacity-50 focus:outline-none focus:border-altera-teal"
              />
            </label>

            <label className="text-xs text-gray-400 space-y-1">
              <span>Password</span>
              <div className="relative">
                <input
                  type={showSqlPassword ? 'text' : 'password'}
                  value={sqlPassword}
                  onChange={(e) => setSqlPassword(e.target.value)}
                  placeholder={sqlAuthMode === 'windows' ? 'Not required for Windows auth' : 'SQL login password'}
                  disabled={sqlAuthMode === 'windows'}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 pr-9 text-sm text-gray-200 disabled:opacity-50 focus:outline-none focus:border-altera-teal"
                />
                <button
                  type="button"
                  onClick={() => setShowSqlPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
                >
                  {showSqlPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={sqlEncrypt}
                onChange={(e) => setSqlEncrypt(e.target.checked)}
              />
              Encrypt connection
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={sqlTrustServerCertificate}
                onChange={(e) => setSqlTrustServerCertificate(e.target.checked)}
              />
              Trust server certificate
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={sqlTesting || !sqlServer.trim() || (sqlAuthMode === 'sql-login' && (!sqlUser.trim() || !sqlPassword.trim()))}
              onClick={() => { void runSqlConnectionTest(); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-50"
            >
              {sqlTesting ? 'Testing...' : 'Test connection'}
            </button>
            <p className="text-xs text-gray-600">Tip: SQL password is never saved in profile storage.</p>
          </div>

          {sqlTestResult && (
            <div className={`rounded border px-3 py-2 text-xs ${sqlTestResult.ok ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300' : 'border-red-800 bg-red-950/30 text-red-300'}`}>
              {sqlTestResult.ok
                ? `${sqlTestResult.message ?? 'Connection successful'} ${sqlTestResult.server ? `| Server: ${sqlTestResult.server}` : ''} ${sqlTestResult.database ? `| DB: ${sqlTestResult.database}` : ''} ${typeof sqlTestResult.elapsedMs === 'number' ? `| ${sqlTestResult.elapsedMs} ms` : ''}`
                : `Connection failed: ${sqlTestResult.error ?? 'Unknown error'}`}
            </div>
          )}

          {sqlTestResult?.ok && (
            <div className="space-y-3 border-t border-gray-800 pt-3">
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-300">Run test query</p>
                <textarea
                  value={sqlQueryText}
                  onChange={(e) => setSqlQueryText(e.target.value)}
                  rows={4}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-altera-teal"
                />
                <button
                  type="button"
                  onClick={() => { void runSqlQuery(); }}
                  disabled={sqlQueryRunning || !sqlQueryText.trim() || (sqlAuthMode === 'sql-login' && !sqlPassword.trim())}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-50"
                >
                  {sqlQueryRunning ? 'Running query...' : 'Run query'}
                </button>

                {sqlQueryResult && (
                  <div className={`rounded border px-3 py-2 text-xs ${sqlQueryResult.ok ? 'border-emerald-800 bg-emerald-950/20 text-emerald-200' : 'border-red-800 bg-red-950/20 text-red-300'}`}>
                    {sqlQueryResult.ok ? (
                      <>
                        <p>Rows: {sqlQueryResult.rowCount ?? 0}{sqlQueryResult.truncated ? ' (showing first 200)' : ''} | {sqlQueryResult.elapsedMs ?? 0} ms</p>
                        <div className="overflow-auto mt-2 border border-gray-800 rounded">
                          <table className="w-full text-left text-[11px]">
                            <thead className="bg-gray-950 text-gray-400">
                              <tr>
                                {(sqlQueryResult.columns ?? []).map((column) => (
                                  <th key={column} className="px-2 py-1 border-b border-gray-800">{column}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(sqlQueryResult.rows ?? []).slice(0, 50).map((row, idx) => (
                                <tr key={idx} className="odd:bg-gray-950/30">
                                  {(sqlQueryResult.columns ?? []).map((column) => (
                                    <td key={`${idx}-${column}`} className="px-2 py-1 border-b border-gray-900 text-gray-300">{String((row as any)[column] ?? '')}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : (
                      <p>Query failed: {sqlQueryResult.error ?? 'Unknown error'}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-300">Metadata explorer</p>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    value={sqlMetadataSearch}
                    onChange={(e) => setSqlMetadataSearch(e.target.value)}
                    placeholder="Search object name (table/view/procedure)"
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-altera-teal"
                  />
                  <button
                    type="button"
                    onClick={() => { void runSqlMetadataSearch(); }}
                    disabled={sqlMetadataRunning || (sqlAuthMode === 'sql-login' && !sqlPassword.trim())}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-50"
                  >
                    {sqlMetadataRunning ? 'Searching...' : 'Search metadata'}
                  </button>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={sqlMetadataKinds.includes('table')} onChange={() => toggleMetadataKind('table')} />Tables</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={sqlMetadataKinds.includes('view')} onChange={() => toggleMetadataKind('view')} />Views</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={sqlMetadataKinds.includes('procedure')} onChange={() => toggleMetadataKind('procedure')} />Stored procedures</label>
                </div>

                {sqlMetadataResult && (
                  <div className={`rounded border px-3 py-2 text-xs ${sqlMetadataResult.ok ? 'border-cyan-800 bg-cyan-950/20 text-cyan-100' : 'border-red-800 bg-red-950/20 text-red-300'}`}>
                    {sqlMetadataResult.ok ? (
                      <>
                        <p>Objects: {sqlMetadataResult.count ?? 0} | {sqlMetadataResult.elapsedMs ?? 0} ms</p>
                        <div className="mt-2 max-h-56 overflow-auto border border-gray-800 rounded">
                          <table className="w-full text-left text-[11px]">
                            <thead className="bg-gray-950 text-gray-400">
                              <tr>
                                <th className="px-2 py-1 border-b border-gray-800">Schema</th>
                                <th className="px-2 py-1 border-b border-gray-800">Object</th>
                                <th className="px-2 py-1 border-b border-gray-800">Type</th>
                                <th className="px-2 py-1 border-b border-gray-800">Modified</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(sqlMetadataResult.items ?? []).map((item, idx) => (
                                <tr key={idx} className="odd:bg-gray-950/30">
                                  <td className="px-2 py-1 border-b border-gray-900 text-gray-300">{String((item as any).schemaName ?? '')}</td>
                                  <td className="px-2 py-1 border-b border-gray-900 text-gray-300">{String((item as any).objectName ?? '')}</td>
                                  <td className="px-2 py-1 border-b border-gray-900 text-gray-300">{String((item as any).objectType ?? '')}</td>
                                  <td className="px-2 py-1 border-b border-gray-900 text-gray-300">{String((item as any).modifiedAt ?? '')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : (
                      <p>Metadata search failed: {sqlMetadataResult.error ?? 'Unknown error'}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Org defaults</h2>
        <p className="text-xs text-gray-600">Pre-configured for Altera. Only change if you're on a different ADO instance.</p>
        <div className="space-y-2 text-xs font-mono text-gray-500 bg-gray-900 rounded-lg p-3 border border-gray-800">
          {Object.entries(ORG_DEFAULTS).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-gray-600 shrink-0">{k}:</span>
              <span className="text-gray-400 truncate">{v}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Bridge</h2>
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
          <p className="text-xs text-gray-300">
            Mode: <strong className="text-gray-100">{localBridgeMode ? 'Local fallback' : 'Managed website (enterprise)'}</strong>
          </p>
          <p className="text-xs mt-1">
            Bridge status:{' '}
            <strong className={bridgeReachable === true ? 'text-emerald-400' : bridgeReachable === false ? 'text-red-400' : 'text-gray-400'}>
              {bridgeReachable === true ? 'Connected' : bridgeReachable === false ? 'Not reachable' : 'Checking...'}
            </strong>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            End users should only open the DevAssist URL. Manual bridge commands are for support users only.
          </p>
        </div>

        <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-cyan-200">End-user action</p>
          <p className="text-xs text-cyan-100/90">
            {localBridgeMode
              ? 'You do not need terminal commands. Keep DevAssist Bridge running from Start menu and use the website. If analysis fails, click Run diagnostics below and share the result with support.'
              : 'No local commands required. Just use the managed DevAssist website URL.'}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-gray-400">Bridge URL</label>
          <input
            value={bridgeUrl}
            onChange={(e) => setBridgeUrl(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                       font-mono focus:outline-none focus:border-altera-teal"
            readOnly={!localBridgeMode}
          />
          <p className="text-xs text-gray-600">
            Default comes from VITE_BRIDGE_URL for enterprise deployments. If managed bridge is unreachable, app can fall back to localhost when available.
          </p>
        </div>

        {localBridgeMode && (
          <div className="rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-4 space-y-2" id="start-bridge-guide">
            <p className="text-xs font-semibold text-cyan-200">Bridge start command (end-user)</p>
            <p className="text-xs text-cyan-100/90">
              If header shows "Bridge update required" or "Bridge offline", run one command below, then reopen DevAssist.
            </p>
            <div className="text-xs font-mono text-altera-teal bg-gray-950 rounded p-2 overflow-x-auto space-y-2">
              <p className="text-[11px] text-gray-400 font-sans">Windows Run / Command Prompt</p>
              <p className="break-all">{START_BRIDGE_CMD}</p>
              <p className="text-[11px] text-gray-400 font-sans">PowerShell</p>
              <p className="break-all">{START_BRIDGE_POWERSHELL}</p>
            </div>
          </div>
        )}

        {localBridgeMode && localHostPage && (
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                <Terminal size={12} /> Support mode: local bridge commands
              </p>
              <button
                type="button"
                onClick={toggleSupportMode}
                className={`text-xs px-2.5 py-1 rounded-md border font-medium ${supportModeEnabled
                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                  : 'border-cyan-500/70 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25'}`}
              >
                {supportModeEnabled ? 'Disable support commands' : 'Enable support commands'}
              </button>
            </div>
            {supportModeEnabled && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-amber-300">For support engineers only.</p>
                  <button
                    type="button"
                    onClick={toggleBridgeCard}
                    className="text-xs px-2.5 py-1 rounded-md border border-cyan-500/70 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 font-medium"
                    aria-label={bridgeCardOpen ? 'Collapse bridge setup card' : 'Expand bridge setup card'}
                  >
                    <ChevronDown size={14} className={`transition-transform ${bridgeCardOpen ? '' : '-rotate-90'}`} />
                  </button>
                </div>
                {bridgeCardOpen && (
                  <>
                    <div className="text-xs font-mono text-altera-teal bg-gray-950 rounded p-2 overflow-x-auto space-y-2">
                      <p className="text-[11px] text-gray-400 font-sans">Command Prompt (cmd)</p>
                      <p className="break-all">{installCmds.cmd}</p>
                      <p className="text-[11px] text-gray-400 font-sans">PowerShell</p>
                      <p className="break-all">{installCmds.powershell}</p>
                    </div>
                    <p className="text-xs text-gray-600">
                      Local fallback only. Enterprise users should access DevAssist via managed website URL.
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {localBridgeMode && !localHostPage && (
          <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-amber-300">Support commands hidden on production website</p>
            <p className="text-xs text-amber-100/90">
              This page is in end-user mode. Local bridge commands are intentionally hidden here.
              If bridge recovery is needed, contact support.
            </p>
          </div>
        )}
      </section>

      <EnvironmentDiagnostics bridgeUrl={bridgeUrl} hasAdoPat={hasAdoPat} hasGithubPat={hasGithubPat} />
    </div>
  );
}

function EnvironmentDiagnostics({ bridgeUrl, hasAdoPat, hasGithubPat }: { bridgeUrl: string; hasAdoPat: boolean; hasGithubPat: boolean }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [lastRun, setLastRun] = useState<string>('');

  const runDiagnostics = async () => {
    setRunning(true);
    const out: DiagnosticResult[] = [];

    try {
      const statusRes = await fetch(`${bridgeUrl}/api/status`, { signal: AbortSignal.timeout(4000) });
      if (statusRes.ok) {
        const status = await statusRes.json() as { version?: string; snowAuth?: string; adoAuth?: string; githubAuth?: string };
        out.push({
          key: 'bridge',
          label: 'Bridge',
          ok: true,
          details: `Online${status.version ? ` (v${status.version})` : ''}`,
        });
        out.push({
          key: 'snow',
          label: 'SNOW',
          ok: status.snowAuth === 'ok',
          details: status.snowAuth === 'ok' ? 'Windows auth ready' : `Bridge reported: ${status.snowAuth ?? 'unknown'}`,
        });

        out.push({
          key: 'ado',
          label: 'ADO',
          ok: status.adoAuth === 'ok',
          details: status.adoAuth === 'ok'
            ? (hasAdoPat ? 'PAT saved on this device' : 'Bridge-managed credential ready')
            : 'PAT missing in Settings',
        });
        out.push({
          key: 'github',
          label: 'GitHub',
          ok: status.githubAuth === 'ok',
          details: status.githubAuth === 'ok'
            ? (hasGithubPat ? 'PAT saved on this device' : 'Bridge-managed credential ready')
            : 'PAT missing (optional)',
        });
      } else {
        out.push({ key: 'bridge', label: 'Bridge', ok: false, details: `HTTP ${statusRes.status}` });
        out.push({ key: 'snow', label: 'SNOW', ok: false, details: 'Bridge unavailable' });
      }
    } catch {
      out.push({ key: 'bridge', label: 'Bridge', ok: false, details: 'Unreachable (check URL / process)' });
      out.push({ key: 'snow', label: 'SNOW', ok: false, details: 'Bridge unavailable' });
    }

    setResults(out);
    setLastRun(new Date().toLocaleString());
    setRunning(false);
  };

  const allOk = results.length > 0 && results.every(r => r.ok || (r.key === 'github' && r.details.includes('optional')));

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Environment Diagnostics</h2>
        <button
          onClick={runDiagnostics}
          disabled={running}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run diagnostics'}
        </button>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 space-y-3">
        {results.length === 0 && (
          <p className="text-xs text-gray-600">
            Run diagnostics to verify this machine is ready: Bridge, SNOW, ADO, and GitHub.
          </p>
        )}

        {results.map((r) => (
          <div key={r.key} className="flex items-start justify-between gap-3 border-b border-gray-800 last:border-0 pb-2 last:pb-0">
            <div>
              <p className={`text-xs font-medium ${r.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {r.label}: {r.ok ? 'OK' : 'FAIL'}
              </p>
              <p className="text-xs text-gray-500">{r.details}</p>
            </div>
          </div>
        ))}

        {results.length > 0 && (
          <div className="pt-1">
            <p className={`text-xs font-medium ${allOk ? 'text-emerald-400' : 'text-yellow-500'}`}>
              {allOk ? 'System ready on this machine.' : 'Action needed before full analysis can run.'}
            </p>
            {lastRun && <p className="text-xs text-gray-600">Last run: {lastRun}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

// ── PAT input with show/hide + live test ──────────────────────────────────────

interface PatFieldProps {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  testUrl: string;
  testAuth: (v: string) => string;
  saved: boolean;
  onSave: (token: string) => Promise<void>;
  onClear: () => Promise<void>;
}

function PatField({ label, hint, value, onChange, testUrl, testAuth, saved, onSave, onClear }: PatFieldProps) {
  const [show, setShow] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [statusText, setStatusText] = useState('');
  const requestIdRef = useRef(0);

  const runValidation = async (token: string): Promise<boolean> => {
    const requestId = ++requestIdRef.current;
    setTestState('testing');
    setStatusText('Validating token...');
    try {
      const res = await fetch(testUrl, {
        headers: { Authorization: testAuth(token) },
        signal: AbortSignal.timeout(5000),
      });

      if (requestId !== requestIdRef.current) return false;

      if (res.ok) {
        setTestState('ok');
        setStatusText('Token looks valid.');
        return true;
      } else {
        setTestState('fail');
        setStatusText(`Token validation failed (HTTP ${res.status}).`);
      }
    } catch {
      if (requestId !== requestIdRef.current) return false;
      setTestState('fail');
      setStatusText('Token validation failed (network/bridge).');
    }
    return false;
  };

  const save = async () => {
    const token = value.trim();
    if (!token) return;
    const ok = await runValidation(token);
    if (ok) {
      await onSave(token);
      setStatusText('Saved on this device.');
    }
  };

  useEffect(() => {
    const token = value.trim();
    if (!token) {
      requestIdRef.current += 1;
      setTestState('idle');
      setStatusText('');
      return;
    }

    const handle = window.setTimeout(() => {
      void runValidation(token);
    }, 700);

    return () => {
      window.clearTimeout(handle);
    };
  }, [value, testUrl]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-gray-400">{label}</label>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${saved ? 'border-emerald-700 text-emerald-400 bg-emerald-950/30' : 'border-gray-700 text-gray-500 bg-gray-900'}`}>
          {saved ? 'Stored on this device' : 'Not stored'}
        </span>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={saved ? 'Enter a new token to replace the saved one' : 'Paste PAT here'}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:border-altera-teal pr-9"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!value || testState === 'testing'}
          className={`px-3 py-2 rounded text-xs font-medium border transition-colors w-full sm:w-auto ${
            testState === 'ok'
              ? 'border-emerald-700 text-emerald-400 bg-emerald-950/30'
              : testState === 'fail'
                ? 'border-red-700 text-red-400 bg-red-950/30'
                : 'border-gray-700 text-gray-400 hover:border-gray-500 disabled:opacity-40'
          }`}
        >
          {testState === 'ok' ? <Check size={14} /> : testState === 'fail' ? <AlertCircle size={14} /> : testState === 'testing' ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => { void onClear(); }}
          disabled={!saved && !value}
          className="px-3 py-2 rounded text-xs font-medium border border-gray-700 text-gray-400 hover:border-gray-500 disabled:opacity-40 w-full sm:w-auto"
        >
          Clear
        </button>
      </div>
      <p className="text-xs text-gray-600">{hint}</p>
      <p className={`text-xs ${saved ? 'text-emerald-400' : 'text-yellow-500'}`}>
        {saved ? 'Stored on this device via the local bridge.' : 'Not stored on this device yet.'}
      </p>
      {statusText && (
        <p className={`text-xs ${testState === 'ok' ? 'text-emerald-400' : testState === 'fail' ? 'text-red-400' : 'text-gray-500'}`}>
          {statusText}
        </p>
      )}
    </div>
  );
}
