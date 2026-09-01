import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import NavBar from './components/NavBar';
import SetupWizard from './components/SetupWizard';
import TriagePage from './pages/Triage';
import RegistryPage from './pages/Registry';
import SettingsPage from './pages/Settings';
import { useSettingsStore } from './store/settings';
import { fetchSecretStatus } from './lib/secret-store';

// On GitHub Pages (HTTPS), probe local bridge. If alive, redirect immediately so
// the user never has to manually switch URLs again.
async function redirectToBridgeIfRunning(): Promise<boolean> {
  if (window.location.protocol !== 'https:') return false; // already on bridge or local
  const bridgeBase = 'http://localhost:7447';
  try {
    // Use no-cors: we only need to know the server is alive, not read the response
    await fetch(`${bridgeBase}/api/status`, { mode: 'no-cors', signal: AbortSignal.timeout(1500) });
    // If we get here the bridge responded — redirect preserving the hash route
    window.location.replace(`${bridgeBase}/${window.location.hash}`);
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const navigate = useNavigate();
  const { bridgeUrl, setSecretStatus } = useSettingsStore();
  const [wizardDone, setWizardDone] = useState(localStorage.getItem('devassist-setup-done') === '1');
  const [bridgeChecked, setBridgeChecked] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);

  // Auto-redirect to localhost:7447 if bridge is running (only relevant from GitHub Pages)
  useEffect(() => {
    redirectToBridgeIfRunning().then((redirected) => {
      if (!redirected) setBridgeChecked(true);
    });
  }, []);

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

  // On GitHub Pages, wait for the bridge probe before rendering anything
  // so the user doesn't see a flash of the setup wizard before the redirect
  if (window.location.protocol === 'https:' && !bridgeChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-3 h-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
          Connecting to local bridge…
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
      <NavBar showSettings={wizardDone} />
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
