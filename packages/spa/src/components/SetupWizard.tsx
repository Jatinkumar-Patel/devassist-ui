import { useState } from 'react';
import { CheckCircle2, ExternalLink, Eye, EyeOff, Wifi, Wand2 } from 'lucide-react';
import { useSettingsStore } from '../store/settings';
import { getBridgeUrl } from '../lib/bridge-url';

interface Props {
  onDone: () => void;
}

type Step = 'bridge' | 'ado-pat' | 'github-pat' | 'done';

interface McpConfig {
  found: boolean;
  adoPat: string | null;
  githubPat: string | null;
  adoOrgUrl: string | null;
}

export default function SetupWizard({ onDone }: Props) {
  const { setAdoPat, setGithubPat } = useSettingsStore();
  const bridgeBase = getBridgeUrl();
  const [step, setStep] = useState<Step>('bridge');
  const [adoVal, setAdoVal]       = useState('');
  const [githubVal, setGithubVal] = useState('');
  const [showAdo, setShowAdo]     = useState(false);
  const [showGh, setShowGh]       = useState(false);
  const [adoOk, setAdoOk]         = useState<boolean | null>(null);
  const [bridgeOk, setBridgeOk]   = useState<boolean | null>(null);
  const [testing, setTesting]     = useState(false);
  const [mcpConfig, setMcpConfig] = useState<McpConfig | null>(null);

  // After bridge connects, fetch mcp.json PATs automatically
  const loadMcpConfig = async (): Promise<McpConfig | null> => {
    try {
      const r = await fetch(`${bridgeBase}/api/mcp-config`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        const cfg: McpConfig = await r.json();
        setMcpConfig(cfg);
        // Pre-fill inputs if PATs found
        if (cfg.adoPat)    setAdoVal(cfg.adoPat);
        if (cfg.githubPat) setGithubVal(cfg.githubPat);
        return cfg;
      }
      return null;
    } catch {
      return null;
    }
  };

  const checkBridge = async () => {
    setTesting(true);
    // If on HTTPS (GitHub Pages), bridge calls are blocked by mixed-content policy.
    // Redirect to the bridge's local HTTP URL which serves the same app.
    if (window.location.protocol === 'https:') {
      window.location.href = bridgeBase;
      return;
    }
    try {
      const r = await fetch(`${bridgeBase}/api/status`, { signal: AbortSignal.timeout(3000) });
      const ok = r.ok;
      setBridgeOk(ok);
      if (ok) {
        const cfg = await loadMcpConfig();
        const ado = cfg?.adoPat?.trim() ?? '';
        const gh = cfg?.githubPat?.trim() ?? '';

        if (ado) setAdoPat(ado);
        if (gh) setGithubPat(gh);

        if (ado && gh) {
          localStorage.setItem('devassist-setup-done', '1');
          setTimeout(() => setStep('done'), 300);
        } else if (!ado) {
          setTimeout(() => setStep('ado-pat'), 600);
        } else {
          setTimeout(() => setStep('github-pat'), 600);
        }
      }
    } catch {
      setBridgeOk(false);
    } finally {
      setTesting(false);
    }
  };

  const testAdoPat = async () => {
    const pat = adoVal.trim();
    if (!pat) return;
    setTesting(true);
    try {
      const r = await fetch(`${bridgeBase}/api/ado/_apis/projects?api-version=6.0`, {
        headers: { Authorization: `Basic ${btoa(`:${pat}`)}` },
        signal: AbortSignal.timeout(5000),
      });
      setAdoOk(r.ok);
      if (r.ok) {
        setAdoPat(pat);
        setTimeout(() => setStep('github-pat'), 600);
      }
    } catch {
      setAdoOk(false);
    } finally {
      setTesting(false);
    }
  };

  const saveAdoAndContinue = () => {
    const pat = adoVal.trim();
    if (!pat) return;
    setAdoPat(pat);
    setStep('github-pat');
  };

  const saveGithubAndContinue = () => {
    const pat = githubVal.trim();
    if (!pat) return;
    setGithubPat(pat);
    localStorage.setItem('devassist-setup-done', '1');
    setStep('done');
  };

  return (
    <div className="fixed inset-0 bg-gray-950/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg shadow-2xl">

        {/* Progress dots */}
        <div className="flex gap-2 justify-center pt-6 pb-2">
          {(['bridge', 'ado-pat', 'github-pat', 'done'] as Step[]).map((s) => (
            <div key={s} className={`h-1.5 w-8 rounded-full transition-colors ${
              s === step ? 'bg-altera-teal' : step > s ? 'bg-altera-blue' : 'bg-gray-700'
            }`} />
          ))}
        </div>

        <div className="p-6 space-y-4">

          {/* ── Step 1: Bridge ──────────────────────────────────────────────── */}
          {step === 'bridge' && (
            <>
              <h2 className="text-lg font-semibold text-gray-100">Start the local bridge</h2>
              <p className="text-sm text-gray-400">
                The bridge is a tiny local server that connects to ServiceNow using your
                Windows login. It runs on your machine — nothing is sent to any cloud.
              </p>
              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-medium">End-user start (no repo clone):</p>
                <div className="bg-gray-950 rounded-lg p-3 font-mono text-sm text-altera-teal border border-gray-800">
                  npx @jatinkumar-patel/devassist-bridge
                </div>
              </div>
              <p className="text-xs text-gray-600">
                Open a new terminal, paste the command above, and press Enter.
                Node.js ≥ 18 required —{' '}
                <a href="https://nodejs.org" target="_blank" rel="noreferrer"
                   className="text-altera-teal hover:underline">download here</a>.
              </p>
              {window.location.protocol === 'https:' ? (
                <div className="rounded-lg border border-altera-teal/40 bg-altera-teal/10 p-4 space-y-3">
                  <p className="text-sm text-altera-teal font-medium">✓ You're on GitHub Pages</p>
                  <p className="text-xs text-gray-400">
                    Once the bridge is running on your machine, open the app directly at the bridge URL.
                    Browsers block connections from HTTPS pages to local HTTP servers.
                  </p>
                  <a
                    href={bridgeBase}
                    className="flex items-center justify-center gap-2 bg-altera-blue hover:bg-altera-blue/80
                               text-white px-4 py-2.5 rounded-lg text-sm font-medium w-full"
                  >
                    <Wifi size={14} />
                    Open app at {bridgeBase}
                  </a>
                  <p className="text-xs text-gray-600 text-center">Bridge must be running first (see command above)</p>
                </div>
              ) : (
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={checkBridge}
                    disabled={testing}
                    className="flex items-center gap-2 bg-altera-teal/20 border border-altera-teal/40 hover:bg-altera-teal/30
                               text-altera-teal px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    <Wifi size={14} />
                    {testing ? 'Checking…' : 'Check connection'}
                  </button>
                  {bridgeOk === true  && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={13} /> Connected!</span>}
                  {bridgeOk === false && <span className="text-xs text-red-400">Not found — is the bridge running?</span>}
                </div>
              )}
            </>
          )}

          {/* ── Step 2: ADO PAT ─────────────────────────────────────────────── */}
          {step === 'ado-pat' && (
            <>
              <h2 className="text-lg font-semibold text-gray-100">Azure DevOps PAT</h2>

              {mcpConfig?.found === false && (
                <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3">
                  <p className="text-xs text-amber-200">
                    Could not find PAT in VS Code mcp.json on this VM. Please enter your ADO PAT to continue.
                  </p>
                </div>
              )}

              {/* Auto-detected from mcp.json */}
              {mcpConfig?.adoPat ? (
                <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium">
                    <Wand2 size={14} />
                    Found in VS Code MCP config
                  </div>
                  <p className="text-xs text-gray-400">
                    Detected your ADO PAT from <span className="font-mono text-gray-300">mcp.json</span>.
                    Click <strong className="text-white">Use it</strong> to confirm, or paste a different one below.
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-500 bg-gray-800 rounded px-2 py-1 flex-1 truncate">
                      {'•'.repeat(12)}{mcpConfig.adoPat.slice(-4)}
                    </span>
                    <button
                      onClick={() => { setAdoPat(mcpConfig.adoPat!); setStep('github-pat'); }}
                      className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-medium shrink-0"
                    >
                      Use it ✓
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">
                  No PAT found in your VS Code MCP config. Create one in ADO and paste it below.
                </p>
              )}

              {/* Manual creation guide — shown when not auto-detected */}
              {!mcpConfig?.adoPat && (
                <ol className="text-xs text-gray-400 space-y-1.5 list-decimal list-inside bg-gray-800/50 rounded-lg p-3">
                  <li>Open ADO:
                    <a href="https://alm-prod-app1.rd.allscripts.com/tfs/boc_projects" target="_blank" rel="noreferrer"
                       className="text-altera-teal ml-1 hover:underline inline-flex items-center gap-0.5">
                      alm-prod-app1 <ExternalLink size={10} />
                    </a>
                  </li>
                  <li>Top-right → <strong className="text-gray-300">User Settings → Personal access tokens</strong></li>
                  <li>New token → name <strong className="text-gray-300">"DevAssist UI"</strong></li>
                  <li>Scopes: <strong className="text-gray-300">Work Items (Read)</strong> · <strong className="text-gray-300">Code (Read)</strong></li>
                  <li>Copy and paste below</li>
                </ol>
              )}

              {/* Always show manual input so user can override */}
              <div className="space-y-1.5">
                {mcpConfig?.adoPat && (
                  <p className="text-xs text-gray-600">Or enter a different PAT:</p>
                )}
                <div className="relative">
                  <input
                    type={showAdo ? 'text' : 'password'}
                    value={adoVal}
                    onChange={(e) => { setAdoVal(e.target.value); setAdoOk(null); }}
                    placeholder={mcpConfig?.adoPat ? 'Override PAT (optional)' : 'Paste your ADO PAT here'}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm
                               font-mono text-gray-200 focus:outline-none focus:border-altera-teal pr-9"
                  />
                  <button type="button" onClick={() => setShowAdo(!showAdo)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                    {showAdo ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {adoVal && !mcpConfig?.adoPat && (
                <div className="flex items-center gap-3">
                  <button onClick={testAdoPat} disabled={testing}
                    className="bg-altera-blue hover:bg-altera-blue/80 disabled:opacity-40 text-white
                               px-4 py-2 rounded-lg text-sm font-medium">
                    {testing ? 'Testing…' : 'Test & Continue'}
                  </button>
                  {adoOk === true  && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={13} /> Valid!</span>}
                  {adoOk === false && <span className="text-xs text-red-400">Invalid — check the token and VPN</span>}
                </div>
              )}
              {adoVal && mcpConfig?.adoPat && (
                <button onClick={testAdoPat} disabled={testing}
                  className="bg-altera-blue hover:bg-altera-blue/80 disabled:opacity-40 text-white
                             px-4 py-2 rounded-lg text-sm font-medium text-xs">
                  {testing ? 'Testing…' : 'Use this PAT instead'}
                </button>
              )}
            </>
          )}

          {/* ── Step 3: GitHub PAT (required) ───────────────────────────────── */}
          {step === 'github-pat' && (
            <>
              <h2 className="text-lg font-semibold text-gray-100">GitHub PAT</h2>

              {!mcpConfig?.githubPat && (
                <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3">
                  <p className="text-xs text-amber-200">
                    Could not find GitHub PAT in VS Code mcp.json on this VM. Please enter your GitHub PAT to continue.
                  </p>
                </div>
              )}

              {/* Auto-detected from mcp.json */}
              {mcpConfig?.githubPat ? (
                <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium">
                    <Wand2 size={14} />
                    Found in VS Code MCP config
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-500 bg-gray-800 rounded px-2 py-1 flex-1 truncate">
                      {'•'.repeat(12)}{mcpConfig.githubPat.slice(-4)}
                    </span>
                    <button
                      onClick={() => {
                        const pat = mcpConfig.githubPat!;
                        setGithubVal(pat);
                        setGithubPat(pat);
                        localStorage.setItem('devassist-setup-done', '1');
                        setStep('done');
                      }}
                      className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-medium shrink-0"
                    >
                      Use it ✓
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">
                  Required for repository code/commit search during triage.
                </p>
              )}

              {!mcpConfig?.githubPat && (
                <ol className="text-xs text-gray-400 space-y-1.5 list-decimal list-inside bg-gray-800/50 rounded-lg p-3">
                  <li>Go to <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer"
                     className="text-altera-teal hover:underline">github.com/settings/tokens</a></li>
                  <li>Generate new token (classic) → name <strong className="text-gray-300">"DevAssist UI"</strong></li>
                  <li>Scopes: <strong className="text-gray-300">repo (read)</strong></li>
                </ol>
              )}

              <div className="relative">
                <input
                  type={showGh ? 'text' : 'password'}
                  value={githubVal}
                  onChange={(e) => setGithubVal(e.target.value)}
                  placeholder={mcpConfig?.githubPat ? 'Override PAT' : 'Paste GitHub PAT'}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm
                             font-mono text-gray-200 focus:outline-none focus:border-altera-teal pr-9"
                />
                <button type="button" onClick={() => setShowGh(!showGh)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                  {showGh ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={saveGithubAndContinue}
                  disabled={!githubVal.trim()}
                  className="bg-altera-blue hover:bg-altera-blue/80 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Save & Continue
                </button>
              </div>
            </>
          )}

          {/* ── Done ────────────────────────────────────────────────────────── */}
          {step === 'done' && (
            <>
              <div className="flex items-center gap-3">
                <CheckCircle2 size={28} className="text-emerald-400 shrink-0" />
                <h2 className="text-lg font-semibold text-gray-100">You're set up!</h2>
              </div>
              <p className="text-sm text-gray-400">
                Paste a DA ID, SNOW task, or TFS work item number in the Triage page to get started.
              </p>
              <p className="text-xs text-gray-600">
                Your PATs are stored only in this browser on this machine for this user profile.
                On the same VM and user login, you will not be asked again unless PATs are cleared.
              </p>
              <button onClick={onDone}
                className="w-full bg-altera-blue hover:bg-altera-blue/80 text-white py-2.5 rounded-lg text-sm font-medium mt-2">
                Go to Triage
              </button>
            </>
          )}

          {step === 'ado-pat' && (
            <div className="flex gap-3">
              <button
                onClick={saveAdoAndContinue}
                disabled={!adoVal.trim()}
                className="bg-altera-blue hover:bg-altera-blue/80 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Save & Continue
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
