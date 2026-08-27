import { useState } from 'react';
import { CheckCircle2, ExternalLink, Eye, EyeOff, Wifi, Wand2 } from 'lucide-react';
import { useSettingsStore } from '../store/settings';
import { getBridgeUrl } from '../lib/bridge-url';
import { getBridgeInstallCommands } from '../lib/bridge-install';

interface Props {
  onDone: () => void;
}

type Step = 'bridge' | 'ado-pat' | 'github-pat' | 'done';

interface McpConfig {
  found: boolean;
  hasAdoPat: boolean;
  hasGithubPat: boolean;
  adoPat?: string | null;
  githubPat?: string | null;
  adoOrgUrl: string | null;
}

function CopyableCommand({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-400">{label}</p>
        <button
          type="button"
          onClick={copy}
          className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="font-mono text-sm text-altera-teal break-all">{value}</div>
    </div>
  );
}

export default function SetupWizard({ onDone }: Props) {
  const { setAdoPat, setGithubPat } = useSettingsStore();
  const bridgeBase = getBridgeUrl();
  const installCmds = getBridgeInstallCommands();
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
        const adoReady = Boolean(cfg?.hasAdoPat);
        const ghReady = Boolean(cfg?.hasGithubPat);

        if (adoReady && ghReady) {
          localStorage.setItem('devassist-setup-done', '1');
          setTimeout(() => setStep('done'), 300);
        } else if (!adoReady) {
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
              <h2 className="text-lg font-semibold text-gray-100">Set up the local bridge</h2>
              <p className="text-sm text-gray-400">
                The bridge is a tiny background service that connects to ServiceNow using your
                Windows login. Do this <strong className="text-gray-200">once</strong> — it will start
                automatically every time Windows starts. No daily commands needed.
              </p>

              {/* ── Phase A: First-time install ───────────────────── */}
              <div className="rounded-lg border border-blue-700/50 bg-blue-950/30 p-4 space-y-3">
                <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">Step 1 — Install once (new machine)</p>
                <p className="text-[11px] text-gray-400">Open a terminal, paste one of these commands and press Enter. Safe from any folder including System32.</p>
                <div className="bg-gray-950 rounded-lg p-3 border border-gray-800 space-y-3">
                  <CopyableCommand label="PowerShell (recommended)" value={installCmds.powershell} />
                  <CopyableCommand label="Command Prompt (cmd)" value={installCmds.cmd} />
                </div>
                <p className="text-[11px] text-gray-500">
                  Node.js ≥ 18 required —{' '}
                  <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-altera-teal hover:underline">download here</a>.
                  Clones the repo to <span className="font-mono">%USERPROFILE%\source\{installCmds.localFolder}</span> and starts bridge.
                </p>
              </div>

              {/* ── Phase B: Register auto-start ───────────────────── */}
              <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-4 space-y-3">
                <p className="text-xs font-semibold text-emerald-300 uppercase tracking-wide">Step 2 — Register auto-start (run after Step 1)</p>
                <p className="text-[11px] text-gray-400">
                  After Step 1 completes, paste this command to register the bridge as a Windows auto-start task.
                  After this, the bridge starts automatically at login — <strong className="text-gray-200">you never need to run any command again</strong>.
                </p>
                <div className="bg-gray-950 rounded-lg p-3 border border-gray-800 space-y-3">
                  <CopyableCommand label="Register auto-start — PowerShell (run once after Step 1)" value={installCmds.autoStartPowershell} />
                  <CopyableCommand label="Register auto-start — Command Prompt" value={installCmds.autoStartCmd} />
                </div>
                <p className="text-[11px] text-gray-500">
                  Registers a Windows Task Scheduler task for your user only (no admin needed).
                  Log file: <span className="font-mono">%USERPROFILE%\devassist-bridge.log</span>
                </p>
              </div>

              {/* ── Phase C: Bookmark URL ───────────────────── */}
              <div className="rounded-lg border border-altera-teal/40 bg-altera-teal/10 p-4 space-y-2">
                <p className="text-xs font-semibold text-altera-teal uppercase tracking-wide">Step 3 — Bookmark this URL</p>
                <p className="text-[11px] text-gray-400">After auto-start is registered, this is the only URL you need. Share it with your team.</p>
                <CopyableCommand label="App URL (bookmark this)" value={installCmds.appUrl} />
              </div>

              {window.location.protocol === 'https:' ? (
                <div className="space-y-2 pt-1">
                  <p className="text-[11px] text-gray-500 text-center">Already installed and auto-start registered? Click below.</p>
                  <a
                    href={bridgeBase}
                    className="flex items-center justify-center gap-2 bg-altera-blue hover:bg-altera-blue/80
                               text-white px-4 py-2.5 rounded-lg text-sm font-medium w-full"
                  >
                    <Wifi size={14} />
                    Open app at {bridgeBase}
                  </a>
                  <p className="text-[11px] text-gray-600 text-center">This only works after the bridge is running</p>
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
              {mcpConfig?.hasAdoPat ? (
                <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium">
                    <Wand2 size={14} />
                    Found in VS Code MCP config
                  </div>
                  <p className="text-xs text-gray-400">
                    ADO PAT is available to the local bridge from this machine configuration.
                    Token values are not exposed to the browser.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setStep('github-pat'); }}
                      className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-medium shrink-0"
                    >
                      Continue ✓
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">
                  No PAT found in your VS Code MCP config. Create one in ADO and paste it below.
                </p>
              )}

              {/* Manual creation guide — shown when not auto-detected */}
              {!mcpConfig?.hasAdoPat && (
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
                {mcpConfig?.hasAdoPat && (
                  <p className="text-xs text-gray-600">Or enter a different PAT:</p>
                )}
                <div className="relative">
                  <input
                    type={showAdo ? 'text' : 'password'}
                    value={adoVal}
                    onChange={(e) => { setAdoVal(e.target.value); setAdoOk(null); }}
                    placeholder={mcpConfig?.hasAdoPat ? 'Override PAT (optional)' : 'Paste your ADO PAT here'}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm
                               font-mono text-gray-200 focus:outline-none focus:border-altera-teal pr-9"
                  />
                  <button type="button" onClick={() => setShowAdo(!showAdo)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                    {showAdo ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {adoVal && !mcpConfig?.hasAdoPat && (
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
              {adoVal && mcpConfig?.hasAdoPat && (
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

              {!mcpConfig?.hasGithubPat && (
                <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3">
                  <p className="text-xs text-amber-200">
                    Could not find GitHub PAT in VS Code mcp.json on this VM. Please enter your GitHub PAT to continue.
                  </p>
                </div>
              )}

              {/* Auto-detected from mcp.json */}
              {mcpConfig?.hasGithubPat ? (
                <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium">
                    <Wand2 size={14} />
                    Found in VS Code MCP config
                  </div>
                  <p className="text-xs text-gray-400">
                    GitHub PAT is available to the local bridge from this machine configuration.
                    Token values are not exposed to the browser.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        localStorage.setItem('devassist-setup-done', '1');
                        setStep('done');
                      }}
                      className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-medium shrink-0"
                    >
                      Continue ✓
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">
                  Required for repository code/commit search during triage.
                </p>
              )}

              {!mcpConfig?.hasGithubPat && (
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
                  placeholder={mcpConfig?.hasGithubPat ? 'Override PAT' : 'Paste GitHub PAT'}
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
                For enterprise security, PATs are not persisted in browser storage.
                Preferred path is local bridge server-managed credentials from VS Code mcp.json.
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
