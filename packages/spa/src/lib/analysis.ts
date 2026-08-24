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

/** Match against ALL patterns (mobile + SHM + future areas) */
export function matchPattern(adoItem: AdoWorkItem): Pattern | null {
  const text = [
    adoItem.fields['System.Title'] ?? '',
    adoItem.fields['System.Description'] ?? '',
    adoItem.fields['Allscripts.Field.DevAssistDetail'] ?? '',
  ].join(' ').toLowerCase();

  let best: Pattern | null = null;
  let bestScore = 0;

  for (const p of ALL_PATTERNS) {
    const score = p.keywords.filter((k) => text.includes(k.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; best = p; }
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

// ── SHM Patterns ──────────────────────────────────────────────────────────────
const SHM_PATTERNS: Pattern[] = [
  {
    id: 'shm-1',
    name: 'SHM Send button disabled / grayed out',
    keywords: ['send button', 'send is disabled', 'grayed out', 'grey', 'disabled', 'compose', 'SHM', 'secure health message', 'recipient'],
    verdict: 'CODE BUG',
    searchSeeds: ['SendButton', 'isDisabled', 'SHM', 'ComposeMessage', 'recipient'],
    fixDirection: 'Check the Send button enabled/disabled state logic. The button should enable after a valid recipient is selected. Look for the condition that evaluates recipient validity.',
    confidence: 'Medium',
  },
];

const ALL_PATTERNS = [...SUNRISE_MOBILE_PATTERNS, ...SHM_PATTERNS];

/** Match pattern against any product — checks all known patterns */
export function matchPatternAny(adoItem: AdoWorkItem): Pattern | null {
  const text = [
    adoItem.fields['System.Title'] ?? '',
    adoItem.fields['System.Description'] ?? '',
    adoItem.fields['Allscripts.Field.DevAssistDetail'] ?? '',
  ].join(' ').toLowerCase();
  let best: Pattern | null = null;
  let bestScore = 0;
  for (const p of ALL_PATTERNS) {
    const score = p.keywords.filter((k) => text.includes(k.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return bestScore > 0 ? best : null;
}
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

// ── Phase 4: Build assessment with actual evidence ───────────────────────────

export function buildAssessment(
  adoItem: AdoWorkItem,
  pattern: Pattern | null,
  codeHits: CodeHit[],
  snowWorkNotes?: string,
  logHits?: Array<{ seed: string; text: string; file: string }>,
  topSeeds?: Record<string, number>
): TriageAnalysis {
  const f = adoItem.fields;
  const title = f['System.Title'] ?? '';
  const customer = f['Allscripts.Field.CustomerName'] ?? 'the client';
  const version = f['Allscripts.Field.SupportVersion'] ?? 'unknown';
  const description = String(f['System.Description'] ?? f['Allscripts.Field.DevAssistDetail'] ?? '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // ── 1. Extract SNOW evidence — parse work notes for diagnostic signals ──────
  const snowEvidence: string[] = [];
  if (snowWorkNotes) {
    const text = String(snowWorkNotes);
    // Extract meaningful lines: errors, versions, reproduction steps, support actions
    const evidenceLines = text.split(/\n|\\n/)
      .map(l => l.replace(/\[.*?\]/g, '').trim())
      .filter(l => l.length > 15 && (
        /error|exception|fail|cannot|unable|version|repro|confirm|observed|occur|steps|workaround|found|checked|tested/i.test(l)
      ))
      .slice(0, 5);
    snowEvidence.push(...evidenceLines);

    // Also extract version numbers mentioned
    const versions = text.match(/\d+\.\d+(\.\d+)?([\s.-]PR\d+)?/g)?.slice(0, 3) ?? [];
    if (versions.length) snowEvidence.push(`Versions mentioned: ${versions.join(', ')}`);
  }

  // ── 2. Extract log evidence — key signals from log scan ──────────────────────
  const logEvidence: string[] = [];
  if (topSeeds && Object.keys(topSeeds).length > 0) {
    const top3 = Object.entries(topSeeds).sort(([,a],[,b]) => b-a).slice(0,5);
    logEvidence.push(`Log signals: ${top3.map(([s,c]) => `${s} (${c}×)`).join(', ')}`);

    // Server health: if GetPatientVisit/GetSelected complete quickly vs client timeouts
    const hasTimeout = topSeeds['progress indicator has timed out'] ?? 0;
    const hasLock = topSeeds['LockWithTimeout'] ?? 0;
    const hasOps = (topSeeds['GetSelectedVisitDataAndObservations'] ?? 0) + (topSeeds['GetPatientVisit'] ?? 0);
    if (hasTimeout > 0) logEvidence.push(`CLIENT timeout confirmed: "progress indicator has timed out" found ${hasTimeout}×`);
    if (hasLock > 100)  logEvidence.push(`LOCK CONTENTION: LockWithTimeout ${hasLock}× — IIS worker queue is backing up`);
    if (hasOps > 0 && hasTimeout > 0) logEvidence.push(`Server completed ops (${hasOps}× hits) but client timed out → server is healthy, issue is CLIENT-SIDE`);
  }
  if (logHits && logHits.length > 0) {
    const keyHit = logHits.find(h => h.seed === 'progress indicator has timed out' || h.seed === 'FATAL' || h.seed === 'Exception');
    if (keyHit) logEvidence.push(`Key log line: "${keyHit.text.slice(0,150)}"`);
  }

  // ── 3. Code analysis ─────────────────────────────────────────────────────────
  let codeAnalysis: string;
  if (codeHits.length > 0) {
    codeAnalysis = codeHits.map(h => `${h.repo}: ${h.path}`).join('\n');
  } else if (pattern) {
    codeAnalysis = `Search seeds: ${pattern.searchSeeds.join(', ')}\nRepos to inspect: ${
      adoItem.fields['System.AreaPath']?.includes('SHM') ? 'plhlt-aimanager-npm (SHM component)' :
      adoItem.fields['System.AreaPath']?.includes('MobileX') ? 'SunriseMobile + sunrise-mobilewebservices' :
      'Check product registry for mapped repos'
    }`;
  } else {
    // No pattern — derive from symptom keywords
    const symptomTerms = title.match(/\b(button|disable|grey|spinner|slow|error|fail|cannot|send|compose)\b/gi) ?? [];
    codeAnalysis = `No pattern matched. Symptom keywords: ${[...new Set(symptomTerms)].join(', ')}\nSearch for these terms in mapped repos.`;
  }

  // ── 4. Gap: what the code does vs what it should ─────────────────────────────
  let gap: string;
  if (pattern) {
    gap = pattern.fixDirection;
    // Enrich gap with log evidence
    if (logEvidence.length > 0 && pattern.id.startsWith('sm-')) {
      gap += ` Log evidence supports this: ${logEvidence[0]}`;
    }
  } else {
    // Build gap from DA description + SNOW evidence
    const problemCore = description.slice(0, 200) || title;
    gap = `No pre-defined pattern matched. Problem: "${problemCore}". ` +
      (snowEvidence.length > 0
        ? `SNOW adds: ${snowEvidence[0]}`
        : 'Review SNOW work notes and logs for more context before drawing a conclusion.');
  }

  // ── 5. Confidence + blind spots ───────────────────────────────────────────────
  let confidence = pattern?.confidence ?? 'Low';
  const blindSpots: string[] = [];

  // Raise confidence if log evidence confirms pattern
  if (logEvidence.some(l => l.includes('CLIENT timeout confirmed')) && pattern?.id === 'sm-3') {
    confidence = 'High';
  }
  // Lower confidence if no logs and no SNOW evidence
  if (!snowWorkNotes && !logHits?.length) {
    confidence = confidence === 'High' ? 'Medium' : 'Low';
    blindSpots.push('No log files available — attach HWS logs for the incident window to raise confidence');
  }
  if (!codeHits.length) {
    blindSpots.push('Code search found no hits — clone the mapped repos locally for deeper inspection');
  }
  if (!pattern) {
    blindSpots.push('No pattern matched — this symptom class may need a new pattern added to analysis.ts');
    blindSpots.push('Consider escalating to the area dev (SHM/SCM team) for domain context');
  }
  if (!snowEvidence.length && snowWorkNotes) {
    blindSpots.push('Work notes present but no diagnostic evidence extracted — review them manually');
  }

  // ── 6. L2 draft ───────────────────────────────────────────────────────────────
  const verdict = pattern?.verdict ?? 'NEED MORE INFO';
  let l2Draft: string | undefined;
  if (verdict === 'NEED MORE INFO') {
    l2Draft = `Thank you for contacting Altera support.\n\n` +
      `We have reviewed the information provided. To proceed with analysis, please provide:\n\n` +
      `1. ${!logHits?.length ? 'Log files covering the exact incident window (see the area guide for which logs to collect)' : 'Additional log context if the attached logs do not cover the full incident window'}\n` +
      `2. Exact ${version} build version\n` +
      `3. Steps to reproduce on a test/dev environment\n` +
      `4. Whether this affects all users or specific users/sites`;
  } else if (verdict === 'CODE BUG') {
    l2Draft = `Thank you for contacting Altera support.\n\n` +
      `Issue identified: ${pattern?.name ?? title}\n\n` +
      `Analysis: ${gap}\n\n` +
      `Confidence: ${confidence}${blindSpots.length > 0 ? `\nNote: ${blindSpots[0]}` : ''}`;
  }

  return {
    verdict,
    confidence: confidence as TriageAnalysis['confidence'],
    clientReported: `${customer} reports (${version}): ${title}`,
    snowEvidence: [...snowEvidence, ...logEvidence],
    codeAnalysis,
    gap,
    blindSpots,
    l2Draft,
  };
}
