import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, Mic, MicOff } from 'lucide-react';
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
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const detected = value.trim() ? detectInput(value) : null;

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() ?? '';
      if (transcript) setValue(transcript.replace(/\s+/g, ' '));
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setVoiceSupported(true);
  }, []);

  useEffect(() => {
    loadRegistry()
      .then((r) => {
        setRegistry(r);
        if (r.groups?.length) {
          const firstGroup = r.groups[0];
          setSelectedGroupId(firstGroup.id);
          setSelectedProductIds(firstGroup.productIds ?? []);
        } else {
          // If no groups are configured, default to all products.
          setSelectedProductIds((r.products ?? []).map((p) => p.id));
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
    setSelectedProductIds(group.productIds.filter((id) => availableProducts.some((p) => p.id === id)));
  };

  const updateProductsFromDropdown = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
    setSelectedGroupId('');
    setSelectedProductIds(selected);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) onSubmit(value.trim(), selectedProductIds);
  };

  const toggleVoice = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listening) {
      recognition.stop();
      setListening(false);
      return;
    }
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      {registry && (
        <div className="glass-panel rounded-2xl p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-300 mb-1">Product group</label>
              <select
                value={selectedGroupId}
                onChange={(e) => setGroup(e.target.value)}
                className="bg-slate-950/70 border border-white/15 rounded-xl px-3 py-2 text-sm text-gray-100 w-full"
              >
                {groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-300 mb-1">Products (multi-select)</label>
              <select
                multiple
                size={Math.min(7, Math.max(4, availableProducts.length || 4))}
                value={selectedProductIds}
                onChange={updateProductsFromDropdown}
                className="bg-slate-950/70 border border-white/15 rounded-xl px-3 py-2 text-sm text-gray-100 w-full"
              >
                {availableProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px]">
            <span className="text-gray-400">Select product scope before analysis</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedGroupId('');
                  setSelectedProductIds(availableProducts.map((p) => p.id));
                }}
                className="text-cyan-300 hover:text-white"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => { setSelectedGroupId(''); setSelectedProductIds([]); }}
                className="text-gray-400 hover:text-gray-200"
              >
                Clear
              </button>
            </div>
          </div>

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
            className="w-full bg-slate-950/70 border border-white/15 rounded-xl px-4 py-3 pr-28
                       text-gray-100 placeholder-gray-500 focus:outline-none focus:border-cyan-400
                       focus:ring-1 focus:ring-cyan-400 text-sm"
          />
          {detected && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs bg-cyan-400/20 text-cyan-200 px-2 py-0.5 rounded">
              {detected.type}
            </span>
          )}
        </div>
        {voiceSupported && (
          <button
            type="button"
            onClick={toggleVoice}
            className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border transition-colors w-full sm:w-auto ${
              listening
                ? 'border-rose-400/60 bg-rose-500/20 text-rose-100'
                : 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20'
            }`}
          >
            {listening ? <MicOff size={16} /> : <Mic size={16} />}
            {listening ? 'Stop voice' : 'Voice input'}
          </button>
        )}
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="flex items-center gap-2 bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-500 hover:to-blue-600
                     disabled:opacity-40 disabled:cursor-not-allowed text-white
                     px-5 py-3 rounded-xl text-sm font-semibold transition-colors justify-center w-full sm:w-auto"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      {voiceSupported && (
        <p className="text-[11px] text-gray-400 px-1">
          Tip: Tap Voice input and speak DA, INC, TASK, or CS number. Great for mobile and hands-free use.
        </p>
      )}
    </form>
  );
}
