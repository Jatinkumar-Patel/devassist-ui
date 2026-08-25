import { Router, Request, Response } from 'express';
import { execPowerShell } from '../utils/powershell';

export const snowRouter = Router();

// Correct path: /api/SNData/ prefix is required per snow-viewer-api.md
const SNOW_BASE = 'https://servicenowviewer.allscripts.com/api/SNData';

/** Double-decode: SNOW viewer returns a JSON-stringified JSON string */
function snowDecode(raw: string): unknown {
  const text = raw.trim();

  const parseCandidate = (candidate: string): unknown => {
    const outer = JSON.parse(candidate);
    return typeof outer === 'string' ? JSON.parse(outer) : outer;
  };

  const parseEscapedStringEnvelope = (candidate: string): unknown => {
    // Some responses are quoted JSON strings that contain escaped CR/LF and quotes.
    // Example shape: "{\r\n  \"result\": [...] }"
    const unwrapped = candidate.replace(/^"|"$/g, '');
    const normalized = unwrapped
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    return JSON.parse(normalized);
  };

  try {
    return parseCandidate(text);
  } catch {
    try {
      return parseEscapedStringEnvelope(text);
    } catch {
      // Continue to wrapper/trailing-noise recovery.
    }

    // Some viewer responses include wrapper/trailing noise; recover by extracting the JSON envelope.
    const firstBrace = text.search(/[\[{]/);
    const lastObj = text.lastIndexOf('}');
    const lastArr = text.lastIndexOf(']');
    const lastBrace = Math.max(lastObj, lastArr);

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const sliced = text.slice(firstBrace, lastBrace + 1);
      try {
        return parseCandidate(sliced);
      } catch {
        return parseEscapedStringEnvelope(sliced);
      }
    }

    throw new Error('Unable to decode SNOW payload');
  }
}

function snowFetch(url: string): Promise<string> {
  return execPowerShell(
    `(Invoke-WebRequest -Uri '${url}' -UseDefaultCredentials -UseBasicParsing).Content`
  );
}

function escapePsSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

async function snowFetchDecoded(url: string): Promise<unknown> {
  const escapedUrl = escapePsSingleQuoted(url);
  const json = await execPowerShell(
    `$raw = (Invoke-WebRequest -Uri '${escapedUrl}' -UseDefaultCredentials -UseBasicParsing).Content; ` +
    `$parsed = $raw | ConvertFrom-Json; ` +
    `if ($parsed -is [string]) { $parsed = $parsed | ConvertFrom-Json }; ` +
    `$parsed | ConvertTo-Json -Depth 100`
  );
  const cleaned = json.replace(/^\uFEFF/, '').trim();
  const withoutControlChars = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');

  try {
    return JSON.parse(withoutControlChars);
  } catch {
    const firstBrace = withoutControlChars.search(/[\[{]/);
    const lastObj = withoutControlChars.lastIndexOf('}');
    const lastArr = withoutControlChars.lastIndexOf(']');
    const lastBrace = Math.max(lastObj, lastArr);

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(withoutControlChars.slice(firstBrace, lastBrace + 1));
    }

    throw new Error('Unable to parse SNOW decoded payload');
  }
}

// GET /api/snow/task/:number — auto-detects incident_task vs sc_task
snowRouter.get('/task/:number', async (req: Request, res: Response) => {
  const { number } = req.params;
  if (!/^TASK\d+$/i.test(number)) {
    return res.status(400).json({ error: 'Expected TASK… number' });
  }
  const num = number.toUpperCase();
  for (const table of ['incident_task', 'sc_task']) {
    try {
      const url = `${SNOW_BASE}/GetTableJSON/?tablename=${table}&sysparm_query=number=${num}`;
      const decoded = snowDecode(await snowFetch(url)) as { result?: unknown[] };
      const records = Array.isArray(decoded?.result) ? decoded.result : [];
      if (records.length > 0) return res.json({ result: records, table });
    } catch { /* try next table */ }
  }
  return res.status(404).json({ error: `Task ${num} not found in incident_task or sc_task` });
});

// GET /api/snow/worknotes/:sysId — work notes + comments (separate endpoint per skill)
snowRouter.get('/worknotes/:sysId', async (req: Request, res: Response) => {
  const { sysId } = req.params;
  const url = `${SNOW_BASE}/GetCommentsAndWorkNotes/?sysid=${sysId}`;
  try {
    return res.json(snowDecode(await snowFetch(url)));
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

// GET /api/snow/attachments/:sysId — list attachment metadata
snowRouter.get('/attachments/:sysId', async (req: Request, res: Response) => {
  const { sysId } = req.params;
  const url = `${SNOW_BASE}/GetAttachments/?sysid=${sysId}`;
  try {
    return res.json(snowDecode(await snowFetch(url)));
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

// GET /api/snow/attachment/:attachmentSysId — download one attachment
// Use GetAttachment on the viewer, NOT download_link (service-now.com SSO blocks it)
snowRouter.get('/attachment/:attachmentSysId', async (req: Request, res: Response) => {
  const { attachmentSysId } = req.params;
  try {
    const raw = await execPowerShell(
      `(Invoke-WebRequest -Uri '${SNOW_BASE}/GetAttachment/?sysid=${attachmentSysId}' ` +
      `-UseDefaultCredentials -UseBasicParsing).Content`
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(raw);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/snow/incident/:number — fetch incident (INC…)
snowRouter.get('/incident/:number', async (req: Request, res: Response) => {
  const { number } = req.params;
  const fields = [
    'sys_id',
    'number',
    'state',
    'short_description',
    'description',
    'priority',
    'assigned_to',
    'assignment_group',
    'parent',
    'u_case_number',
    'u_customer_case',
    'opened_at',
  ].join(',');
  const url = `${SNOW_BASE}/GetTableJSON/?tablename=incident&sysparm_query=number=${number.toUpperCase()}&sysparm_fields=${fields}`;
  try {
    return res.json(await snowFetchDecoded(url));
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

// GET /api/snow/case/:number — fetch client case (CS…)
snowRouter.get('/case/:number', async (req: Request, res: Response) => {
  const { number } = req.params;
  const fields = [
    'sys_id',
    'number',
    'state',
    'short_description',
    'description',
    'priority',
    'assigned_to',
    'assignment_group',
    'opened_at',
  ].join(',');
  const url = `${SNOW_BASE}/GetTableJSON/?tablename=sn_customerservice_case&sysparm_query=number=${number.toUpperCase()}&sysparm_fields=${fields}`;
  try {
    return res.json(await snowFetchDecoded(url));
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

// GET /api/snow/incident-by-case/:number — find incident linked to a CS case
snowRouter.get('/incident-by-case/:number', async (req: Request, res: Response) => {
  const { number } = req.params;
  const caseNum = number.toUpperCase();
  const fields = [
    'sys_id',
    'number',
    'state',
    'short_description',
    'description',
    'priority',
    'assigned_to',
    'assignment_group',
    'parent',
    'u_case_number',
    'u_customer_case',
    'u_devid',
    'u_dev_id',
    'u_vsts_id',
    'u_tfs_id',
    'opened_at',
  ].join(',');
  const query = encodeURIComponent(`parent.number=${caseNum}^ORu_case_number=${caseNum}^ORu_customer_case=${caseNum}`);
  const url = `${SNOW_BASE}/GetTableJSON/?tablename=incident&sysparm_query=${query}&sysparm_fields=${fields}`;
  try {
    return res.json(await snowFetchDecoded(url));
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

// GET /api/snow/escalate/:taskSysId — Task → Incident → Case chain per snow-viewer-api.md
snowRouter.get('/escalate/:taskSysId', async (req: Request, res: Response) => {
  const { taskSysId } = req.params;
  try {
    const taskUrl = `${SNOW_BASE}/GetTableJSON/?tablename=incident_task` +
      `&sysparm_query=sys_id=${taskSysId}` +
      `&sysparm_fields=sys_id,number,incident,incident.number,incident.sys_id`;
    const taskData = await snowFetchDecoded(taskUrl) as { result?: any[] };
    const task = taskData?.result?.[0];
    if (!task) return res.json({ incident: null, case: null });

    const incSysId = task['incident.sys_id']?.value ?? task['incident']?.value;
    if (!incSysId) return res.json({ incident: null, case: null });

    const incFields = [
      'sys_id',
      'number',
      'state',
      'short_description',
      'description',
      'priority',
      'assigned_to',
      'assignment_group',
      'parent',
      'u_case_number',
      'u_customer_case',
      'opened_at',
    ].join(',');
    const incData = await snowFetchDecoded(
      `${SNOW_BASE}/GetTableJSON/?tablename=incident&sysparm_query=sys_id=${incSysId}&sysparm_fields=${incFields}`
    ) as { result?: any[] };
    const incident = incData?.result?.[0] ?? null;

    let clientCase = null;
    const caseNum = incident?.['u_case_number']?.value ?? incident?.['u_customer_case']?.value;
    if (caseNum) {
      const caseFields = [
        'sys_id',
        'number',
        'state',
        'short_description',
        'description',
        'priority',
        'assigned_to',
        'assignment_group',
        'opened_at',
      ].join(',');
      const caseData = await snowFetchDecoded(
        `${SNOW_BASE}/GetTableJSON/?tablename=sn_customerservice_case&sysparm_query=number=${caseNum}&sysparm_fields=${caseFields}`
      ) as { result?: any[] };
      clientCase = caseData?.result?.[0] ?? null;
    }

    return res.json({ incident, case: clientCase });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});
