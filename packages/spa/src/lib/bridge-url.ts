const DEFAULT_BRIDGE_URL = 'http://localhost:7447';

function normalize(url: string): string {
  return url.replace(/\/$/, '');
}

function fromWindowGlobal(): string | null {
  const w = window as any;
  const v = w.__BRIDGE_URL__;
  return typeof v === 'string' && v.trim() ? normalize(v.trim()) : null;
}

function fromPersistedSettings(): string | null {
  try {
    const raw = localStorage.getItem('devassist-settings');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const state = parsed?.state ?? parsed;
    const v = state?.bridgeUrl;
    return typeof v === 'string' && v.trim() ? normalize(v.trim()) : null;
  } catch {
    return null;
  }
}

export function getBridgeUrl(): string {
  return fromWindowGlobal() ?? fromPersistedSettings() ?? DEFAULT_BRIDGE_URL;
}

export function bridgeApi(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${getBridgeUrl()}${cleanPath}`;
}
