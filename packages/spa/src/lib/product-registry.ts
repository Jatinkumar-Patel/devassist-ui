import type { ProductRegistry, Product } from '../types';

// Loaded once at startup from the repo's config/product-registry.json
// In dev: proxied via Vite; in prod: served from the same origin as the SPA
let registry: ProductRegistry | null = null;

export async function loadRegistry(): Promise<ProductRegistry> {
  if (registry) return registry;
  const res = await fetch('/config/product-registry.json');
  if (!res.ok) throw new Error(`Failed to load product registry: ${res.status}`);
  registry = await res.json() as ProductRegistry;
  return registry;
}

export function routeByAreaPath(areaPath: string, reg: ProductRegistry): Product | undefined {
  const lower = areaPath.toLowerCase();
  return reg.products.find((p) =>
    lower.startsWith(p.areaPathPrefix.toLowerCase().replace(/\\\\/g, '\\'))
  );
}
