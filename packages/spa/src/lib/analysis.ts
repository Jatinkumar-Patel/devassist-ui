import type { AdoWorkItem, Product, TriageAnalysis } from '../types';

// ── Pattern definitions from areas/sunrise-mobile/analysis-playbook.md ───────

interface Pattern {
  id: string;
  name: string;
  keywords: string[];         // match against DA title + description (case-insensitive)
  verdict: TriageAnalysis['verdict'];
  searchSeeds: string[];      // GitHub code search terms
  fixDirection: string;
  confidence: TriageAnalysis['confidence'];
}

const SUNRISE_MOBILE_PATTERNS: Pattern[] = [
  {
    id: 'sm-1',
    name: 'SCMLib lock contention (med-pass)',
    keywords: ['lock', 'med-pass', 'medication', 'spinning wheel', 'slow', 'LockWithTimeout', 'GetTaskForm', 'MarkTaskDone'],
    verdict: 'CODE BUG',
    searchSeeds: ['LockWithTimeout', 'SCMLibServiceManager', 'lock granted', 'GetTaskForm'],
    fixDirection: 'Increase IIS web-garden worker count (e.g. 4→6) to reduce lock contention.',
    confidence: 'Medium',
  },
  {
    id: 'sm-2',
    name: 'Client timeout + duplicate retry',
    keywords: ['timeout', 'timed out', 'duplicate', 'retry', 'progress indicator', 'Client service error'],
    verdict: 'CODE BUG',
    searchSeeds: ['LogTraceInfo', 'progress indicator', 'RecycleClient', 'timed out'],
    fixDirection: 'Connection recycle + backoff + longer timeout + idempotent retry (RecycleClient on transport error).',
    confidence: 'Medium',
  },
  {
    id: 'sm-3',
    name: 'Patient-select client hang (spinning wheel)',
    keywords: ['spinning wheel', 'spinner', 'patient list', 'patient select', 'GetPatientVisit', 'endless', 'hang'],
    verdict: 'CODE BUG',
    searchSeeds: ['overlay', 'spinner', 'watchdog', 'GetPatientVisit', 'progress indicator'],
    fixDirection: 'Client-side overlay/spinner code — spinner can be left stuck. See Defect 9377813.',
    confidence: 'High',
  },
  {
    id: 'sm-4',
    name: 'App-domain / cold-start stall',
    keywords: ['app-domain', 'cold start', 'app pool', 'recycle', 'warm', 'Application_Start', 'startup'],
    verdict: 'CONFIG / INSTALL',
    searchSeeds: ['Application_Start', 'preloadEnabled', 'startMode', 'LoadAzureAppConfigKeyVaultSecrets'],
    fixDirection: 'IIS warmup: set app pool startMode=AlwaysRunning, site preloadEnabled=true.',
    confidence: 'Medium',
  },
  {
    id: 'sm-5',
    name: 'Barcode scanner / device hardware',
    keywords: ['barcode', 'scanner', 'scan', 'Zebra', 'Honeywell', 'AsReader', 'device'],
    verdict: 'CODE BUG',
    searchSeeds: ['AsReaderBarcodeScannerPlugin', 'ConnectBarcodeScanner', 'barcode'],
    fixDirection: 'Check scanner heartbeat/connect timing. Review device-specific plugin code.',
    confidence: 'Low',
  },
  {
    id: 'sm-6',
    name: 'Auth / logout / SSO',
    keywords: ['logout', 'login', 'SSO', 'Imprivata', 'SecureAuth', 'MSAL', 'Azure AD', 'token', 'session expired'],
    verdict: 'CODE BUG',
    searchSeeds: ['MSAL', 'logout', 'Imprivata', 'SecureAuth', 'substituteUserSession'],
    fixDirection: 'Review MSAL/OIDC logout path and federated sign-out flow.',
    confidence: 'Low',
  },
];

// ── Pattern matching ──────────────────────────────────────────────────────────

