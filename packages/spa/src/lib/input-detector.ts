import type { InputType } from '../types';

// Pattern → type → numeric id extraction
const PATTERNS: Array<{ re: RegExp; type: InputType; extractId: (m: RegExpMatchArray) => string }> = [
  { re: /\b(DA[-\s]?)(\d{6,})\b/i,       type: 'DA',   extractId: (m) => m[2] },
  { re: /\b(INC)(\d{7,})\b/i,             type: 'INC',  extractId: (m) => `${m[1]}${m[2]}` },
  { re: /\b(TASK)(\d{7,})\b/i,            type: 'TASK', extractId: (m) => `${m[1]}${m[2]}` },
  { re: /\b(CS)(\d{7,})\b/i,              type: 'CS',   extractId: (m) => `${m[1]}${m[2]}` },
  { re: /\b(KB)(\d{4,})\b/i,              type: 'KB',   extractId: (m) => `${m[1]}${m[2]}` },
  { re: /^\s*(\d{6,})\s*$/,               type: 'TFS',  extractId: (m) => m[1] },
];

export interface DetectedInput {
  type: InputType;
  id: string;
  raw: string;
}

export function detectInput(raw: string): DetectedInput {
  const trimmed = raw.trim();
  for (const { re, type, extractId } of PATTERNS) {
    const m = trimmed.match(re);
    if (m) return { type, id: extractId(m), raw: trimmed };
  }
  return { type: 'unknown', id: trimmed, raw: trimmed };
}
