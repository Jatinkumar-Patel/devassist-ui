import { Router, Request, Response } from 'express';
import { execPowerShell } from '../utils/powershell';

export const snowRouter = Router();

// Correct path: /api/SNData/ prefix is required per snow-viewer-api.md
const SNOW_BASE = 'https://servicenowviewer.allscripts.com/api/SNData';

/** Double-decode: SNOW viewer returns a JSON-stringified JSON string */
function snowDecode(raw: string): unknown {
  const outer = JSON.parse(raw.trim());
  return typeof outer === 'string' ? JSON.parse(outer) : outer;
}

function snowFetch(url: string): Promise<string> {
  return execPowerShell(
    `(Invoke-WebRequest -Uri '${url}' -UseDefaultCredentials -UseBasicParsing).Content`
  );
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
  const url = `${SNOW_BASE}/GetTableJSON/?tablename=incident&sysparm_query=number=${number.toUpperCase()}`;
  try {
    return res.json(snowDecode(await snowFetch(url)));
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

// GET /api/snow/case/:number — fetch client case (CS…)
snowRouter.get('/case/:number', async (req: Request, res: Response) => {
  const { number } = req.params;
  const url = `${SNOW_BASE}/GetTableJSON/?tablename=sn_customerservice_case&sysparm_query=number=${number.toUpperCase()}`;
  try {
    return res.json(snowDecode(await snowFetch(url)));
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
    const taskData = snowDecode(await snowFetch(taskUrl)) as { result?: any[] };
    const task = taskData?.result?.[0];
    if (!task) return res.json({ incident: null, case: null });

    const incSysId = task['incident.sys_id']?.value ?? task['incident']?.value;
    if (!incSysId) return res.json({ incident: null, case: null });

    const incData = snowDecode(
      await snowFetch(`${SNOW_BASE}/GetTableJSON/?tablename=incident&sysparm_query=sys_id=${incSysId}`)
    ) as { result?: any[] };
    const incident = incData?.result?.[0] ?? null;

    let clientCase = null;
    const caseNum = incident?.['u_case_number']?.value ?? incident?.['u_customer_case']?.value;
    if (caseNum) {
      const caseData = snowDecode(
        await snowFetch(`${SNOW_BASE}/GetTableJSON/?tablename=sn_customerservice_case&sysparm_query=number=${caseNum}`)
      ) as { result?: any[] };
      clientCase = caseData?.result?.[0] ?? null;
    }

    return res.json({ incident, case: clientCase });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});
