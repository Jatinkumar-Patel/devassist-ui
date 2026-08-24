import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import NavBar from './components/NavBar';
import SetupWizard from './components/SetupWizard';
import TriagePage from './pages/Triage';
import RegistryPage from './pages/Registry';
import SettingsPage from './pages/Settings';
import { useSettingsStore } from './store/settings';

export default function App() {
  const navigate = useNavigate();
  const adoPat = useSettingsStore((s) => s.adoPat);
  // Show wizard if no PAT has ever been set
  const [wizardDone, setWizardDone] = useWizardDone(!!adoPat);

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

/** Persist wizard-done state so it only shows once per browser */
function useWizardDone(alreadyHasPat: boolean): [boolean, (v: boolean) => void] {
  const key = 'devassist-setup-done';
  const [done, setDoneState] = [
    alreadyHasPat || localStorage.getItem(key) === '1',
    (v: boolean) => { if (v) localStorage.setItem(key, '1'); },
  ];
  return [done, setDoneState];
}
