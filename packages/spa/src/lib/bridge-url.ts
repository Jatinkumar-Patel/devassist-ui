const DEFAULT_BRIDGE_URL = 'http://localhost:7447';

function normalize(url: string): string {
  return url.replace(/\/$/, '');
}

function fromEnv(): string | null {
  const v = (import.meta as any).env?.VITE_BRIDGE_URL;
  return typeof v === 'string' && v.trim() ? normalize(v.trim()) : null;
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

function sameOriginApiBase(): string | null {
  if (typeof window === 'undefined') return null;
  const { origin, hostname } = window.location;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isGitHubPages = hostname.endsWith('github.io');
  if (isLocalHost || isGitHubPages) return null;
  return normalize(origin);
}

function fromQueryParam(): string | null {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('bridgeUrl');
  return v && v.trim() ? normalize(v.trim()) : null;
}

export function getBridgeUrl(): string {
  return (
    fromWindowGlobal() ??
    fromQueryParam() ??
    fromPersistedSettings() ??
    fromEnv() ??
    sameOriginApiBase() ??
    DEFAULT_BRIDGE_URL
  );
}

export function bridgeApi(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${getBridgeUrl()}${cleanPath}`;
}
