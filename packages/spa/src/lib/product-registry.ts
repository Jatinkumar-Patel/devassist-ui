import type { ProductRegistry, Product } from '../types';
import { bridgeApi } from './bridge-url';

let registry: ProductRegistry | null = null;

function staticRegistryUrl(): string {
  const base = (import.meta as any).env?.BASE_URL ?? '/';
  return `${base.replace(/\/$/, '')}/config/product-registry.json`;
}

export async function loadRegistry(): Promise<ProductRegistry> {
  if (registry) return registry;
  // Try bridge first (user's saved copy), fall back to static file
  try {
    const res = await fetch(bridgeApi('/api/registry'), { signal: AbortSignal.timeout(3000) });
    if (res.ok) { registry = await res.json() as ProductRegistry; return registry; }
  } catch { /* bridge offline */ }
  const res = await fetch(staticRegistryUrl());
  if (!res.ok) throw new Error(`Failed to load product registry: ${res.status}`);
  registry = await res.json() as ProductRegistry;
  return registry;
}

export function invalidateRegistry() {
  registry = null;
}

export async function saveRegistry(data: ProductRegistry): Promise<void> {
  const res = await fetch(bridgeApi('/api/registry'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Save failed: ${await res.text()}`);
  registry = { ...data };  // update cache
}

function normalizeAreaPath(value: string): string {
  return value
    .replace(/\\\\/g, '\\')
    .trim()
    .replace(/^\\+|\\+$/g, '')
    .toLowerCase();
}

function areaPathMatchesPrefix(areaPath: string, prefix: string): boolean {
  const area = normalizeAreaPath(areaPath);
  const base = normalizeAreaPath(prefix);
  if (!area || !base) return false;
  return area === base || area.startsWith(`${base}\\`);
}

export function routeByAreaPath(areaPath: string, reg: ProductRegistry, title?: string): Product | undefined {
  const lower = areaPath.toLowerCase();
  const titleLower = (title ?? '').toLowerCase();

  // Exact/prefix match first — most specific wins
  const candidates = reg.products
    .filter((p) => {
      const prefixes = [p.areaPathPrefix, ...(p.areaPathPrefixes ?? [])]
        .map((x) => x.toLowerCase().replace(/\\\\/g, '\\'))
        .filter(Boolean);
      return prefixes.some((prefix) => areaPathMatchesPrefix(lower, prefix));
    })
    .sort((a, b) => {
      const maxA = Math.max(...[a.areaPathPrefix, ...(a.areaPathPrefixes ?? [])].map((x) => x.length));
      const maxB = Math.max(...[b.areaPathPrefix, ...(b.areaPathPrefixes ?? [])].map((x) => x.length));
      return maxB - maxA;
    }); // longest matching prefix wins

  if (candidates.length === 1) return candidates[0];

  // Multiple candidates (e.g. SR\SCM\Ambulatory matches both SHM and Compass) — use title keywords
  if (candidates.length > 1) {
    const byTitle = candidates.find((p) => titleLower.includes(p.id) || titleLower.includes(p.displayName.toLowerCase()));
    return byTitle ?? candidates[0];
  }

  // No prefix match — try title keywords as fallback (e.g. area path is parent but title names the product)
  if (titleLower.includes('shm') || titleLower.includes('secure health mess')) {
    return reg.products.find((p) => p.id === 'shm');
  }
  if (titleLower.includes('compass')) return reg.products.find((p) => p.id === 'compass-scm');
  if (titleLower.includes('clindoc') || titleLower.includes('clinical doc')) return reg.products.find((p) => p.id === 'clindoc-scm');

  return undefined;
}
