import type { ProductRegistry, Product } from '../types';

const BRIDGE = (): string => (window as any).__BRIDGE_URL__ ?? 'http://localhost:7447';

let registry: ProductRegistry | null = null;

export async function loadRegistry(): Promise<ProductRegistry> {
  if (registry) return registry;
  // Try bridge first (user's saved copy), fall back to static file
  try {
    const res = await fetch(`${BRIDGE()}/api/registry`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) { registry = await res.json() as ProductRegistry; return registry; }
  } catch { /* bridge offline */ }
  const res = await fetch('/config/product-registry.json');
  if (!res.ok) throw new Error(`Failed to load product registry: ${res.status}`);
  registry = await res.json() as ProductRegistry;
  return registry;
}

export function invalidateRegistry() {
  registry = null;
}

export async function saveRegistry(data: ProductRegistry): Promise<void> {
  const res = await fetch(`${BRIDGE()}/api/registry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Save failed: ${await res.text()}`);
  registry = { ...data };  // update cache
}

export function routeByAreaPath(areaPath: string, reg: ProductRegistry, title?: string): Product | undefined {
  const lower = areaPath.toLowerCase();
  const titleLower = (title ?? '').toLowerCase();

  // Exact/prefix match first — most specific wins
  const candidates = reg.products
    .filter((p) => lower.startsWith(p.areaPathPrefix.toLowerCase().replace(/\\\\/g, '\\')))
    .sort((a, b) => b.areaPathPrefix.length - a.areaPathPrefix.length); // longest prefix wins

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
