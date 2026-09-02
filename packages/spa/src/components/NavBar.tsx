import { NavLink } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Bug, Database, Settings, RefreshCw } from 'lucide-react';
import BridgeStatus from './BridgeStatus';

const AUTO_UPDATE_KEY = 'devassist-auto-update-state';
const AUTO_UPDATE_MAX_ATTEMPTS = 3;
const AUTO_UPDATE_COOLDOWN_MS = 2 * 60 * 1000;

const links = [
  { to: '/triage',   label: 'Analysis', icon: Bug },
  { to: '/registry', label: 'Products', icon: Database },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function NavBar({ showSettings = true, deploymentMode = 'Local' }: { showSettings?: boolean; deploymentMode?: 'Managed' | 'Local Fallback' | 'Local' }) {
  const visibleLinks = showSettings ? links : links.filter((x) => x.to !== '/settings');
  const buildLabel = __APP_BUILD__;
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [autoRefreshing, setAutoRefreshing] = useState(false);

  const currentAssetName = useMemo(() => {
    const script = document.querySelector('script[type="module"][src*="/assets/index-"]') as HTMLScriptElement | null;
    const src = script?.src ?? '';
    const match = src.match(/index-[A-Za-z0-9_-]+\.js/);
    return match?.[0] ?? '';
  }, []);

  useEffect(() => {
    if (!currentAssetName) return;

    let cancelled = false;

    const triggerAutoRefresh = (latestAsset: string) => {
      try {
        const now = Date.now();
        const raw = sessionStorage.getItem(AUTO_UPDATE_KEY);
        const parsed = raw ? JSON.parse(raw) as { asset?: string; attempts?: number; lastAt?: number } : {};

        const sameAsset = parsed.asset === latestAsset;
        const attempts = sameAsset ? Number(parsed.attempts ?? 0) : 0;
        const lastAt = Number(parsed.lastAt ?? 0);
        const coolingDown = sameAsset && attempts >= AUTO_UPDATE_MAX_ATTEMPTS && (now - lastAt) < AUTO_UPDATE_COOLDOWN_MS;
        if (coolingDown) return;

        const nextAttempts = sameAsset ? attempts + 1 : 1;
        sessionStorage.setItem(AUTO_UPDATE_KEY, JSON.stringify({
          asset: latestAsset,
          attempts: nextAttempts,
          lastAt: now,
        }));

        setAutoRefreshing(true);
        const base = `${window.location.origin}${window.location.pathname}`;
        const hash = window.location.hash || '#/triage';
        const params = new URLSearchParams(window.location.search);
        params.set('v', String(now));
        params.set('asset', latestAsset);
        window.location.replace(`${base}?${params.toString()}${hash}`);
      } catch {
        // Ignore sessionStorage/JSON issues and keep manual refresh available.
      }
    };

    const checkForUpdate = async () => {
      try {
        const indexUrl = `${window.location.origin}${window.location.pathname}?check=${Date.now()}`;
        const res = await fetch(indexUrl, { cache: 'no-store' });
        if (!res.ok) return;
        const html = await res.text();
        const match = html.match(/index-[A-Za-z0-9_-]+\.js/);
        const latest = match?.[0] ?? '';
        if (!cancelled && latest && latest !== currentAssetName) {
          setUpdateAvailable(true);
          if (document.visibilityState === 'visible') {
            triggerAutoRefresh(latest);
          }
        }
      } catch {
        // Silent: connectivity issues should not interrupt normal use.
      }
    };

    // Initial check + periodic checks so users get a clear prompt when deployment finishes.
    void checkForUpdate();
    const timer = window.setInterval(() => { void checkForUpdate(); }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentAssetName]);

  const refreshLatest = () => {
    const base = `${window.location.origin}${window.location.pathname}`;
    const hash = window.location.hash || '#/triage';
    const bust = `v=${Date.now()}`;
    window.location.replace(`${base}?${bust}${hash}`);
  };

  return (
    <header className="sticky top-0 z-30 px-3 sm:px-4 py-3 border-b border-white/10 bg-slate-950/70 backdrop-blur-md">
      <div className="container mx-auto max-w-7xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between sm:justify-start gap-4 sm:gap-6 min-w-0">
          <div className="flex items-center gap-2 min-w-0 shrink">
            <span className="font-extrabold text-base sm:text-lg tracking-tight shrink-0 bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-400 bg-clip-text text-transparent">
              DevAssist
            </span>
            <span
              className="inline-flex max-w-[220px] sm:max-w-[280px] truncate rounded-full border border-cyan-400/25 bg-cyan-500/8 px-2 py-0.5 text-[10px] text-cyan-100/85"
              title={buildLabel}
            >
              {buildLabel}
            </span>
          </div>
          <nav className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
            {visibleLinks.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl text-xs sm:text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-gradient-to-r from-sky-600 to-blue-700 text-white shadow-md shadow-sky-900/40'
                      : 'text-gray-300 hover:text-white hover:bg-white/10'
                  }`
                }
              >
                <Icon size={14} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="self-start sm:self-auto flex items-center gap-2">
          {autoRefreshing && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/45 bg-cyan-500/15 px-2.5 py-1.5 text-xs text-cyan-100">
              Applying latest update...
            </span>
          )}
          {updateAvailable && (
            <button
              type="button"
              onClick={refreshLatest}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/45 bg-emerald-500/15 px-2.5 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/25"
              title="A newer DevAssist build is available"
            >
              New update available
            </button>
          )}
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              deploymentMode === 'Managed'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : deploymentMode === 'Local Fallback'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : 'border-slate-400/35 bg-slate-500/10 text-slate-200'
            }`}
            title={deploymentMode === 'Managed' ? 'Using managed enterprise bridge' : deploymentMode === 'Local Fallback' ? 'Managed bridge unavailable, using local fallback bridge' : 'Using local bridge mode'}
          >
            Mode: {deploymentMode}
          </span>
          <button
            type="button"
            onClick={refreshLatest}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/20"
            title="Refresh and fetch latest deployed build"
          >
            <RefreshCw size={12} />
            Refresh latest
          </button>
          <BridgeStatus />
        </div>
      </div>
    </header>
  );
}
