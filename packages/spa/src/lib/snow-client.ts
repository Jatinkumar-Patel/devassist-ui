import { bridgeApi } from './bridge-url';

export async function fetchSnowTask(number: string) {
  const res = await fetch(bridgeApi(`/api/snow/task/${encodeURIComponent(number)}`));
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
