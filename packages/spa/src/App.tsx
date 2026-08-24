import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import NavBar from './components/NavBar';
import SetupWizard from './components/SetupWizard';
import TriagePage from './pages/Triage';
import RegistryPage from './pages/Registry';
import SettingsPage from './pages/Settings';
import { useSettingsStore } from './store/settings';

export default function App() {
  const navigate = useNavigate();
  const { adoPat, setAdoPat, setGithubPat } = useSettingsStore();
  const [wizardDone, setWizardDone] = useState(!!adoPat || localStorage.getItem('devassist-setup-done') === '1');

  // On every startup, silently refresh PATs from mcp.json via bridge.
  // This means users never have to paste a PAT — it's always read from mcp.json.
  useEffect(() => {
    fetch('http://localhost:7447/api/mcp-config', { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null)
      .then(cfg => {
        if (!cfg?.found) return;
        if (cfg.adoPat)    { setAdoPat(cfg.adoPat); }
        if (cfg.githubPat) { setGithubPat(cfg.githubPat); }
        if (cfg.adoPat || cfg.githubPat) {
          localStorage.setItem('devassist-setup-done', '1');
          setWizardDone(true);
        }
      })
      .catch(() => { /* bridge not running — fall through to wizard */ });
  }, [setAdoPat, setGithubPat]);

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      {!wizardDone && (
        <SetupWizard onDone={() => { setWizardDone(true); navigate('/triage'); }} />
      )}
      <NavBar />
      <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl">
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
