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
  const { adoPat, githubPat } = useSettingsStore();
  const [wizardDone, setWizardDone] = useState(
    (localStorage.getItem('devassist-setup-done') === '1') || (!!adoPat && !!githubPat)
  );

  useEffect(() => {
    const done = (!!adoPat && !!githubPat);
    if (done) {
      localStorage.setItem('devassist-setup-done', '1');
      setWizardDone(true);
    } else {
      localStorage.removeItem('devassist-setup-done');
      setWizardDone(false);
    }
  }, [adoPat, githubPat]);

  return (
    <div className="min-h-screen flex flex-col">
      {!wizardDone && (
        <SetupWizard onDone={() => { setWizardDone(true); navigate('/triage'); }} />
      )}
      <NavBar />
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