export function matchPattern(adoItem: AdoWorkItem): Pattern | null {
  const text = [
    adoItem.fields['System.Title'] ?? '',
    adoItem.fields['System.Description'] ?? '',
    adoItem.fields['Allscripts.Field.DevAssistDetail'] ?? '',
  ].join(' ').toLowerCase();

  let best: Pattern | null = null;
  let bestScore = 0;

  for (const p of SUNRISE_MOBILE_PATTERNS) {
    const score = p.keywords.filter((k) => text.includes(k.toLowerCase())).length;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return bestScore > 0 ? best : null;
}

// ── Phase 3: Code search ──────────────────────────────────────────────────────

export interface CodeHit {
  repo: string;
  path: string;
  url: string;
  snippet?: string;
}

// Route GitHub search through bridge to avoid CORS from localhost
const BRIDGE = (): string => (window as any).__BRIDGE_URL__ ?? 'http://localhost:7447';

export async function runCodeSearch(
  githubPat: string,
  product: Product,
  pattern: Pattern
): Promise<CodeHit[]> {
  const repos = product.repos
    .filter((r) => r.required)
    .map((r) => `${r.owner}/${r.repo}`);

  if (!repos.length || !githubPat) return [];

  const hits: CodeHit[] = [];

  for (const seed of pattern.searchSeeds.slice(0, 3)) {
    try {
      const repoQ = repos.map((r) => `repo:${r}`).join(' ');
      const q = encodeURIComponent(`${seed} ${repoQ}`);
      // Proxy through bridge to avoid CORS — bridge forwards with Bearer token
      const res = await fetch(
        `${BRIDGE()}/api/gh-search/code?q=${q}&per_page=10`,
        { headers: { 'X-GitHub-Token': githubPat } }
      );
      if (!res.ok) continue;
      const result = await res.json() as {
        items?: Array<{ repository: { full_name: string }; path: string; html_url: string }>;
      };
      for (const item of (result.items ?? []).slice(0, 3)) {
        hits.push({ repo: item.repository.full_name, path: item.path, url: item.html_url });
      }
    } catch { /* non-fatal */ }
  }

  const seen = new Set<string>();
  return hits.filter((h) => { if (seen.has(h.path)) return false; seen.add(h.path); return true; });
}

// ── Phase 4: Build assessment ─────────────────────────────────────────────────

export function buildAssessment(
  adoItem: AdoWorkItem,
  pattern: Pattern | null,
  codeHits: CodeHit[],
  snowWorkNotes?: string
): TriageAnalysis {
  const title = adoItem.fields['System.Title'] ?? '';
  const customer = adoItem.fields['Allscripts.Field.CustomerName'] ?? 'the client';
  const version = adoItem.fields['Allscripts.Field.SupportVersion'] ?? 'unknown';

  const snowEvidence: string[] = [];
  if (snowWorkNotes) {
    // Extract first meaningful lines from work notes
    const lines = String(snowWorkNotes)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 20 && !l.startsWith('['));
    snowEvidence.push(...lines.slice(0, 3));
  }

  const codeAnalysis = codeHits.length
    ? codeHits.map((h) => `${h.repo}: ${h.path}`).join('\n')
    : 'Code search pending — see mapped repos';

  const blindSpots = [
    'Device-side logs are hard to get on mobile; absence is expected',
    'Client traces in HWS are anonymized — cannot tie to specific user',
    ...(codeHits.length === 0 ? ['No code hits found — repos may not be cloned locally'] : []),
  ];

  const l2Draft = pattern
    ? `Thank you for contacting Altera support.\n\n` +
      `Pattern identified: ${pattern.name}.\n\n` +
      `Fix direction: ${pattern.fixDirection}\n\n` +
      `Please provide the following to confirm:\n` +
      `1. HWSSyslogger logs covering the exact incident window from all nodes\n` +
      `2. SCM + HWS version numbers\n` +
      `3. IIS app pool configuration (maxWorkerProcesses, recycle schedule)`
    : undefined;

  return {
    verdict: pattern?.verdict ?? 'NEED MORE INFO',
    confidence: pattern?.confidence ?? 'Low',
    clientReported: `${customer} reports: ${title} (Release ${version})`,
    snowEvidence,
    codeAnalysis,
    gap: pattern
      ? `Matched pattern "${pattern.name}". ${pattern.fixDirection}`
      : 'No matching pattern found. Manual analysis required.',
    blindSpots,
    l2Draft,
  };
}
