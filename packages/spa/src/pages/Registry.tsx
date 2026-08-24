import { useEffect, useState } from 'react';
import { Package, GitBranch, TestTube2, PenLine } from 'lucide-react';
import { loadRegistry } from '../lib/product-registry';
import type { ProductRegistry, Product } from '../types';

export default function RegistryPage() {
  const [registry, setRegistry] = useState<ProductRegistry | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadRegistry().then(setRegistry).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="text-red-400 text-sm p-4 border border-red-800 rounded-lg bg-red-950/20">
        {error} — ensure <code className="font-mono">config/product-registry.json</code> is served.
      </div>
    );
  }

  if (!registry) {
    return <div className="text-gray-500 text-sm animate-pulse">Loading registry…</div>;
  }

  const active = registry.products.find((p) => p.id === selected);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
      {/* Product list */}
      <aside className="space-y-1">
        <p className="text-xs text-gray-500 px-2 pb-1">
          {registry.products.length} products · v{registry.version}
        </p>
        {registry.products.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelected(p.id)}
            className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center gap-2 ${
              p.id === selected
                ? 'bg-gray-800 text-gray-100'
                : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
            }`}
          >
            <Package size={13} className="shrink-0" />
            <span className="truncate">{p.displayName}</span>
          </button>
        ))}
      </aside>

      {/* Product detail */}
      <section>
        {active ? (
          <ProductDetail product={active} />
        ) : (
          <div className="text-gray-600 text-sm flex items-center justify-center h-48">
            Select a product to view its configuration.
          </div>
        )}
      </section>
    </div>
  );
}

function ProductDetail({ product }: { product: Product }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-gray-100 font-semibold text-lg">{product.displayName}</h2>
        <a
          href={`https://github.com/allscriptshealthcare/shared-skills/blob/main/${product.skillPath}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs flex items-center gap-1 text-altera-teal hover:text-white"
        >
          <PenLine size={12} /> Skill file
        </a>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <DefItem label="Area Path" value={product.areaPathPrefix} mono />
        <DefItem label="SNOW Product" value={product.snowProduct} />
        <DefItem label="SNOW Task Table" value={product.snowTaskTable} mono />
        <DefItem label="ID" value={product.id} mono />
      </dl>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <GitBranch size={12} /> Repositories ({product.repos.length})
        </h3>
        <div className="space-y-1">
          {product.repos.map((r) => (
            <a
              key={r.key}
              href={`https://github.com/${r.owner}/${r.repo}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between px-3 py-2 rounded bg-gray-900 hover:bg-gray-800 text-sm"
            >
              <span className="text-altera-teal font-mono">{r.owner}/{r.repo}</span>
              <span className={`text-xs ${r.required ? 'text-emerald-400' : 'text-gray-600'}`}>
                {r.required ? 'primary' : 'optional'}
              </span>
            </a>
          ))}
        </div>
      </section>

      {product.mtmPlans.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <TestTube2 size={12} /> MTM Test Plans
          </h3>
          <div className="space-y-1">
            {product.mtmPlans.map((plan) => (
              <div key={plan.id} className="flex items-center justify-between px-3 py-2 rounded bg-gray-900 text-sm">
                <span className="text-gray-200">{plan.name}</span>
                <span className="text-xs font-mono text-gray-500">#{plan.id}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DefItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`text-gray-200 ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value}</dd>
    </div>
  );
}
