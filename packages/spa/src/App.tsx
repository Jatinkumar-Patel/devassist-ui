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

  const deploymentMode: 'Managed' | 'Local Fallback' | 'Local' =
    MANAGED_BRIDGE_URL && !isLocalBridgeUrl(MANAGED_BRIDGE_URL)
      ? (isLocalBridgeUrl(bridgeUrl) ? 'Local Fallback' : 'Managed')
      : 'Local';

  // Enterprise-first behavior:
  // 1) Keep using configured bridge URL (typically managed service)
  // 2) If it is unreachable, automatically fall back to localhost bridge when available
  useEffect(() => {
    let cancelled = false;

    async function resolveBridge() {
      const configuredReachable = await isBridgeReachable(bridgeUrl, 1800);
      if (cancelled) return;

      if (configuredReachable) {
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
      <main className="flex-1 container mx-auto px-3 sm:px-5 py-4 sm:py-7 max-w-7xl">
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
