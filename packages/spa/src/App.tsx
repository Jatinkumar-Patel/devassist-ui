import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import NavBar from './components/NavBar';
import SetupWizard from './components/SetupWizard';
import TriagePage from './pages/Triage';
import RegistryPage from './pages/Registry';
import SettingsPage from './pages/Settings';
import { useSettingsStore } from './store/settings';
import { fetchSecretStatus } from './lib/secret-store';

const LOCAL_BRIDGE_URL = 'http://localhost:7447';
const MANAGED_BRIDGE_URL = ((import.meta as any).env?.VITE_BRIDGE_URL as string | undefined)?.trim() || '';
const STRICT_MANAGED = (((import.meta as any).env?.VITE_STRICT_MANAGED as string | undefined)?.trim() || '0') === '1';
const REQUIRED_LOCAL_BRIDGE_VERSION = '0.2.0';

type LocalBridgeNotice =
  | { type: 'offline' }
  | { type: 'outdated'; runningVersion: string };

function compareSemVer(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i += 1) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

function isLocalBridgeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

async function isBridgeReachable(baseUrl: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

export default function App() {
  const navigate = useNavigate();
  const { bridgeUrl, setBridgeUrl, setSecretStatus } = useSettingsStore();
  const [wizardDone, setWizardDone] = useState(localStorage.getItem('devassist-setup-done') === '1');
  const [bridgeChecked, setBridgeChecked] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  const [localBridgeNotice, setLocalBridgeNotice] = useState<LocalBridgeNotice | null>(null);

  const deploymentMode: 'Managed' | 'Local Fallback' | 'Local' =
    MANAGED_BRIDGE_URL && !isLocalBridgeUrl(MANAGED_BRIDGE_URL)
      ? (isLocalBridgeUrl(bridgeUrl) ? 'Local Fallback' : 'Managed')
      : 'Local';

  // Enterprise-first behavior:
  // 1) Keep using configured bridge URL (typically managed service)
  // 2) In strict managed mode, never fall back to localhost
  // 3) Otherwise, use localhost fallback when managed bridge is unreachable
  useEffect(() => {
    let cancelled = false;

    async function resolveBridge() {
      const configuredReachable = await isBridgeReachable(bridgeUrl, 1800);
      if (cancelled) return;

      if (configuredReachable) {
        setBridgeChecked(true);
        return;
      }

      if (STRICT_MANAGED && MANAGED_BRIDGE_URL && !isLocalBridgeUrl(MANAGED_BRIDGE_URL)) {
        setBridgeChecked(true);
        return;
      }

      if (!isLocalBridgeUrl(bridgeUrl)) {
        const localReachable = await isBridgeReachable(LOCAL_BRIDGE_URL, 1500);
        if (cancelled) return;
        if (localReachable) {
          setBridgeUrl(LOCAL_BRIDGE_URL);
        }
      }

      setBridgeChecked(true);
    }

    void resolveBridge();
    return () => { cancelled = true; };
  }, [bridgeUrl, setBridgeUrl]);

  useEffect(() => {
    let cancelled = false;

    async function refreshSecretStatus() {
      try {
        const status = await fetchSecretStatus();
        if (cancelled) return;
        setSecretStatus(status);
        if (status.hasAdoPat && status.hasGithubPat) {
          localStorage.setItem('devassist-setup-done', '1');
          setWizardDone(true);
        }
      } catch {
        // Non-fatal: the bridge may still be starting.
      }
    }

    void refreshSecretStatus();
    return () => { cancelled = true; };
  }, [setSecretStatus]);

  // First-run auto-check: if the connector is up and server-managed credentials
  // are already configured, skip the setup wizard automatically.
  useEffect(() => {
    let cancelled = false;
    async function checkServerManagedSetup() {
      if (wizardDone) {
        if (!cancelled) setSetupChecked(true);
        return;
      }
      try {
        const res = await fetch(`${bridgeUrl}/api/status`, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) return;
        const status = await res.json() as { adoAuth?: string; githubAuth?: string };
        const secretsReady = status.adoAuth === 'ok' && status.githubAuth === 'ok';
        if (secretsReady) {
          localStorage.setItem('devassist-setup-done', '1');
          if (!cancelled) setWizardDone(true);
        }
      } catch {
        // Non-fatal: user can still complete setup wizard manually.
      } finally {
        if (!cancelled) setSetupChecked(true);
      }
    }
    checkServerManagedSetup();
    return () => { cancelled = true; };
  }, [wizardDone, bridgeUrl]);

  useEffect(() => {
    let cancelled = false;

    const checkBridgeCompatibility = async () => {
      if (!isLocalBridgeUrl(bridgeUrl)) {
        if (!cancelled) setLocalBridgeNotice(null);
        return;
      }

      try {
        const res = await fetch(`${bridgeUrl}/api/status`, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) {
          if (!cancelled) setLocalBridgeNotice({ type: 'offline' });
          return;
        }

        const status = await res.json() as { version?: string };
        const runningVersion = String(status.version ?? '').trim() || 'unknown';
        if (runningVersion === 'unknown' || compareSemVer(runningVersion, REQUIRED_LOCAL_BRIDGE_VERSION) < 0) {
          if (!cancelled) setLocalBridgeNotice({ type: 'outdated', runningVersion });
          return;
        }

        if (!cancelled) setLocalBridgeNotice(null);
      } catch {
        if (!cancelled) setLocalBridgeNotice({ type: 'offline' });
      }
    };

    void checkBridgeCompatibility();
    const timer = window.setInterval(() => { void checkBridgeCompatibility(); }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [bridgeUrl]);

  // Wait for bridge resolution so users don't see transient setup noise.
  if (!bridgeChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-3 h-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
          Connecting to DevAssist services…
        </div>
      </div>
    );
  }

  // Avoid flashing setup UI while first-run checks are still in progress.
  if (!setupChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-3 h-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
          Preparing DevAssist…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {!wizardDone && (
        <SetupWizard onDone={() => { setWizardDone(true); navigate('/triage'); }} />
      )}
      <NavBar showSettings={wizardDone} deploymentMode={deploymentMode} />
      {wizardDone && localBridgeNotice && (
        <div className="border-b border-amber-700/50 bg-amber-950/55">
          <div className="container mx-auto max-w-7xl px-3 sm:px-5 py-2.5 text-xs sm:text-sm text-amber-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p>
              {localBridgeNotice.type === 'offline'
                ? 'Bridge is not running. Admin updates may not be available yet.'
                : `Bridge update required. Running v${localBridgeNotice.runningVersion}; required v${REQUIRED_LOCAL_BRIDGE_VERSION}+.`}
            </p>
            <a
              href="#/settings"
              className="inline-flex items-center justify-center rounded-md border border-amber-400/60 bg-amber-500/15 px-2.5 py-1 text-amber-100 hover:bg-amber-500/25"
            >
              Open Settings for Start Command
            </a>
          </div>
        </div>
      )}
      <main className="flex-1 w-full px-3 sm:px-4 py-4 sm:py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/triage" replace />} />
          <Route path="/triage" element={<TriagePage />} />
          <Route path="/registry" element={<RegistryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
