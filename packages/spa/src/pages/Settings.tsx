import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Check, AlertCircle, Terminal, RefreshCw, ChevronDown } from 'lucide-react';
import { useSettingsStore, ORG_DEFAULTS } from '../store/settings';
import { getBridgeInstallCommands } from '../lib/bridge-install';

interface DiagnosticResult {
  key: 'bridge' | 'snow' | 'ado' | 'github';
  label: string;
  ok: boolean;
  details: string;
}

export default function SettingsPage() {
  const { adoPat, githubPat, openaiKey, bridgeUrl, setAdoPat, setGithubPat, setOpenaiKey, setBridgeUrl, clearPats } = useSettingsStore();
  const installCmds = getBridgeInstallCommands();
  const [bridgeCardOpen, setBridgeCardOpen] = useState<boolean>(() => localStorage.getItem('devassist-settings-bridge-open') !== '0');

  const reRunWizard = () => {
    localStorage.removeItem('devassist-setup-done');
    window.location.reload();
  };

  const toggleBridgeCard = () => {
    setBridgeCardOpen((prev) => {
      const next = !prev;
      localStorage.setItem('devassist-settings-bridge-open', next ? '1' : '0');
      return next;
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
          Stored only in this browser's localStorage; never sent to any server other than ADO / GitHub directly.
        </p>
        <PatField
          label="Azure DevOps PAT"
          hint="Scopes needed: Work Items (Read) · Code (Read)"
          value={adoPat}
          onChange={setAdoPat}
          testUrl={`${bridgeUrl}/api/ado/_apis/projects?api-version=6.0`}
          testAuth={(v) => `Basic ${btoa(`:${v}`)}`}
        />
        <PatField
          label="GitHub PAT"
          hint="Scopes needed: repo (read only)"
          value={githubPat}
          onChange={setGithubPat}
          testUrl="https://api.github.com/user"
          testAuth={(v) => `Bearer ${v}`}
        />
        <PatField
          label="OpenAI API Key"
          hint="sk-… — enables inline AI analysis in the app (optional). Get one at platform.openai.com"
          value={openaiKey}
          onChange={setOpenaiKey}
          testUrl="https://api.openai.com/v1/models"
          testAuth={(v) => `Bearer ${v}`}
        />
        <button onClick={clearPats}
          className="text-xs text-red-500 hover:text-red-400 border border-red-900 hover:border-red-700 px-3 py-1.5 rounded-lg">
          Clear all PATs
        </button>
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
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400">Bridge URL</label>
          <input
            value={bridgeUrl}
            onChange={(e) => setBridgeUrl(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200
                       font-mono focus:outline-none focus:border-altera-teal"
          />
          <p className="text-xs text-gray-600">Default: http://localhost:7447</p>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
              <Terminal size={12} /> Start the bridge on your machine
            </p>
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
                Runs a local server that proxies SNOW (Windows NTLM) and ADO calls.
                Must be running for SNOW data and ADO triage to work.
              </p>
            </>
          )}
        </div>
      </section>

      <EnvironmentDiagnostics bridgeUrl={bridgeUrl} adoPat={adoPat} githubPat={githubPat} />
    </div>
  );
}

function EnvironmentDiagnostics({ bridgeUrl, adoPat, githubPat }: { bridgeUrl: string; adoPat: string; githubPat: string }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [lastRun, setLastRun] = useState<string>('');

  const runDiagnostics = async () => {
    setRunning(true);
    const out: DiagnosticResult[] = [];

    try {
      const statusRes = await fetch(`${bridgeUrl}/api/status`, { signal: AbortSignal.timeout(4000) });
      if (statusRes.ok) {
        const status = await statusRes.json() as { version?: string; snowAuth?: string };
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
      } else {
        out.push({ key: 'bridge', label: 'Bridge', ok: false, details: `HTTP ${statusRes.status}` });
        out.push({ key: 'snow', label: 'SNOW', ok: false, details: 'Bridge unavailable' });
      }
    } catch {
      out.push({ key: 'bridge', label: 'Bridge', ok: false, details: 'Unreachable (check URL / process)' });
      out.push({ key: 'snow', label: 'SNOW', ok: false, details: 'Bridge unavailable' });
    }

    if (adoPat.trim()) {
      try {
        const token = btoa(`:${adoPat.trim()}`);
        const adoRes = await fetch(`${bridgeUrl}/api/ado/_apis/projects?api-version=6.0`, {
          headers: { Authorization: `Basic ${token}` },
          signal: AbortSignal.timeout(6000),
        });
        out.push({
          key: 'ado',
          label: 'ADO',
          ok: adoRes.ok,
          details: adoRes.ok ? 'PAT valid' : `HTTP ${adoRes.status}`,
        });
      } catch {
        out.push({ key: 'ado', label: 'ADO', ok: false, details: 'Request failed (VPN/network/bridge)' });
      }
    } else {
      out.push({ key: 'ado', label: 'ADO', ok: false, details: 'PAT missing in Settings' });
    }

    if (githubPat.trim()) {
      try {
        const ghRes = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${githubPat.trim()}` },
          signal: AbortSignal.timeout(6000),
        });
        out.push({
          key: 'github',
          label: 'GitHub',
          ok: ghRes.ok,
          details: ghRes.ok ? 'PAT valid' : `HTTP ${ghRes.status}`,
        });
      } catch {
        out.push({ key: 'github', label: 'GitHub', ok: false, details: 'Request failed (network/proxy)' });
      }
    } else {
      out.push({ key: 'github', label: 'GitHub', ok: false, details: 'PAT missing (optional)' });
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
}

function PatField({ label, hint, value, onChange, testUrl, testAuth }: PatFieldProps) {
  const [show, setShow] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [statusText, setStatusText] = useState('');
  const requestIdRef = useRef(0);

  const runValidation = async (token: string) => {
    const requestId = ++requestIdRef.current;
    setTestState('testing');
    setStatusText('Validating token...');
    try {
      const res = await fetch(testUrl, {
        headers: { Authorization: testAuth(token) },
        signal: AbortSignal.timeout(5000),
      });

      if (requestId !== requestIdRef.current) return;

      if (res.ok) {
        setTestState('ok');
        setStatusText('Token looks valid.');
      } else {
        setTestState('fail');
        setStatusText(`Token validation failed (HTTP ${res.status}).`);
      }
    } catch {
      if (requestId !== requestIdRef.current) return;
      setTestState('fail');
      setStatusText('Token validation failed (network/bridge).');
    }
  };

  const test = async () => {
    const token = value.trim();
    if (!token) return;
    await runValidation(token);
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
      <label className="text-xs text-gray-400">{label}</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Paste PAT here"
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm
                       text-gray-200 font-mono focus:outline-none focus:border-altera-teal pr-9"
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
          onClick={test}
          disabled={!value || testState === 'testing'}
          className={`px-3 py-2 rounded text-xs font-medium border transition-colors w-full sm:w-auto
            ${testState === 'ok'   ? 'border-emerald-700 text-emerald-400 bg-emerald-950/30' :
              testState === 'fail' ? 'border-red-700 text-red-400 bg-red-950/30' :
              'border-gray-700 text-gray-400 hover:border-gray-500 disabled:opacity-40'}`}
        >
          {testState === 'ok'      ? <Check size={14} /> :
           testState === 'fail'    ? <AlertCircle size={14} /> :
           testState === 'testing' ? '…' : 'Retest'}
        </button>
      </div>
      <p className="text-xs text-gray-600">{hint}</p>
      {statusText && (
        <p className={`text-xs ${testState === 'ok' ? 'text-emerald-400' : testState === 'fail' ? 'text-red-400' : 'text-gray-500'}`}>
          {statusText}
        </p>
      )}
    </div>
  );
}
