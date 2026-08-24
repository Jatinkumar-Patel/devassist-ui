import { useState } from 'react';
import { Eye, EyeOff, Check, AlertCircle, Terminal, RefreshCw } from 'lucide-react';
import { useSettingsStore, ORG_DEFAULTS } from '../store/settings';

export default function SettingsPage() {
  const { adoPat, githubPat, bridgeUrl, setAdoPat, setGithubPat, setBridgeUrl, clearPats } = useSettingsStore();

  const reRunWizard = () => {
    localStorage.removeItem('devassist-setup-done');
    window.location.reload();
  };

  return (
    <div className="max-w-xl space-y-8">
      <div className="flex items-center justify-between">
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
          testUrl={`${ORG_DEFAULTS.bridgeUrl}/api/ado/SR/_apis/projects?api-version=7.0`}
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
          <p className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
            <Terminal size={12} /> Start the bridge on your machine
          </p>
          <pre className="text-xs font-mono text-altera-teal bg-gray-950 rounded p-2 overflow-x-auto">
            npx devassist-bridge
          </pre>
          <p className="text-xs text-gray-600">
            Runs a local server that proxies SNOW (Windows NTLM) and ADO calls.
            Must be running for SNOW data and ADO triage to work.
          </p>
        </div>
      </section>
    </div>
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

  const test = async () => {
    if (!value) return;
    setTestState('testing');
    try {
      const res = await fetch(testUrl, {
        headers: { Authorization: testAuth(value) },
        signal: AbortSignal.timeout(5000),
      });
      setTestState(res.ok ? 'ok' : 'fail');
    } catch {
      setTestState('fail');
    }
    setTimeout(() => setTestState('idle'), 4000);
  };

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-gray-400">{label}</label>
      <div className="flex gap-2">
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
          className={`px-3 py-2 rounded text-xs font-medium border transition-colors
            ${testState === 'ok'   ? 'border-emerald-700 text-emerald-400 bg-emerald-950/30' :
              testState === 'fail' ? 'border-red-700 text-red-400 bg-red-950/30' :
              'border-gray-700 text-gray-400 hover:border-gray-500 disabled:opacity-40'}`}
        >
          {testState === 'ok'      ? <Check size={14} /> :
           testState === 'fail'    ? <AlertCircle size={14} /> :
           testState === 'testing' ? '…' : 'Test'}
        </button>
      </div>
      <p className="text-xs text-gray-600">{hint}</p>
    </div>
  );
}
