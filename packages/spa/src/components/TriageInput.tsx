import { useState, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { detectInput } from '../lib/input-detector';

interface Props {
  onSubmit: (raw: string) => void;
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
  const inputRef = useRef<HTMLInputElement>(null);

  const detected = value.trim() ? detectInput(value) : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative flex items-center gap-3">
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
                     px-4 py-3 rounded-lg text-sm font-medium transition-colors"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>
    </form>
  );
}
