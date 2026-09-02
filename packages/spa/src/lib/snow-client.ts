import { bridgeApi } from './bridge-url';

export async function fetchSnowTask(number: string, preferredTables: string[] = []) {
  const normalizedTables = Array.from(
    new Set(preferredTables.map((x) => String(x ?? '').trim()).filter(Boolean))
  );
  const query = normalizedTables.length
    ? `?tables=${encodeURIComponent(normalizedTables.join(','))}`
    : '';
  const res = await fetch(bridgeApi(`/api/snow/task/${encodeURIComponent(number)}${query}`));
  if (!res.ok) throw new Error(`SNOW task ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchSnowWorkNotes(sysId: string) {
  const res = await fetch(bridgeApi(`/api/snow/worknotes/${encodeURIComponent(sysId)}`));
  if (!res.ok) throw new Error(`SNOW work notes ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchSnowIncident(number: string) {
  const res = await fetch(bridgeApi(`/api/snow/incident/${encodeURIComponent(number)}`));
  if (!res.ok) throw new Error(`SNOW incident ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchSnowCase(number: string) {
  const res = await fetch(bridgeApi(`/api/snow/case/${encodeURIComponent(number)}`));
  if (!res.ok) throw new Error(`SNOW case ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchSnowIncidentByCase(number: string) {
  const res = await fetch(bridgeApi(`/api/snow/incident-by-case/${encodeURIComponent(number)}`));
  if (!res.ok) throw new Error(`SNOW incident-by-case ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchSnowTasksByIncident(number: string) {
  const res = await fetch(bridgeApi(`/api/snow/incident-tasks/${encodeURIComponent(number)}`));
  if (!res.ok) throw new Error(`SNOW incident-tasks ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchSnowKbSearch(terms: string[], releaseHints: string[] = []) {
  const res = await fetch(bridgeApi('/api/snow/kb-search'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terms, releaseHints }),
  });
  if (!res.ok) throw new Error(`SNOW KB search ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ result?: Array<Record<string, unknown>> }>;
}

export async function fetchSnowLookups() {
  const res = await fetch(bridgeApi('/api/snow/lookups'));
  const body = await res.text();
  if (!res.ok) throw new Error(`SNOW lookups ${res.status}: ${body.slice(0, 220)}`);

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const looksLikeHtml = /<!doctype html>|<html[\s>]/i.test(body);
  if (!contentType.includes('application/json') || looksLikeHtml) {
    throw new Error('SNOW lookups endpoint unavailable on this bridge. Restart bridge with latest code (npm run bridge).');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('SNOW lookups returned invalid JSON. Restart bridge with latest code (npm run bridge).');
  }

  return parsed as {
    assignmentGroups: string[];
    products: string[];
    sampledAt?: string;
    sourceTables?: string[];
  };
}

/** List attachment metadata — use fetchSnowAttachment() to download the binary */
export async function fetchSnowAttachments(sysId: string) {
  const res = await fetch(bridgeApi(`/api/snow/attachments/${encodeURIComponent(sysId)}`));
  if (!res.ok) throw new Error(`Attachments ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Download a single attachment by its attachment sys_id (NOT the record sys_id) */
export async function downloadSnowAttachment(attachmentSysId: string): Promise<Blob> {
  const res = await fetch(bridgeApi(`/api/snow/attachment/${encodeURIComponent(attachmentSysId)}`));
  if (!res.ok) throw new Error(`Attachment download ${res.status}`);
  return res.blob();
}

/** Escalate Task → Incident → Case when the task is thin (few notes / no logs) */
export async function escalateSnowTask(taskSysId: string) {
  const res = await fetch(bridgeApi(`/api/snow/escalate/${encodeURIComponent(taskSysId)}`));
  if (!res.ok) throw new Error(`Escalate ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ incident: SnowRecord | null; case: SnowRecord | null }>;
}

/** Helper: extract display_value or value from a SNOW field object */
export function snowVal(field: unknown): string {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object') {
    const f = field as Record<string, string>;
    return f['display_value'] ?? f['value'] ?? '';
  }
  return String(field);
}

export type SnowRecord = Record<string, unknown>;

export function snowTaskUrl(number: string): string {
  return `https://servicenowviewer.allscripts.com/incidenttask?number=${number}`;
}

export function snowIncidentUrl(number: string): string {
  return `https://servicenowviewer.allscripts.com/incident?number=${number}`;
}
