import { useEffect, useState } from 'react';
import { ClipboardCopy, Code2, Loader2, CheckCircle2, AlertTriangle, HelpCircle, Wrench, Lightbulb, Sparkles, GitCommit, Bug, TestTube, Mail, Printer, Download } from 'lucide-react';
import type { TriageAnalysis, TriageSession } from '../types';
import { matchPattern, runCodeSearch, runDatabaseRepoSearch, buildSkillDrivenAssessment } from '../lib/analysis';
import { useSettingsStore } from '../store/settings';
import { snowVal } from '../lib/snow-client';
import { getBridgeUrl } from '../lib/bridge-url';

interface Props {
  session: TriageSession;
  onAnalysisComplete: (analysis: TriageAnalysis) => void;
}

const VERDICT_STYLE: Record<string, { icon: React.ReactNode; color: string }> = {
  'CODE BUG':         { icon: <Wrench size={14} />,       color: 'text-gray-300 border-gray-800 bg-gray-950/70' },
  'CONFIG / INSTALL': { icon: <Wrench size={14} />,       color: 'text-gray-300 border-gray-800 bg-gray-950/70' },
  'INTENDED BEHAVIOR':{ icon: <CheckCircle2 size={14} />, color: 'text-gray-300 border-gray-800 bg-gray-950/70' },
  'ENHANCEMENT':      { icon: <Lightbulb size={14} />,    color: 'text-gray-300 border-gray-800 bg-gray-950/70' },
  'NEED MORE INFO':   { icon: <HelpCircle size={14} />,   color: 'text-gray-300 border-gray-800 bg-gray-950/70' },
};

function normalizeEvidenceValue(v?: string): string {
  const text = decodeHtmlEntities(String(v ?? '')).trim();
  return text && text !== 'null' && text !== 'undefined' ? text : '-';
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function normalizeDisplayText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SNOW_STATE_LABELS: Record<string, string> = {
  '-5': 'Pending',
  '-4': 'Awaiting Evidence',
  '-3': 'Awaiting Vendor',
  '-2': 'Awaiting Customer',
  '-1': 'On Hold',
  '1': 'Open',
  '2': 'Work In Progress',
  '3': 'Closed Complete',
  '4': 'Closed Incomplete',
  '6': 'Resolved',
  '7': 'Closed',
  '8': 'Canceled',
};

function formatSnowStateLabel(rawValue: string): string {
  const key = rawValue.trim();
  const label = SNOW_STATE_LABELS[key];
  return label ? `${label} (${key})` : key;
}

function humanizeTimelineDetail(label: string, detail: string): string {
  if (/^state$/i.test(label)) {
    const match = detail.match(/^(.+?)\s*->\s*(.+)$/);
    if (match) {
      return `${formatSnowStateLabel(match[1])} -> ${formatSnowStateLabel(match[2])}`;
    }
    return formatSnowStateLabel(detail);
  }
  return detail;
}

type SnowEvidenceUiEntry = {
  category: 'record' | 'summary' | 'timeline' | 'generic';
  label: string;
  detail: string;
  actor?: string;
  time?: string;
};

type CodeAnalysisUiItem = { label: string; detail: string };

function parseBulletLines(text: string): string[] {
  return normalizeDisplayText(text)
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function buildStructuredRows(lines: string[]): Array<{ attribute: string; evidence: string }> {
  const entries = lines.length ? lines : ['Issue: No detail available'];
  return entries.map((line) => {
    const idx = line.indexOf(':');
    const attribute = idx >= 0 ? line.slice(0, idx).trim() : 'Observation';
    const evidence = idx >= 0 ? line.slice(idx + 1).trim() : line.trim();
    return {
      attribute: attribute || 'Observation',
      evidence: evidence || '-',
    };
  }).filter((row) => row.evidence && row.evidence !== '-');
}

function buildRecommendedNextSteps(analysis: TriageAnalysis): string[] {
  const steps: string[] = [];
  const gapLines = parseBulletLines(analysis.gap);

  for (const line of gapLines) {
    if (/fix direction|inspect|validate|review|provide|confirm|collect|repro/i.test(line)) {
      steps.push(line.replace(/^Related fix direction:\s*/i, '').trim());
    }
  }

  for (const blind of analysis.blindSpots) {
    if (/attach logs|not attached/i.test(blind)) {
      steps.push('Attach logs for the incident window (HWS/service logs) and rerun analysis.');
      continue;
    }
    if (/code search found no hits/i.test(blind)) {
      steps.push('Run focused code search in mapped repos for the failing component and exception path.');
      continue;
    }
    if (/work notes empty/i.test(blind)) {
      steps.push('Add SNOW work-note evidence (repro steps, observed behavior, actions tried).');
      continue;
    }
    if (/No direct DB repo hit found/i.test(blind)) {
      steps.push('Expand DB search terms (table/view/SP names) and verify database-side dependencies.');
      continue;
    }
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const step of steps.map((s) => s.trim()).filter(Boolean)) {
    const key = step.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(step);
  }
  return unique;
}

function parseSnowEvidenceForUi(rows: string[]): SnowEvidenceUiEntry[] {
  const parsed: SnowEvidenceUiEntry[] = [];

  for (const rawRow of rows) {
    const row = rawRow.trim();
    if (!row) continue;

    if (/^SNOW (Task|Incident|Case):/i.test(row)) {
      const idx = row.indexOf(':');
      const label = idx >= 0 ? row.slice(0, idx).trim() : 'SNOW Record';
      const detail = idx >= 0 ? row.slice(idx + 1).trim() : row;
      parsed.push({ category: 'record', label, detail });
      continue;
    }

    if (/^SNOW (Task|Incident|Case) summary:/i.test(row)) {
      const idx = row.indexOf(':');
      const label = idx >= 0 ? row.slice(0, idx).trim() : 'SNOW Summary';
      const detail = idx >= 0 ? row.slice(idx + 1).trim() : row;
      parsed.push({ category: 'summary', label, detail });
      continue;
    }

    const parts = row.split('|').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3 && /^[A-Za-z _-]+:/.test(parts[0])) {
      const idx = parts[0].indexOf(':');
      const label = idx >= 0 ? parts[0].slice(0, idx).trim() : 'Event';
      const detailRaw = idx >= 0 ? parts[0].slice(idx + 1).trim() : parts[0];
      const detail = humanizeTimelineDetail(label, detailRaw);
      parsed.push({
        category: 'timeline',
        label,
        detail,
        actor: parts[1],
        time: parts[2],
      });
      continue;
    }

    if (/^[A-Za-z _-]+:/.test(row)) {
      const idx = row.indexOf(':');
      const label = idx >= 0 ? row.slice(0, idx).trim() : 'Evidence';
      const detail = idx >= 0 ? row.slice(idx + 1).trim() : row;
      parsed.push({ category: 'generic', label, detail });
      continue;
    }

    parsed.push({ category: 'generic', label: 'Evidence', detail: row });
  }

  return parsed;
}

function parseCodeAnalysisForUi(codeAnalysis: string): CodeAnalysisUiItem[] {
  const lines = codeAnalysis
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);

  return lines.map((line) => {
    const idx = line.indexOf(':');
    if (idx > 0 && idx < 40) {
      return {
        label: line.slice(0, idx).trim(),
        detail: normalizeDisplayText(line.slice(idx + 1).trim()),
      };
    }
    return { label: 'Finding', detail: normalizeDisplayText(line) };
  });
}

