import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { detectInput } from '../lib/input-detector';
import { loadRegistry } from '../lib/product-registry';
import type { ProductRegistry } from '../types';

interface Props {
  onSubmit: (raw: string, selectedProductIds: string[]) => void;
  loading: boolean;
}

const PLACEHOLDERS = [
  'DA 9358329',
  'INC1234567',
  'TASK0001234',
  'CS7654321',
  '9358329',
];

export default function TriageInput({ onSubmit, loading }: Props) {
  const [value, setValue] = useState('');
  const [registry, setRegistry] = useState<ProductRegistry | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<'single' | 'multiple'>('multiple');
  const inputRef = useRef<HTMLInputElement>(null);

  const detected = value.trim() ? detectInput(value) : null;

  useEffect(() => {
    loadRegistry()
      .then((r) => {
        setRegistry(r);
        if (r.groups?.length) {
          const firstGroup = r.groups[0];
          setSelectedGroupId(firstGroup.id);
          const initial = firstGroup.productIds ?? [];
          setSelectedProductIds(initial.length ? initial : []);
          setSelectionMode(initial.length > 1 ? 'multiple' : 'single');
        } else {
          // If no groups are configured, default to all products.
          const all = (r.products ?? []).map((p) => p.id);
          setSelectedProductIds(all);
          setSelectionMode(all.length > 1 ? 'multiple' : 'single');
        }
      })
      .catch(() => {
        setRegistry(null);
      });
  }, []);

  const availableProducts = useMemo(() => registry?.products ?? [], [registry]);

  const groupOptions = useMemo(() => {
    const groups = registry?.groups ?? [];
    return [{ id: '', name: 'Custom selection' }, ...groups.map((g) => ({ id: g.id, name: g.name }))];
  }, [registry]);

  const setGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
    if (!groupId) return;
    const group = (registry?.groups ?? []).find((g) => g.id === groupId);
    if (!group) return;
    const ids = group.productIds.filter((id) => availableProducts.some((p) => p.id === id));
    setSelectedProductIds(ids);
    setSelectionMode(ids.length > 1 ? 'multiple' : 'single');
  };

  const toggleProduct = (productId: string) => {
    setSelectedGroupId('');
    setSelectionMode('multiple');
    setSelectedProductIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const setSingleProduct = (productId: string) => {
    setSelectedGroupId('');
    setSelectionMode('single');
    setSelectedProductIds(productId ? [productId] : []);
  };

  const handleModeChange = (mode: 'single' | 'multiple') => {
    setSelectionMode(mode);
    setSelectedGroupId('');
    if (mode === 'single' && selectedProductIds.length > 1) {
      setSelectedProductIds([selectedProductIds[0]]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) onSubmit(value.trim(), selectedProductIds);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      {registry && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Product group</label>
              <select
                value={selectedGroupId}
                onChange={(e) => setGroup(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 w-full"
              >
                {groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Selection mode</label>
              <select
                value={selectionMode}
                onChange={(e) => handleModeChange(e.target.value as 'single' | 'multiple')}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 w-full"
              >
                <option value="single">Single product</option>
                <option value="multiple">Multiple products</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px]">
            <span className="text-gray-500">Select product scope before analysis</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedGroupId('');
                  setSelectionMode('multiple');
                  setSelectedProductIds(availableProducts.map((p) => p.id));
                }}
                className="text-altera-teal hover:text-white"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => { setSelectedGroupId(''); setSelectedProductIds([]); }}
                className="text-gray-500 hover:text-gray-300"
              >
                Clear
              </button>
            </div>
          </div>

          {selectionMode === 'single' ? (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Product</label>
              <select
                value={selectedProductIds[0] ?? ''}
                onChange={(e) => setSingleProduct(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 w-full"
              >
                <option value="">Select product</option>
                {availableProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="max-h-44 overflow-auto space-y-1 pr-1">
              {availableProducts.map((p) => {
                const checked = selectedProductIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProduct(p.id)}
                    className={`w-full text-left px-2.5 py-1.5 rounded border text-xs transition-colors ${
                      checked
                        ? 'border-altera-teal/60 bg-altera-blue/10 text-gray-100'
                        : 'border-gray-800 bg-gray-900/30 text-gray-400 hover:text-gray-200 hover:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{p.displayName}</span>
                      <span className="font-mono text-[10px] text-gray-500">{p.id}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-gray-500">
            Selected: <span className="text-gray-300">{selectedProductIds.length}</span>
            {selectedProductIds.length === 0 && (
              <span className="ml-2 text-yellow-500">(auto route by area path)</span>
            )}
          </p>
        </div>
      )}

      <div className="relative flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Paste a work item ID, e.g. ${PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]}`}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 pr-24
                       text-gray-100 placeholder-gray-600 focus:outline-none focus:border-altera-teal
                       focus:ring-1 focus:ring-altera-teal text-sm"
          />
          {detected && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs bg-altera-blue/20 text-altera-teal px-2 py-0.5 rounded">
              {detected.type}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="flex items-center gap-2 bg-altera-blue hover:bg-altera-blue/80
                     disabled:opacity-40 disabled:cursor-not-allowed text-white
                     px-4 py-3 rounded-lg text-sm font-medium transition-colors justify-center w-full sm:w-auto"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>
    </form>
  );
}
