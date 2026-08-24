import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import type { BridgeStatus } from '../types';
import { useSettingsStore } from '../store/settings';

export default function BridgeStatus() {
  const bridgeUrl = useSettingsStore((s) => s.bridgeUrl);
  const [status, setStatus] = useState<BridgeStatus>({ bridge: 'offline' });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${bridgeUrl}/api/status`, { signal: AbortSignal.timeout(3000) });
        if (!cancelled) setStatus(res.ok ? await res.json() : { bridge: 'offline' });
      } catch {
        if (!cancelled) setStatus({ bridge: 'offline' });
      }
    };
    check();
    const iv = setInterval(check, 15_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [bridgeUrl]);

  const ok = status.bridge === 'ok';
  return (
    <div
      className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${
        ok
          ? 'border-emerald-700 text-emerald-400 bg-emerald-950/40'
          : 'border-red-800 text-red-400 bg-red-950/40'
      }`}
      title={ok ? `Bridge v${status.version} · SNOW: ${status.snowAuth}` : 'Bridge offline — run: npx devassist-bridge'}
    >
      {ok ? <Wifi size={12} /> : <WifiOff size={12} />}
      {ok ? 'Bridge' : 'Bridge offline'}
    </div>
  );
}