function formatSnowEvidence(evidence: string[]): string[] {
  if (!evidence.length) return [];

  const joined = evidence.join('\n');
  const looksLikeAuditBlob = joined.includes('"fieldname"') && joined.includes('"newvalue"');
  if (!looksLikeAuditBlob) {
    return evidence.map((line) => normalizeDisplayText(line)).filter(Boolean);
  }

  const pattern = /"fieldname"\s*:\s*\{[^}]*?"display_value"\s*:\s*"([^"]*)"[\s\S]*?"oldvalue"\s*:\s*\{[^}]*?"display_value"\s*:\s*"([^"]*)"[\s\S]*?"newvalue"\s*:\s*\{[^}]*?"display_value"\s*:\s*"([^"]*)"[\s\S]*?"sys_created_on"\s*:\s*\{[^}]*?"display_value"\s*:\s*"([^"]*)"[\s\S]*?"user"\s*:\s*\{[^}]*?"display_value"\s*:\s*"([^"]*)"/g;
  const rows: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(joined)) !== null) {
    const [, field, oldValue, newValue, when, user] = match;
    rows.push(
      `${normalizeEvidenceValue(field)}: ${normalizeEvidenceValue(oldValue)} -> ${normalizeEvidenceValue(newValue)} | ${normalizeEvidenceValue(user)} | ${normalizeEvidenceValue(when)}`
    );
  }

  if (rows.length > 0) return rows;

  // Fallback for partially malformed payloads: keep only compact meaningful fragments.
  return joined
    .split('\n')
    .map((line) => normalizeDisplayText(line.replace(/[{}\[\]"]+/g, ' ')))
    .filter((line) => /fieldname|newvalue|oldvalue|priority|updated_by|updated_on/i.test(line))
    ;
}

function buildAnalysisEmail(session: TriageSession, analysis: TriageAnalysis, snowEvidenceRows: string[]): string {
  const title = session.adoItem?.fields['System.Title'] ?? 'Triage Analysis';
  const workItemId = session.adoItem?.id;
  const workItemType = session.adoItem?.fields['System.WorkItemType'] ?? 'Work Item';
  const verdict = analysis.verdict ?? 'NEED MORE INFO';
  const confidence = analysis.confidence ?? 'Low';
  const subject = `${workItemType}${workItemId ? ` #${workItemId}` : ''} - ${verdict} (${confidence})`;

  const evidenceBlock = snowEvidenceRows.length
    ? snowEvidenceRows.map((x) => `- ${x}`).join('\n')
    : '- No SNOW evidence captured';

  const body = [
    'DevAssist Analysis Summary',
    '',
    `Title: ${title}`,
    `Verdict: ${verdict}`,
    `Confidence: ${confidence}`,
    '',
    'Top Evidence:',
    evidenceBlock,
    '',
    'Code Analysis:',
    normalizeDisplayText(analysis.codeAnalysis),
    '',
    'Gap / Recommendation:',
    normalizeDisplayText(analysis.gap),
    '',
    'Blind Spots:',
    (analysis.blindSpots.length ? analysis.blindSpots : ['None']).map((x) => `- ${x}`).join('\n'),
  ].join('\n');

  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function escapeHtml(value: unknown): string {
  return normalizeDisplayText(String(value ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeForReport(value: unknown): string {
  const text = normalizeDisplayText(String(value ?? ''));
  const redacted = text
    .replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?:gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16})/gi, '[REDACTED_TOKEN]')
    .replace(/\b(?:patient|provider|account|email|host|token|secret|api[_-]?key)\b(?::?\s*[A-Za-z0-9._@:/\\-]+)/gi, '$1: [REDACTED]')
    .replace(/\b(?:\d{4}[-\s]?){3,}\d{1,4}\b/g, '[REDACTED_ACCOUNT]')
    .replace(/(?:[A-Za-z0-9-]+\.){2,}[A-Za-z]{2,}/g, '[REDACTED_HOST]');

  return redacted.trim();
}

function dedupeAttachments(attachments: any[] = []): any[] {
  const grouped = new Map<string, any>();

  for (const item of attachments) {
    const name = snowVal((item as any)?.file_name ?? '').trim();
    const source = String((item as any)?._source ?? 'SNOW').trim();
    if (!name) continue;

    const key = name.toLowerCase();
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...item, _source: source });
      continue;
    }

    const existingSources = String((existing as any)?._source ?? '').split(/[;,]/).map((v) => v.trim()).filter(Boolean);
    const nextSources = String(source).split(/[;,]/).map((v) => v.trim()).filter(Boolean);
    const merged = Array.from(new Set([...existingSources, ...nextSources])).filter(Boolean);
    grouped.set(key, { ...existing, ...item, _source: merged.join(', ') || source });
  }

  return Array.from(grouped.values());
}

function buildPrintableHtml(session: TriageSession, analysis: TriageAnalysis, snowEvidenceRows: string[]): string {
  const title = session.adoItem?.fields['System.Title'] ?? 'Triage Analysis';
  const workItemId = session.adoItem?.id ? `#${session.adoItem.id}` : '';
  const verdict = analysis.verdict ?? 'NEED MORE INFO';
  const confidence = analysis.confidence ?? 'Low';
  const reportTitle = sanitizeForReport(title);
  const sanitizedGeneratedFor = `Generated for DA ${session.adoItem?.id ?? 'unknown'} — Sanitized: no patient, provider, account, email, host, or token values included.`;
  const artifactLedger = session.artifactLedger;
  const attachments = dedupeAttachments(session.attachments ?? []);
  const relatedItems = session.relatedItems ?? [];
  const areaEvidence = session.areaEvidence ?? [];
  const versionEvidence = session.versionEvidence ?? [];
  const recentCommits = session.recentCommits ?? [];
  const blindSpots = analysis.blindSpots.length ? analysis.blindSpots : ['None'];
  const problemStatementRows = parseBulletLines(analysis.clientReported);
  const assessmentRows = parseBulletLines(analysis.gap);
  const recommendedSteps = buildRecommendedNextSteps(analysis);

  const listToHtml = (items: string[]) => items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

  const attachmentHtml = attachments.length
    ? attachments.map((attachment) => {
        const name = snowVal((attachment as any).file_name);
        const type = snowVal((attachment as any).content_type);
        const source = String((attachment as any)._source ?? 'SNOW');
        return `<li><strong>${escapeHtml(name)}</strong> <span>${escapeHtml(type)}</span> <em>${escapeHtml(source)}</em></li>`;
      }).join('')
    : '<li>No attachments loaded</li>';

  const evidenceHtml = snowEvidenceRows.length
    ? snowEvidenceRows.map((row) => `<li>${escapeHtml(row)}</li>`).join('')
    : '<li>No SNOW evidence captured</li>';

  const areaItemsHtml = areaEvidence.length
    ? areaEvidence.map((item) => `<li><strong>#${escapeHtml(item.id)}</strong> ${escapeHtml(item.title)} <em>${escapeHtml(item.state)}</em></li>`).join('')
    : '<li>No area evidence</li>';

  const versionItemsHtml = versionEvidence.length
    ? versionEvidence.map((item) => `<li><strong>#${escapeHtml(item.id)}</strong> ${escapeHtml(item.title)} <em>${escapeHtml(item.supportVersion || item.reportedRelease || item.state)}</em></li>`).join('')
    : '<li>No version-linked evidence</li>';

  const relatedItemsHtml = relatedItems.length
    ? relatedItems.map((item) => `<li><strong>#${escapeHtml(item.id)}</strong> ${escapeHtml(item.title)} <em>${escapeHtml(item.state)}</em></li>`).join('')
    : '<li>No related open bugs</li>';

  const recentCommitsHtml = recentCommits.length
    ? recentCommits.map((commit) => `<li><strong>${escapeHtml(commit.sha)}</strong> ${escapeHtml(commit.message)} <em>${escapeHtml(commit.date)}</em></li>`).join('')
    : '<li>No recent commits</li>';

  const artifactLedgerHtml = artifactLedger
    ? `
      <h3>Attachment Coverage</h3>
      <p><strong>Coverage timeframe:</strong> ${escapeHtml(artifactLedger.coverageTimeframe)}</p>
      <p><strong>Coverage subject:</strong> ${escapeHtml(artifactLedger.coverageSubject)}</p>
      <div class="grid two">
        <div>
          <h4>Analyzed</h4>

          <ul>${listToHtml(artifactLedger.analyzed.map((item) => `${item.source} | ${item.file} | ${item.finding}`))}</ul>
        </div>
        <div>
          <h4>Not Analyzed</h4>
          <ul>${listToHtml(artifactLedger.notAnalyzed.map((item) => `${item.source} | ${item.file} | ${item.reason}`))}</ul>
        </div>
      </div>
    `
    : '';

  const style = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      margin: 0;
      padding: 28px;
      color: #111827;
      background: #ffffff;
    }
    h1, h2, h3, h4, p, ul { margin: 0 0 10px; }
    h1 { font-size: 24px; }
    h2 { font-size: 18px; margin-top: 20px; border-bottom: 1px solid #d1d5db; padding-bottom: 6px; }
    h3 { font-size: 15px; margin-top: 0; }
    h4 { font-size: 13px; margin-top: 0; color: #374151; }
    .muted { color: #6b7280; }
    .summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin: 16px 0 18px;
    }
    .card, .section {
      border: 1px solid #d1d5db;
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 12px;
      background: #f9fafb;
    }
    .pill {
      display: inline-block;
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      margin-right: 8px;
      margin-bottom: 8px;
      background: #fff;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      overflow: hidden;
    }
    .data-table th, .data-table td {
      border: 1px solid #d1d5db;
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
      font-size: 12px;
      line-height: 1.5;
    }
    .data-table th {
      background: #eef2ff;
      color: #1f2937;
      font-weight: 700;
    }
    .grid.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    ul { padding-left: 18px; }
    li { margin-bottom: 6px; }
    .pre {
      white-space: pre-wrap;
      font-family: Consolas, Monaco, 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.45;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 12px;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      .card, .section, .pre { break-inside: avoid; }
    }
  `;

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>DevAssist Analysis Report</title>
      <style>${style}</style>
    </head>
    <body>
      <div class="no-print" style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:14px;">
        <button onclick="window.print()" style="padding:8px 12px;border:1px solid #0ea5e9;border-radius:8px;background:#e0f2fe;color:#0f172a;font-weight:600;">Print / Save as PDF</button>
        <button onclick="window.close()" style="padding:8px 12px;border:1px solid #94a3b8;border-radius:8px;background:#fff;color:#0f172a;font-weight:600;">Close</button>
      </div>
      <h1>DevAssist Analysis Report</h1>
      <p class="muted">${escapeHtml(sanitizedGeneratedFor)} • ${escapeHtml(new Date().toLocaleString())}</p>
      <div class="card">
        <h2>${escapeHtml(reportTitle)} ${escapeHtml(workItemId)}</h2>
        <div>
          <span class="pill">Verdict: ${escapeHtml(verdict)}</span>
          <span class="pill">Confidence: ${escapeHtml(confidence)}</span>
          <span class="pill">Product: ${escapeHtml(session.product?.displayName ?? '-')}</span>
          <span class="pill">Task: ${escapeHtml(session.snowTaskNumber ?? '-')}</span>
          <span class="pill">Incident: ${escapeHtml(snowVal((session.snowIncident as any)?.number) || '-')}</span>
          <span class="pill">Case: ${escapeHtml(snowVal((session.snowCase as any)?.number) || '-')}</span>
        </div>
        <p><strong>Client reported</strong></p>
        <div class="pre">${escapeHtml(analysis.clientReported)}</div>
      </div>

      <div class="section">
        <h2>Problem Statement</h2>
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 32%;">Attribute</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            ${(problemStatementRows.length ? problemStatementRows : [analysis.clientReported]).map((row) => {
              const idx = row.indexOf(':');
              const attribute = idx >= 0 ? row.slice(0, idx).trim() : 'Problem';
              const value = idx >= 0 ? row.slice(idx + 1).trim() : row.trim();
              return `<tr><td>${escapeHtml(attribute || 'Problem')}</td><td>${escapeHtml(value || '-')}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>Diagnostic Evidence</h2>
        <h3>SNOW Evidence</h3>
        <ul>${evidenceHtml}</ul>
        <h3>Code and Runtime Evidence</h3>
        <div class="pre">${escapeHtml(analysis.codeAnalysis)}</div>
      </div>

      <div class="section">
        <h2>Assessment</h2>
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 36%;">Reasoning step</th>
              <th>Finding</th>
            </tr>
          </thead>
          <tbody>
            ${(assessmentRows.length ? assessmentRows : [analysis.gap]).map((row) => {
              const idx = row.indexOf(':');
              const step = idx >= 0 ? row.slice(0, idx).trim() : 'Observation';
              const finding = idx >= 0 ? row.slice(idx + 1).trim() : row.trim();
              return `<tr><td>${escapeHtml(step || 'Observation')}</td><td>${escapeHtml(finding || '-')}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="section">
        <h2>Artifact Coverage</h2>
        ${artifactLedgerHtml || '<p>No artifact coverage metadata found.</p>'}
        <h3>Attachments</h3>
        <ul>${attachmentHtml}</ul>
      </div>

      <div class="section">
        <h2>Recommended Next Steps</h2>
        <ol>${recommendedSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join('') || '<li>No additional action list generated.</li>'}</ol>
      </div>

      <div class="section">
        <h2>Evidence Gaps</h2>
        <ul>${listToHtml(blindSpots)}</ul>
      </div>

      <div class="section">
        <h2>Unique DevAssist Sections</h2>
        <ul>
          <li>Analysis Framework Trace (skills routing, preflight checks, evidence quality)</li>
          <li>Repo / MTM Comparison (related bugs, test cases, release history)</li>
          <li>AI Assessment Panel (supplemental reasoning draft)</li>
        </ul>
      </div>

      <div class="grid two">
        <div class="section">
          <h2>Area Evidence</h2>
          <ul>${areaItemsHtml}</ul>
        </div>
        <div class="section">
          <h2>Version Evidence</h2>
          <ul>${versionItemsHtml}</ul>
        </div>
      </div>

      <div class="grid two">
        <div class="section">
          <h2>Related Bugs</h2>
          <ul>${relatedItemsHtml}</ul>
        </div>
        <div class="section">
          <h2>Recent Commits</h2>
          <ul>${recentCommitsHtml}</ul>
        </div>
      </div>

      ${session.analysis?.l2Draft ? `
        <div class="section">
          <h2>Suggested L2 Commentary</h2>
          <div class="pre">${escapeHtml(session.analysis.l2Draft)}</div>
        </div>
      ` : ''}
    </body>
  </html>`;
}

function openPrintableReport(session: TriageSession, analysis: TriageAnalysis, snowEvidenceRows: string[]): void {
  const html = buildPrintableHtml(session, analysis, snowEvidenceRows);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.opacity = '0';

  const cleanup = () => {
    try {
      frame.remove();
    } catch {
      // ignore
    }
  };

  frame.onload = () => {
    const frameWindow = frame.contentWindow;
    if (!frameWindow) {
      cleanup();
      return;
    }

    window.setTimeout(() => {
      try {
        frameWindow.focus();
        frameWindow.print();
      } catch {
        cleanup();
      }
    }, 250);
  };

  window.addEventListener('afterprint', cleanup, { once: true });
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

export default function AnalysisPanel({ session, onAnalysisComplete }: Props) {
  const { githubPat } = useSettingsStore();
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [simpleView, setSimpleView] = useState(true);
  const [showSupplementary, setShowSupplementary] = useState(false);

  const { adoItem, product, snowTask, analysis } = session;

  const runAnalysis = async () => {
    if (!adoItem || !product) return;
    setRunning(true);
    try {
      const pattern = matchPattern(adoItem);
      const codeHits = pattern
        ? await runCodeSearch(githubPat ?? '', product, pattern)
        : [];

      const dbTerms = Array.from(new Set([
        ...(pattern?.searchSeeds ?? []),
        ...String(adoItem.fields['System.Title'] ?? '')
          .split(/\s+/)
          .map((t) => t.trim())
          .filter((t) => t.length >= 4),
      ]));

      const databaseEvidence = await runDatabaseRepoSearch(githubPat ?? '', product.databaseRepoPaths ?? [], dbTerms);

      const workNotes = snowTask?.['_workNotes']
        ? JSON.stringify(snowTask['_workNotes'])
        : snowVal(snowTask?.work_notes);
      const logHits: Array<{ seed: string; text: string; file: string }> = (snowTask as any)?._logHits ?? [];
      const topSeeds: Record<string, number> = (snowTask as any)?._topSeeds ?? {};
      // Use skill-driven analysis (reads analysis-playbook.md, reasoning-framework.md etc. from bridge)
      const result = await buildSkillDrivenAssessment(
        adoItem,
        product,
        workNotes || undefined,
        logHits,
        topSeeds,
        codeHits,
        session.areaEvidence ?? [],
        session.versionEvidence ?? [],
        databaseEvidence
      );
      onAnalysisComplete(result);
    } finally {
      setRunning(false);
    }
  };

  if (!adoItem || !product) return null;

  if (!analysis) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-sm font-medium text-gray-300 flex items-center gap-1.5">
            <Code2 size={14} /> Root Cause Analysis
          </p>
          <button
            onClick={runAnalysis}
            disabled={running}
            className="flex items-center gap-2 bg-altera-blue hover:bg-altera-blue/80 disabled:opacity-50
                       text-white px-3 py-1.5 rounded text-xs font-medium w-full sm:w-auto justify-center"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Code2 size={12} />}
            {running ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
        <p className="text-xs text-gray-600">
          Matches symptom against known patterns, searches mapped repos, and generates root cause assessment.
        </p>
      </div>
    );
  }

  const verdictStyle = VERDICT_STYLE[analysis.verdict ?? 'NEED MORE INFO'] ?? VERDICT_STYLE['NEED MORE INFO'];
  const snowEvidenceRows = formatSnowEvidence(analysis.snowEvidence);
    const snowEvidenceStructured = parseSnowEvidenceForUi(snowEvidenceRows);
    const snowRecords = snowEvidenceStructured.filter((item) => item.category === 'record' || item.category === 'summary');
    const snowTimeline = snowEvidenceStructured.filter((item) => item.category === 'timeline');
    const snowOther = snowEvidenceStructured.filter((item) => item.category === 'generic');
    const codeAnalysisRows = parseCodeAnalysisForUi(analysis.codeAnalysis);
  const problemStatementRows = buildStructuredRows(parseBulletLines(analysis.clientReported));
  const gapRows = buildStructuredRows(parseBulletLines(analysis.gap));
  const recommendedSteps = buildRecommendedNextSteps(analysis);
  const analyzedArtifacts = session.artifactLedger?.analyzed ?? [];
  const notAnalyzedArtifacts = session.artifactLedger?.notAnalyzed ?? [];
  const hasRepoComparisonSections = Boolean(
    session.relatedItems?.length ||
    session.testCases?.length ||
    session.recentCommits?.length ||
    session.areaEvidence?.length ||
    session.versionEvidence?.length ||
    session.kbEvidence?.length
  );
  const repoEvidenceCount =
    (session.relatedItems?.length ?? 0) +
    (session.testCases?.length ?? 0) +
    (session.recentCommits?.length ?? 0) +
    (session.areaEvidence?.length ?? 0) +
    (session.versionEvidence?.length ?? 0) +
    (session.kbEvidence?.length ?? 0);
  const sparseEvidenceMode =
    snowEvidenceRows.length <= 3 &&
    codeAnalysisRows.length <= 4 &&
    gapRows.length <= 4 &&
    repoEvidenceCount <= 3 &&
    analyzedArtifacts.length <= 2 &&
    notAnalyzedArtifacts.length <= 2;
  const shouldShowSupplementary = showSupplementary || (!simpleView && !sparseEvidenceMode);
  const emailHref = buildAnalysisEmail(session, analysis, snowEvidenceRows);

  const copyL2 = () => {
    if (analysis.l2Draft) {
      navigator.clipboard.writeText(analysis.l2Draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const panelShell = expanded
    ? 'fixed inset-3 z-50 overflow-auto rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl shadow-black/60'
    : 'space-y-2.5';

  return (
    <div className={panelShell}>
      {expanded && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-800 bg-gray-950/95 px-3 py-2.5 backdrop-blur">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Expanded comment view</p>
            <p className="text-sm text-gray-300">Use this when you want the analysis and commentary draft in a larger page.</p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-900 text-gray-200 hover:bg-gray-800"
          >
            Collapse view
          </button>
        </div>
      )}

      <div className="space-y-2.5 p-0" style={expanded ? { padding: '0.75rem' } : undefined}>
      {/* Verdict */}
      <div className={`rounded-lg border p-3.5 space-y-2.5 ${simpleView ? 'border-gray-800 bg-gray-950/80 text-gray-100' : verdictStyle.color}`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-sm">
            {verdictStyle.icon}
            Assessment: {analysis.verdict}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full border ${
              analysis.confidence === 'High'   ? 'border-gray-700 text-gray-300' :
              analysis.confidence === 'Medium' ? 'border-gray-700 text-gray-300' :
                                                 'border-gray-700 text-gray-400'
            }`}>
              Confidence: {analysis.confidence}
            </span>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-200 hover:border-cyan-400/50 hover:text-white"
            >
              {expanded ? 'Collapse view' : 'Expand view'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSimpleView((prev) => !prev);
                setShowSupplementary(false);
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-200 hover:border-cyan-400/50 hover:text-white"
            >
              {simpleView ? 'Switch to detailed view' : 'Switch to simple view'}
            </button>
          </div>
        </div>
        {simpleView && (
          <p className="text-[11px] text-gray-400">
            Simple view is enabled. Core findings are shown first; advanced evidence and AI sections are hidden until expanded.
          </p>
        )}
        <pre className="text-xs opacity-80 whitespace-pre-wrap font-sans">{analysis.clientReported}</pre>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-950/70 p-3.5 space-y-2 text-sm">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Problem Statement</p>
        <p className="text-xs text-gray-300 leading-relaxed">
          {analysis.clientReported}
        </p>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">Diagnostic Evidence</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Evidence rows and comparison details are summarized in the tables below.
        </p>
        <div className="overflow-hidden rounded border border-gray-800 bg-gray-950/80">
          <table className="w-full border-collapse text-left text-xs text-gray-200">
            <thead>
              <tr className="bg-gray-900 text-gray-300 uppercase tracking-wide">
                <th className="border border-gray-800 px-2.5 py-2 font-medium">Attribute</th>
                <th className="border border-gray-800 px-2.5 py-2 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {problemStatementRows.map((row, idx) => (
                <tr key={`problem-row-${idx}`} className="align-top">
                  <td className="border border-gray-800 px-2.5 py-2 text-gray-100 font-medium">{row.attribute}</td>
                  <td className="border border-gray-800 px-2.5 py-2 text-gray-200 leading-relaxed">{row.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Diagnostic evidence and assessment */}
      <div className="rounded-lg border border-gray-800 bg-gray-950/70 p-3.5 space-y-3.5 text-sm">
        {snowEvidenceRows.length > 0 && !simpleView && (
          <section className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Diagnostic Evidence</p>
            <div className="analysis-scroll max-h-[28rem] space-y-2 rounded border border-gray-800 bg-gray-950/80 p-2.5">
              {snowRecords.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Record snapshot</p>
                  {snowRecords.map((item, idx) => (
                    <div key={`snow-record-${idx}`} className="rounded border border-gray-800 bg-gray-900/70 px-2.5 py-2">
                      <p className="text-[11px] text-cyan-300 font-semibold">{item.label}</p>
                      <p className="text-xs text-gray-300 leading-relaxed">{item.detail}</p>
                    </div>
                  ))}
                </div>
              )}

              {snowTimeline.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Timeline</p>
                  {snowTimeline.map((item, idx) => (
                    <div key={`snow-timeline-${idx}`} className="rounded border border-gray-800 bg-gray-900/70 px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs text-gray-200">
                          <span className="text-cyan-300 font-semibold">{item.label}:</span> {item.detail}
                        </p>
                        {item.time && <span className="shrink-0 text-[11px] text-gray-500">{item.time}</span>}
                      </div>
                      {item.actor && <p className="text-[11px] text-gray-500 mt-1">By: {item.actor}</p>}
                    </div>
                  ))}
                </div>
              )}

              {snowOther.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Additional evidence</p>
                  {snowOther.map((item, idx) => (
                    <div key={`snow-other-${idx}`} className="rounded border border-gray-800 bg-gray-900/70 px-2.5 py-2">
                      <p className="text-xs text-gray-200 whitespace-pre-wrap leading-relaxed">
                        <span className="text-cyan-300 font-semibold">{item.label}:</span> {item.detail}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {snowEvidenceRows.length > 0 && simpleView && (
          <section className="space-y-2">
            <details className="rounded border border-gray-800 bg-gray-950/80 p-2.5">
              <summary className="cursor-pointer text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Diagnostic Evidence (collapsed in simple view)
              </summary>
              <div className="analysis-scroll mt-2 max-h-[20rem] space-y-2 rounded border border-gray-800 bg-gray-950/70 p-2">
                {snowRecords.slice(0, 6).map((item, idx) => (
                  <div key={`snow-record-simple-${idx}`} className="rounded border border-gray-800 bg-gray-900/70 px-2 py-1.5">
                    <p className="text-[11px] text-cyan-300 font-semibold">{item.label}</p>
                    <p className="text-xs text-gray-300 leading-relaxed">{item.detail}</p>
                  </div>
                ))}
                {snowTimeline.slice(0, 6).map((item, idx) => (
                  <div key={`snow-timeline-simple-${idx}`} className="rounded border border-gray-800 bg-gray-900/70 px-2 py-1.5">
                    <p className="text-xs text-gray-200">
                      <span className="text-cyan-300 font-semibold">{item.label}:</span> {item.detail}
                    </p>
                  </div>
                ))}
                {snowOther.slice(0, 6).map((item, idx) => (
                  <div key={`snow-other-simple-${idx}`} className="rounded border border-gray-800 bg-gray-900/70 px-2 py-1.5">
                    <p className="text-xs text-gray-200 whitespace-pre-wrap leading-relaxed">
                      <span className="text-cyan-300 font-semibold">{item.label}:</span> {item.detail}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          </section>
        )}

        <section className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Assessment</p>
          <div className="overflow-hidden rounded border border-gray-800 bg-gray-950/80">
            <table className="w-full border-collapse text-left text-xs text-gray-200">
              <thead>
                <tr className="bg-gray-900 text-gray-300 uppercase tracking-wide">
                  <th className="border border-gray-800 px-2.5 py-2 font-medium">Reasoning step</th>
                  <th className="border border-gray-800 px-2.5 py-2 font-medium">Finding</th>
                </tr>
              </thead>
              <tbody>
                {codeAnalysisRows.map((item, idx) => (
                  <tr key={`code-analysis-${idx}`} className="align-top">
                    <td className="border border-gray-800 px-2.5 py-2 text-gray-100 font-medium">{item.label}</td>
                    <td className="border border-gray-800 px-2.5 py-2 text-gray-200 leading-relaxed">{item.detail}</td>
                  </tr>
                ))}
                {gapRows.map((row, idx) => (
                  <tr key={`assessment-gap-${idx}`} className="align-top">
                    <td className="border border-gray-800 px-2.5 py-2 text-gray-100 font-medium">{row.attribute}</td>
                    <td className="border border-gray-800 px-2.5 py-2 text-gray-200 leading-relaxed">{row.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {(analyzedArtifacts.length > 0 || notAnalyzedArtifacts.length > 0) && (
          <section className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Artifact Coverage</p>
            <div className="rounded border border-gray-800 bg-gray-950/80 p-2.5 space-y-1.5">
              {analyzedArtifacts.map((item, idx) => (
                <p key={`artifact-ok-${idx}`} className="text-xs text-emerald-300 leading-relaxed">- Analyzed: {item.file} ({item.type}) - {item.finding}</p>
              ))}
              {notAnalyzedArtifacts.map((item, idx) => (
                <p key={`artifact-gap-${idx}`} className="text-xs text-yellow-300 leading-relaxed">- Not analyzed: {item.file} ({item.type}) - {item.reason}</p>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Recommended Next Steps</p>
          {recommendedSteps.length > 0 && (
            <div className="rounded border border-gray-800 bg-gray-950/80 p-2.5 space-y-1">
              {recommendedSteps.map((step, idx) => (
                <p key={`next-step-${idx}`} className="text-xs text-gray-200 leading-relaxed">{idx + 1}. {step}</p>
              ))}
            </div>
          )}
        </section>

        {analysis.blindSpots.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <AlertTriangle size={10} /> Evidence Gaps
            </p>
            {analysis.blindSpots.map((b, i) => (
              <p key={i} className="text-xs text-yellow-200/90 leading-relaxed">- {b}</p>
            ))}
          </div>
        )}

        {analysis.skillSections && !simpleView && (
          <section className="space-y-2">
            <details className="group rounded border border-gray-800 bg-gray-950/70 p-2.5" open={false}>
              <summary className="cursor-pointer text-[11px] font-semibold text-gray-400 uppercase tracking-wide list-none">
                Advanced: analysis framework trace (internal reviewer details)
              </summary>
              <div className="grid gap-2 md:grid-cols-2 mt-2">
              <div className="rounded border border-gray-800 bg-gray-900/70 px-2.5 py-2 space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Preflight checks</p>
                {analysis.skillSections.preflightChecks.map((line, idx) => (
                  <p key={`skill-preflight-${idx}`} className="text-xs text-gray-200">- {line}</p>
                ))}
              </div>
              <div className="rounded border border-gray-800 bg-gray-900/70 px-2.5 py-2 space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Routing decision</p>
                {analysis.skillSections.routingDecision.map((line, idx) => (
                  <p key={`skill-route-${idx}`} className="text-xs text-gray-200">- {line}</p>
                ))}
              </div>
              <div className="rounded border border-gray-800 bg-gray-900/70 px-2.5 py-2 space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Skill files used</p>
                {analysis.skillSections.skillFilesUsed.map((line, idx) => (
                  <p key={`skill-files-${idx}`} className="text-xs text-gray-200">- {line}</p>
                ))}
              </div>
              <div className="rounded border border-gray-800 bg-gray-900/70 px-2.5 py-2 space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-gray-500">Evidence quality</p>
                {analysis.skillSections.evidenceQuality.map((line, idx) => (
                  <p key={`skill-quality-${idx}`} className="text-xs text-gray-200">- {line}</p>
                ))}
              </div>
              </div>
            </details>
          </section>
        )}

        {!sparseEvidenceMode && !simpleView && (
          <section className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Unique DevAssist Sections</p>
            <div className="rounded border border-gray-800 bg-gray-950/80 p-2.5 space-y-1">
              <p className="text-xs text-gray-200">- Analysis Framework Trace (skills): preflight checks, routing, and evidence quality.</p>
              {hasRepoComparisonSections && <p className="text-xs text-gray-200">- Repo / MTM Comparison: cross-checks against related bugs, test coverage, commits, and release context.</p>}
              <p className="text-xs text-gray-200">- AI Assessment Panel: optional secondary perspective for reviewer comparison.</p>
            </div>
          </section>
        )}
      </div>

      {!showSupplementary && (
        <div className="rounded-lg border border-gray-800 bg-gray-950/70 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-xs text-gray-400">
            {simpleView
              ? 'Simple view is active. Optional sections are hidden to keep the UI lighter.'
              : 'Detailed view is active. Use this only when you need deeper evidence sections.'}
          </p>
          <button
            type="button"
            onClick={() => setShowSupplementary(true)}
            className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"
          >
            Show optional sections
          </button>
        </div>
      )}

      {/* Repo / MTM Comparison */}
      {shouldShowSupplementary && (session.relatedItems?.length || session.testCases?.length || session.recentCommits?.length || session.areaEvidence?.length || session.versionEvidence?.length || session.kbEvidence?.length) && (
        <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-3.5 space-y-3.5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Repo / MTM Comparison</p>

          {(session.kbEvidence?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <Bug size={11} className="text-gray-500" />
                SNOW KB related articles · {session.kbEvidence!.length} found
              </p>
              {session.kbEvidence!.map((kb, idx) => (
                <div key={`${kb.number}-${idx}`} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <span className="text-altera-teal font-mono shrink-0 mr-2">{kb.number || 'KB'}</span>
                  <span className="text-gray-300 break-words flex-1">{kb.shortDescription || '(no short description)'}</span>
                  <span className="text-gray-500 shrink-0 ml-2">{kb.release || '-'}</span>
                  <span className="text-gray-500 shrink-0 ml-2">{kb.state || '-'}</span>
                  <span className="text-gray-600 shrink-0 ml-2">{kb.updatedOn ? String(kb.updatedOn) : '-'}</span>
                </div>
              ))}
            </div>
          )}

          {(session.versionEvidence?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <Bug size={11} className="text-gray-500" />
                Similar historical items in same release context · {session.versionEvidence!.length} found
              </p>
              {session.versionEvidence!.map(item => (
                <div key={item.id} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <a href={item.url} target="_blank" rel="noreferrer"
                     className="text-altera-teal hover:text-white font-mono shrink-0 mr-2">#{item.id}</a>
                  <span className="text-gray-300 break-words flex-1">{item.title}</span>
                  <span className="text-gray-500 shrink-0 ml-2">{item.reportedRelease || item.supportVersion || '-'}</span>
                  <span className={`shrink-0 ml-2 px-1.5 py-0.5 rounded text-xs ${
                    /Closed|Resolved|Done|Completed/i.test(item.state) ? 'bg-emerald-950 text-emerald-400' : 'bg-gray-800 text-gray-400'
                  }`}>{item.state}</span>
                </div>
              ))}
            </div>
          )}

          {(session.areaEvidence?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <Bug size={11} className="text-gray-500" />
                Area evidence (defect/bug/task/story, 365d) · {session.areaEvidence!.length} found
              </p>
              {session.areaEvidence!.map(item => (
                <div key={item.id} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <a href={item.url} target="_blank" rel="noreferrer"
                     className="text-altera-teal hover:text-white font-mono shrink-0 mr-2">#{item.id}</a>
                  <span className="text-gray-300 break-words flex-1">{item.title}</span>
                  <span className="text-gray-500 shrink-0 ml-2">{item.type}</span>
                  <span className="text-gray-600 shrink-0 ml-2">{item.reportedRelease || item.supportVersion || '-'}</span>
                </div>
              ))}
            </div>
          )}

          {/* Related open bugs */}
          {(session.relatedItems?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <Bug size={11} className="text-gray-500" />
                Open bugs — same area (last 90 days) · {session.relatedItems!.length} found
              </p>
              {session.relatedItems!.map(item => (
                <div key={item.id} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <a href={item.url} target="_blank" rel="noreferrer"
                     className="text-altera-teal hover:text-white font-mono shrink-0 mr-2">#{item.id}</a>
                  <span className="text-gray-300 break-words flex-1">{item.title}</span>
                  <span className={`shrink-0 ml-2 px-1.5 py-0.5 rounded text-xs ${
                    item.state === 'Active'     ? 'bg-blue-950 text-blue-400' :
                    item.state === 'New'        ? 'bg-green-950 text-green-400' :
                    item.state === 'In Progress'? 'bg-yellow-950 text-yellow-400' :
                                                  'bg-gray-800 text-gray-500'
                  }`}>{item.state}</span>
                </div>
              ))}
              {session.relatedItems!.length === 0 && (
                <p className="text-xs text-gray-600">No open bugs found in this area — this may be a new/unreported issue</p>
              )}
            </div>
          )}
          {(session.relatedItems?.length ?? 0) === 0 && session.relatedItems !== undefined && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <Bug size={11} className="text-red-400" /> Open bugs — same area (last 90 days)
              </p>
              <p className="text-xs text-emerald-600">✓ No open bugs found — this may be a new/unreported issue</p>
            </div>
          )}

          {/* Test cases */}
          {(session.testCases?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <TestTube size={11} className="text-gray-500" />
                MTM Test cases — same area · {session.testCases!.length} found
              </p>
              {session.testCases!.map(tc => (
                <div key={tc.id} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <a href={tc.url} target="_blank" rel="noreferrer"
                     className="text-altera-teal hover:text-white font-mono shrink-0 mr-2">#{tc.id}</a>
                  <span className="text-gray-300 break-words flex-1">{tc.title}</span>
                  <span className="shrink-0 ml-2 px-1.5 py-0.5 rounded text-xs bg-gray-900 text-gray-300">{tc.state}</span>
                </div>
              ))}
            </div>
          )}
          {(session.testCases?.length ?? 0) === 0 && session.testCases !== undefined && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <TestTube size={11} className="text-gray-500" /> MTM Test cases — same area
              </p>
              <p className="text-xs text-gray-400">No test cases found — coverage gap for this area</p>
            </div>
          )}

          {/* Recent commits */}
          {(session.recentCommits?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <GitCommit size={11} className="text-altera-teal" />
                Recent commits — {session.product?.repos.find(r=>r.required)?.repo ?? 'primary repo'}
              </p>
              {session.recentCommits!.map(c => (
                <div key={c.sha} className="flex items-center gap-2 text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <a href={c.url} target="_blank" rel="noreferrer"
                     className="text-altera-teal font-mono shrink-0">{c.sha}</a>
                  <span className="text-gray-400 shrink-0">{c.date}</span>
                  <span className="text-gray-300 break-words">{c.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI Assessment — always visible so provider/model/agent choices are discoverable */}
      <AiAssessmentPanel session={session} />

      {shouldShowSupplementary && (
        <>
          <div className="rounded-lg border border-gray-800 bg-gray-950/70 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Report export</p>
              <p className="text-xs text-gray-300">Print the full analysis report or save it as a PDF from the browser dialog.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openPrintableReport(session, analysis, snowEvidenceRows)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-800"
              >
                <Printer size={12} /> Print / Save as PDF
              </button>
              <a
                href={emailHref}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-700"
              >
                <Download size={12} /> Email draft
              </a>
            </div>
          </div>

        </>
      )}

      {/* L2 draft — human-gated, never auto-posted */}
      {analysis.l2Draft && (
        <div className="rounded-lg border border-gray-800 bg-gray-950/70 p-4 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-xs font-medium text-gray-300">Suggested L2 Commentary (review before posting)</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-xs text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 px-2 py-1 rounded"
              >
                {expanded ? 'Collapse view' : 'Expand view'}
              </button>
              <a
                href={emailHref}
                className="flex items-center gap-1 text-xs text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 px-2 py-1 rounded"
              >
                <Mail size={11} /> Share via Email
              </a>
              <button onClick={copyL2}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-2 py-1 rounded">
                {copied ? <><CheckCircle2 size={11} className="text-gray-300" /> Copied</> : <><ClipboardCopy size={11} /> Copy</>}
              </button>
            </div>
          </div>
          <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-auto">
            {analysis.l2Draft}
          </pre>
          <p className="text-xs text-gray-600">Warning: Human-gated - paste into DA field <code>Allscripts.Field.CommentaryforL2</code> after review. Never auto-posted.</p>
        </div>
      )}

      {/* Re-run */}
      <button onClick={runAnalysis} disabled={running}
        className="text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1">
        {running ? <Loader2 size={11} className="animate-spin" /> : <Code2 size={11} />}
        Re-analyze
      </button>
      </div>
    </div>
  );
}

type FollowUpHistoryEntry = {
  question: string;
  answer: string;
  at: string;
};

type AiStatus = {
  ollama: boolean;
  ollamaModels: string[];
  modelCatalog?: {
    'github-models'?: string[];
    openai?: string[];
    ollama?: string[];
  };
  agentModes?: Array<{ id: AiAgentSelection; label: string; description: string }>;
  defaultModels?: {
    'github-models'?: string;
    openai?: string;
    ollama?: string;
  };
  githubReady: boolean;
  openaiReady: boolean;
  anyBackendReady: boolean;
};

type AiProviderSelection = 'auto' | 'github-models' | 'openai' | 'ollama';
type AiAgentSelection = 'triage-l2' | 'root-cause' | 'log-forensics' | 'l2-commentary';
type AiModelSelection = 'provider-default' | 'custom' | string;

type FollowUpTemplate = {
  label: string;
  prompt: string;
};

type AgentComparisonResult = {
  agent: AiAgentSelection;
  label: string;
  assessment: string;
  source?: string | null;
  warning?: string | null;
  error?: string | null;
};

function clampText(value: unknown, maxChars: number): string {
  const text = normalizeDisplayText(String(value ?? ''));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function buildFollowUpTemplates(agent: AiAgentSelection): FollowUpTemplate[] {
  const common: FollowUpTemplate[] = [
    {
      label: 'Strongest hypothesis',
      prompt: 'What is the strongest root-cause hypothesis, and what evidence most supports it?',
    },
    {
      label: 'Missing evidence',
      prompt: 'List the top 3 missing evidence items that would most increase confidence.',
    },
    {
      label: 'Next validation',
      prompt: 'What is the single best validation step to run next?',
    },
    {
      label: 'Customer summary',
      prompt: 'Rewrite the result as a short customer-ready explanation with no jargon.',
    },
  ];

  if (agent === 'root-cause') {
    return [
      {
        label: 'Cause chain',
        prompt: 'Map the observed behavior to the failure mechanism and final user impact.',
      },
      ...common,
    ];
  }

  if (agent === 'log-forensics') {
    return [
      {
        label: 'Timeline',
        prompt: 'Extract the most important timeline from the logs and identify where the delay starts.',
      },
      {
        label: 'Signal vs noise',
        prompt: 'Separate the diagnostic log signals from the noise or unrelated messages.',
      },
      ...common,
    ];
  }

  if (agent === 'l2-commentary') {
    return [
      {
        label: 'Stakeholder note',
        prompt: 'Draft a concise stakeholder note: what happened, why it matters, and what comes next.',
      },
      ...common,
    ];
  }

  return common;
}

function agentLabel(agent: AiAgentSelection): string {
  switch (agent) {
    case 'root-cause':
      return 'Root Cause Agent';
    case 'log-forensics':
      return 'Log Forensics Agent';
    case 'l2-commentary':
      return 'L2 Commentary Agent';
    default:
      return 'L2 Triage Agent';
  }
}

function AiAssessmentPanel({ session }: { session: TriageSession }) {
  const { openaiKey, githubPat } = useSettingsStore();
  const [running, setRunning]   = useState(false);
  const [result, setResult]     = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const [aiSource, setAiSource] = useState<string | null>(null);
  const [aiWarning, setAiWarning] = useState<string | null>(null);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [providerSelection, setProviderSelection] = useState<AiProviderSelection>('github-models');
  const [agentSelection, setAgentSelection] = useState<AiAgentSelection>('triage-l2');
  const [modelSelection, setModelSelection] = useState<AiModelSelection>('provider-default');
  const [customModelInput, setCustomModelInput] = useState('');
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [followUpRunning, setFollowUpRunning] = useState(false);
  const [followUpResult, setFollowUpResult] = useState<string | null>(null);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<FollowUpHistoryEntry[]>([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [compareMode, setCompareMode] = useState(false);
  const [compareAgent, setCompareAgent] = useState<AiAgentSelection>('root-cause');
  const [compareRunning, setCompareRunning] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareResults, setCompareResults] = useState<AgentComparisonResult[] | null>(null);

  useEffect(() => {
    const key = `devassist-ai-followups-${session.id}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as FollowUpHistoryEntry[];
      if (Array.isArray(parsed)) setChatHistory(parsed);
    } catch {
      // ignore malformed local state
    }
  }, [session.id]);

  useEffect(() => {
    if (!session.id) return;
    localStorage.setItem(`devassist-ai-followups-${session.id}`, JSON.stringify(chatHistory));
  }, [chatHistory, session.id]);

  const BRIDGE = getBridgeUrl();

  // Check which AI backend is available on mount
  useEffect(() => {
    fetch(`${BRIDGE}/api/ai-analyze/status`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.ok ? r.json() : null)
      .then((d: AiStatus | null) => {
        setAiStatus(d);
        setOllamaOk(d?.ollama ?? false);
      })
      .catch(() => {
        setAiStatus(null);
        setOllamaOk(false);
      });
  }, [BRIDGE]);

  const hasAnyToken = Boolean(openaiKey || githubPat);
  const canRun = Boolean(aiStatus?.anyBackendReady || hasAnyToken || ollamaOk);
  const providerOptions: Array<{ value: AiProviderSelection; label: string; enabled: boolean }> = [
    { value: 'auto', label: 'Auto (best available)', enabled: true },
    { value: 'github-models', label: 'GitHub Models', enabled: Boolean(githubPat || aiStatus?.githubReady) },
    { value: 'openai', label: 'OpenAI', enabled: Boolean(openaiKey || aiStatus?.openaiReady) },
    { value: 'ollama', label: 'Ollama (local)', enabled: Boolean(aiStatus?.ollama) },
  ];
  const selectedProviderEnabled = providerOptions.find((opt) => opt.value === providerSelection)?.enabled ?? true;
  const agentOptions = aiStatus?.agentModes?.length
    ? aiStatus.agentModes
    : [
        { id: 'triage-l2' as AiAgentSelection, label: 'L2 Triage Agent', description: 'Balanced triage mode' },
        { id: 'root-cause' as AiAgentSelection, label: 'Root Cause Agent', description: 'Cause-chain mode' },
        { id: 'log-forensics' as AiAgentSelection, label: 'Log Forensics Agent', description: 'Stack trace and timeline mode' },
        { id: 'l2-commentary' as AiAgentSelection, label: 'L2 Commentary Agent', description: 'Stakeholder-ready summary mode' },
      ];
  const fallbackModel =
    providerSelection === 'github-models' ? (aiStatus?.defaultModels?.['github-models'] ?? 'gpt-4o-mini') :
    providerSelection === 'openai' ? (aiStatus?.defaultModels?.openai ?? 'gpt-4o-mini') :
    providerSelection === 'ollama' ? (aiStatus?.defaultModels?.ollama ?? aiStatus?.ollamaModels?.[0] ?? 'llama3.2') :
    'provider default';
  const providerCatalog = providerSelection === 'github-models'
    ? (aiStatus?.modelCatalog?.['github-models'] ?? [])
    : providerSelection === 'openai'
      ? (aiStatus?.modelCatalog?.openai ?? [])
      : providerSelection === 'ollama'
        ? (aiStatus?.modelCatalog?.ollama ?? aiStatus?.ollamaModels ?? [])
        : [];
  const modelOptions = ['provider-default', ...providerCatalog, 'custom'];
  const resolvedModelOverride = modelSelection === 'provider-default'
    ? ''
    : modelSelection === 'custom'
      ? customModelInput.trim()
      : modelSelection;
  const followUpTemplates = buildFollowUpTemplates(agentSelection);
  const filteredTemplates = followUpTemplates.filter((template) => {
    const haystack = `${template.label} ${template.prompt}`.toLowerCase();
    return haystack.includes(templateSearch.trim().toLowerCase());
  });

  const applyFollowUpTemplate = (template: FollowUpTemplate) => {
    setFollowUpQuestion(template.prompt);
  };

  const buildRequestBody = (question: string, agent: AiAgentSelection) => {
    const f = session.adoItem?.fields;
    if (!f || !session.adoItem) return null;
    const logHits: Array<{file:string;line:number;seed:string;text:string}> = ((session.snowTask as any)?._logHits ?? [])
      .slice(0, 25)
      .map((h: any) => ({
        file: String(h?.file ?? ''),
        line: Number(h?.line ?? 0),
        seed: String(h?.seed ?? ''),
        text: clampText(h?.text ?? '', 220),
      }));
    const topSeeds: Record<string, number> = (session.snowTask as any)?._topSeeds ?? {};

    return {
      openaiKey: openaiKey || undefined,
      githubPat: githubPat || undefined,
      aiProvider: providerSelection,
      aiModel: resolvedModelOverride || undefined,
      aiAgent: agent,
      question: clampText(question, 600),
      history: chatHistory.slice(-6).map((entry) => ({ question: clampText(entry.question, 260), answer: clampText(entry.answer, 900) })),
      priorAssessment: clampText(result ?? session.analysis?.codeAnalysis ?? session.analysis?.gap ?? session.analysis?.l2Draft ?? '', 1800),
      priorVerdict: session.analysis?.verdict ?? '',
      priorConfidence: session.analysis?.confidence ?? '',
      priorGap: clampText(session.analysis?.gap ?? '', 1000),
      da: {
        id: session.adoItem.id,
        title: f['System.Title'],
        areaPath: f['System.AreaPath'],
        customer: String(f['Allscripts.Field.CustomerName'] ?? ''),
        release: String(f['Allscripts.Field.ReportedinRelease'] ?? f['Allscripts.Field.SupportVersion'] ?? ''),
        severity: String(f['Microsoft.VSTS.Common.Severity'] ?? ''),
        description: clampText(f['System.Description'] ?? f['Allscripts.Field.DevAssistDetail'] ?? '', 1000),
      },
      snowTask: session.snowTask ? {
        number: String((session.snowTask as any).number?.display_value ?? (session.snowTask as any).number ?? ''),
        shortDescription: String((session.snowTask as any).short_description?.display_value ?? ''),
        state: String((session.snowTask as any).state?.display_value ?? ''),
        workNotes: clampText(JSON.stringify((session.snowTask as any)._workNotes ?? ''), 1600),
      } : null,
      logHits,
      topSeeds,
      repos: session.product?.repos.map(r => `${r.owner}/${r.repo}`) ?? [],
    };
  };

  const requestAssessment = async (question: string, agent: AiAgentSelection): Promise<{ assessment: string; source?: string; warning?: string }> => {
    const body = buildRequestBody(question, agent);
    if (!body) throw new Error('Missing ADO item context.');
    const res = await fetch(`${BRIDGE}/api/ai-analyze/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await res.text();
    let data: { assessment?: string; error?: string; source?: string; warning?: string } = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: `Invalid AI response (HTTP ${res.status}).` }; }
    if (!res.ok || data.error) {
      const message = data?.error ?? `HTTP ${res.status}`;
      throw new Error(message || 'AI request failed.');
    }
    return { assessment: data.assessment ?? '', source: data.source, warning: data.warning };
  };

  const runAi = async () => {
    if (!session.adoItem) return;
    setRunning(true); setError(null); setResult(null); setAiSource(null); setAiWarning(null);
    try {
      const data = await requestAssessment(
        session.analysis?.codeAnalysis?.match(/Keyword pattern: "([^"]+)"/)?.[1]
          ? `${followUpQuestion.trim() || 'Summarize the current triage evidence.'}\n\nFocus on the most diagnostic signals and the strongest hypothesis.`
          : (followUpQuestion.trim() || 'Summarize the current triage evidence.'),
        agentSelection
      );
      setResult(data.assessment);
      setAiSource(data.source ?? null);
      setAiWarning(data.warning ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const copyResult = () => {
    if (result) { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const runFollowUp = async () => {
    if (!followUpQuestion.trim() || !session.adoItem) return;
    setFollowUpRunning(true); setFollowUpError(null); setFollowUpResult(null); setAiWarning(null);
    try {
      const data = await requestAssessment(followUpQuestion.trim(), agentSelection);
      const answer = data.assessment;
      setFollowUpResult(answer);
      setChatHistory((prev) => [
        ...prev,
        { question: followUpQuestion.trim(), answer, at: new Date().toISOString() },
      ]);
      setFollowUpQuestion('');
      setAiSource(data.source ?? aiSource ?? null);
      setAiWarning(data.warning ?? null);
    } catch (e: any) {
      setFollowUpError(e.message);
    } finally {
      setFollowUpRunning(false);
    }
  };

  const runCompareAgents = async () => {
    if (!session.adoItem || !followUpQuestion.trim()) return;
    setCompareRunning(true);
    setCompareError(null);
    setCompareResults(null);
    try {
      const question = followUpQuestion.trim();
      const comparisonAgents: AiAgentSelection[] = [agentSelection, compareAgent];
      const responses = await Promise.all(
        comparisonAgents.map(async (agent) => {
          try {
            const data = await requestAssessment(question, agent);
            return {
              agent,
              label: agentLabel(agent),
              assessment: data.assessment,
              source: data.source ?? null,
              warning: data.warning ?? null,
              error: null,
            } satisfies AgentComparisonResult;
          } catch (err: any) {
            return {
              agent,
              label: agentLabel(agent),
              assessment: '',
              source: null,
              warning: null,
              error: err?.message ?? 'AI request failed',
            } satisfies AgentComparisonResult;
          }
        })
      );
      setCompareResults(responses);
    } catch (err: any) {
      setCompareError(err?.message ?? 'Compare failed');
    } finally {
      setCompareRunning(false);
    }
  };

  const sourceLabel: Record<string, string> = {
    'ollama': '🦙 Ollama (local)',
    'openai': '🤖 OpenAI',
    'github-models': '⚡ GitHub Models',
    'deterministic-fallback': '🛡 Deterministic fallback',
  };

  return (
    <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-medium text-purple-300 flex items-center gap-1.5">
            <Sparkles size={13} /> AI Assessment
          </p>
          {ollamaOk === true && (
            <span className="text-xs text-emerald-400 border border-emerald-800 rounded px-1.5 py-0.5">🦙 Ollama ready</span>
          )}
          {ollamaOk === false && !openaiKey && (
            <span className="text-xs text-yellow-600 border border-yellow-900 rounded px-1.5 py-0.5">No local AI</span>
          )}
          {aiStatus?.githubReady && (
            <span className="text-xs text-emerald-300 border border-emerald-800 rounded px-1.5 py-0.5">GitHub model ready</span>
          )}
          {aiStatus?.openaiReady && (
            <span className="text-xs text-cyan-300 border border-cyan-800 rounded px-1.5 py-0.5">OpenAI env ready</span>
          )}
          {aiSource && <span className="text-xs text-gray-500">{sourceLabel[aiSource] ?? aiSource}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {result && (
            <button onClick={copyResult}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white border border-gray-700 px-2 py-1 rounded">
              {copied ? <><CheckCircle2 size={11} className="text-emerald-400"/> Copied</> : <><ClipboardCopy size={11}/> Copy</>}
            </button>
          )}
          <button onClick={runAi} disabled={running || !canRun || (providerSelection !== 'auto' && !selectedProviderEnabled)}
            className="flex items-center justify-center gap-1.5 text-xs bg-purple-900/60 hover:bg-purple-900/90 disabled:opacity-40 border border-purple-600 text-purple-100 px-3 py-1.5 rounded font-medium w-full sm:w-auto">
            {running ? <><Loader2 size={11} className="animate-spin"/> Asking AI...</>
            : result  ? <><Sparkles size={11}/> Re-run</>
            : <><Sparkles size={11}/> Ask AI</>}
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[11px] text-gray-400 space-y-1">
          <span className="uppercase tracking-wide">LLM provider</span>
          <select
            value={providerSelection}
            onChange={(e) => {
              setProviderSelection(e.target.value as AiProviderSelection);
              setModelSelection('provider-default');
            }}
            className="w-full bg-gray-950 border border-gray-700 rounded px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-cyan-500"
          >
            {providerOptions.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={!opt.enabled && opt.value !== 'auto'}>
                {opt.label}{!opt.enabled && opt.value !== 'auto' ? ' (not ready)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="text-[11px] text-gray-400 space-y-1">
          <span className="uppercase tracking-wide">LLM model</span>
          <select
            value={modelSelection}
            onChange={(e) => setModelSelection(e.target.value as AiModelSelection)}
            className="w-full bg-gray-950 border border-gray-700 rounded px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-cyan-500"
          >
            {modelOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt === 'provider-default' ? `Provider default (${fallbackModel})` : opt === 'custom' ? 'Custom model...' : opt}
              </option>
            ))}
          </select>
        </label>

        <label className="text-[11px] text-gray-400 space-y-1">
          <span className="uppercase tracking-wide">Agent mode</span>
          <select
            value={agentSelection}
            onChange={(e) => setAgentSelection(e.target.value as AiAgentSelection)}
            className="w-full bg-gray-950 border border-gray-700 rounded px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-cyan-500"
          >
            {agentOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </label>
      </div>

      {modelSelection === 'custom' && (
        <label className="text-[11px] text-gray-400 space-y-1 block">
          <span className="uppercase tracking-wide">Custom model name</span>
          <input
            value={customModelInput}
            onChange={(e) => setCustomModelInput(e.target.value)}
            placeholder={fallbackModel}
            className="w-full bg-gray-950 border border-gray-700 rounded px-2.5 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500"
          />
        </label>
      )}

      <p className="text-[11px] text-gray-500">
        {agentOptions.find((a) => a.id === agentSelection)?.description ?? 'Select an agent mode tuned for your triage objective.'}
      </p>

      <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Prompt presets</p>
          <label className="text-[11px] text-gray-500 flex items-center gap-2">
            <span>Search</span>
            <input
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              placeholder="filter presets"
              className="w-36 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200 focus:outline-none focus:border-gray-500"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {filteredTemplates.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => applyFollowUpTemplate(template)}
              className="text-[10px] px-2.5 py-1 rounded border border-gray-700 bg-gray-950/60 text-gray-300 hover:border-gray-500 hover:text-white"
            >
              {template.label}
            </button>
          ))}
          {filteredTemplates.length === 0 && (
            <span className="text-[11px] text-gray-500">No presets match that search.</span>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Compare agents</p>
          <label className="text-[11px] text-gray-500 flex items-center gap-2">
            <input
              type="checkbox"
              checked={compareMode}
              onChange={(e) => setCompareMode(e.target.checked)}
              className="accent-gray-300"
            />
            Side-by-side mode
          </label>
        </div>
        {compareMode && (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <select
              value={compareAgent}
              onChange={(e) => setCompareAgent(e.target.value as AiAgentSelection)}
              className="w-full bg-gray-950 border border-gray-700 rounded px-2.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
            >
              {agentOptions.filter((opt) => opt.id !== agentSelection).map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={runCompareAgents}
              disabled={compareRunning || !followUpQuestion.trim() || !session.adoItem}
              className="text-xs px-3 py-2 rounded border border-gray-700 bg-gray-900 text-gray-200 hover:bg-gray-800 disabled:opacity-40"
            >
              {compareRunning ? 'Comparing...' : 'Compare agents'}
            </button>
          </div>
        )}
        {compareError && <p className="text-xs text-red-400 font-mono whitespace-pre-wrap">Error: {compareError}</p>}
        {compareResults && compareResults.length > 0 && (
          <div className="grid gap-2 lg:grid-cols-2">
            {compareResults.map((item) => (
              <div key={item.agent} className="rounded border border-gray-700 bg-gray-950/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-semibold text-gray-300">{item.label}</p>
                  {item.source && <span className="text-[10px] text-gray-500 uppercase tracking-wide">{item.source}</span>}
                </div>
                {item.error ? (
                  <p className="text-xs text-red-400 whitespace-pre-wrap">{item.error}</p>
                ) : (
                  <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-auto">{item.assessment}</pre>
                )}
                {item.warning && <p className="text-[11px] text-yellow-300 whitespace-pre-wrap">{item.warning}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {providerSelection !== 'auto' && !selectedProviderEnabled && (
        <p className="text-xs text-yellow-400">Selected provider is not ready. Configure credentials/runtime or switch provider.</p>
      )}

      {aiSource === 'deterministic-fallback' && (
        <div className="rounded border border-yellow-800/70 bg-yellow-950/20 px-2.5 py-2 text-xs text-yellow-200">
          External AI route is unavailable in this environment. DevAssist switched to deterministic ticket-analysis mode so triage can continue.
        </div>
      )}

      {aiWarning && (
        <p className="text-xs text-yellow-300 whitespace-pre-wrap">Provider warning: {aiWarning}</p>
      )}

      {!canRun && (
        <div className="text-xs text-yellow-600 space-y-1">
          <p>No AI backend is configured for this session.</p>
          <p>• <strong className="text-yellow-400">Preferred</strong>: add GitHub PAT in <a href={`${import.meta.env.BASE_URL}settings`} className="underline text-yellow-400">Settings</a> so bridge can use GitHub Models.</p>
          <p>• <strong className="text-yellow-400">Fallback</strong>: add OpenAI key or run local Ollama at <code>http://localhost:11434</code>.</p>
        </div>
      )}
      {error && <p className="text-xs text-red-400 font-mono whitespace-pre-wrap">Error: {error}</p>}
      {result && (
        <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono leading-relaxed bg-gray-900/60 rounded p-3 max-h-96 overflow-auto border border-gray-700">
          {result}
        </pre>
      )}

      <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Saved follow-up history</p>
          {chatHistory.length > 0 && (
            <button
              type="button"
              onClick={() => setChatHistory([])}
              className="text-[10px] text-gray-400 hover:text-white border border-gray-700 rounded px-2 py-1"
            >
              Clear
            </button>
          )}
        </div>

        {chatHistory.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-auto pr-1">
            {chatHistory.map((entry, idx) => (
              <div key={`${entry.at}-${idx}`} className="rounded border border-gray-700 bg-gray-950/40 p-2 space-y-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">Question</p>
                  <p className="text-xs text-gray-200 whitespace-pre-wrap">{entry.question}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">Answer</p>
                  <pre className="text-[11px] text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">{entry.answer}</pre>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No saved follow-up history yet. Ask the first question below.</p>
        )}

        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Continue with AI</p>
        <textarea
          value={followUpQuestion}
          onChange={(e) => setFollowUpQuestion(e.target.value)}
          rows={3}
          placeholder="Ask a follow-up or use the presets above to drive the analysis."
          className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 resize-y focus:outline-none focus:border-altera-teal/60"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={runFollowUp}
            disabled={followUpRunning || !canRun || !followUpQuestion.trim() || (providerSelection !== 'auto' && !selectedProviderEnabled)}
            className="flex items-center justify-center gap-1.5 text-xs bg-cyan-900/50 hover:bg-cyan-900/80 disabled:opacity-40 border border-cyan-600 text-cyan-100 px-3 py-1.5 rounded font-medium"
          >
            {followUpRunning ? <><Loader2 size={11} className="animate-spin" /> Continuing...</> : <><Sparkles size={11} /> Continue</>}
          </button>
        </div>
        {followUpError && <p className="text-xs text-red-400 font-mono whitespace-pre-wrap">Error: {followUpError}</p>}
        {followUpResult && (
          <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono leading-relaxed bg-gray-950/50 rounded p-3 max-h-72 overflow-auto border border-gray-700">
            {followUpResult}
          </pre>
        )}
      </div>

      {!result && !error && canRun && !running && (
        <p className="text-xs text-gray-600">
          {ollamaOk ? 'Ollama detected — click "Ask AI" to run locally.' : 'Click "Ask AI" to use the configured model route for this session.'}
        </p>
      )}
    </div>
  );
}