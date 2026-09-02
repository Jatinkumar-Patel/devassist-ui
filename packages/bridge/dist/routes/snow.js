"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snowRouter = void 0;
const express_1 = require("express");
const powershell_1 = require("../utils/powershell");
exports.snowRouter = (0, express_1.Router)();
const KNOWN_TASK_TABLES = ['incident_task', 'sc_task', 'u_pltf_task', 'change_task', 'sc_req_item', 'sn_customerservice_task'];
// Correct path: /api/SNData/ prefix is required per snow-viewer-api.md
const SNOW_BASE = 'https://servicenowviewer.allscripts.com/api/SNData';
/** Double-decode: SNOW viewer returns a JSON-stringified JSON string */
function snowDecode(raw) {
    const stripControlChars = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
    // Strip bad control chars from the raw text BEFORE any JSON parse attempt
    const text = stripControlChars(raw.trim());
    const parseCandidate = (candidate) => {
        const outer = JSON.parse(candidate);
        if (typeof outer === 'string') {
            return JSON.parse(stripControlChars(outer));
        }
        return outer;
    };
    const parseEscapedStringEnvelope = (candidate) => {
        // Some responses are quoted JSON strings that contain escaped CR/LF and quotes.
        // Example shape: "{\r\n  \"result\": [...] }"
        const unwrapped = candidate.replace(/^"|"$/g, '');
        const normalized = stripControlChars(unwrapped
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\'));
        return JSON.parse(normalized);
    };
    try {
        return parseCandidate(text);
    }
    catch {
        try {
            return parseEscapedStringEnvelope(text);
        }
        catch {
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
            }
            catch {
                return parseEscapedStringEnvelope(sliced);
            }
        }
        throw new Error('Unable to decode SNOW payload');
    }
}
function snowFetch(url) {
    return (0, powershell_1.execPowerShell)(`(Invoke-WebRequest -Uri '${url}' -UseDefaultCredentials -UseBasicParsing).Content`);
}
function escapePsSingleQuoted(value) {
    return value.replace(/'/g, "''");
}
function escapeSnowQuery(value) {
    return value.replace(/[\^=~]/g, ' ').replace(/\s+/g, ' ').trim();
}
function snowFieldValue(field) {
    if (!field)
        return '';
    if (typeof field === 'string')
        return field;
    if (typeof field === 'number' || typeof field === 'boolean')
        return String(field);
    if (typeof field === 'object') {
        const rec = field;
        const displayValue = rec['display_value'];
        const value = rec['value'];
        if (typeof displayValue === 'string' && displayValue.trim())
            return displayValue.trim();
        if (typeof value === 'string' && value.trim())
            return value.trim();
        if (typeof displayValue === 'number' || typeof displayValue === 'boolean')
            return String(displayValue);
        if (typeof value === 'number' || typeof value === 'boolean')
            return String(value);
        return '';
    }
    return '';
}
function pickSnowProductField(row) {
    const candidates = [
        snowFieldValue(row['u_product']),
        snowFieldValue(row['product']),
        snowFieldValue(row['cmdb_ci']),
        snowFieldValue(row['service_offering']),
        snowFieldValue(row['business_service']),
    ].filter(Boolean);
    return candidates[0] ?? '';
}
function getIncidentCaseNumber(incident) {
    if (!incident)
        return null;
    const candidates = [
        snowFieldValue(incident['u_case_number']),
        snowFieldValue(incident['u_customer_case']),
        snowFieldValue(incident['parent']),
        snowFieldValue(incident['parent.number']),
    ].filter(Boolean);
    return candidates.find((value) => /^CS\d+$/i.test(value)) ?? null;
}
async function snowFetchDecoded(url) {
    const escapedUrl = escapePsSingleQuoted(url);
    const json = await (0, powershell_1.execPowerShell)(`$raw = (Invoke-WebRequest -Uri '${escapedUrl}' -UseDefaultCredentials -UseBasicParsing).Content; ` +
        `$parsed = $raw | ConvertFrom-Json; ` +
        `if ($parsed -is [string]) { $parsed = $parsed | ConvertFrom-Json }; ` +
        `$parsed | ConvertTo-Json -Depth 100`);
    const cleaned = json.replace(/^\uFEFF/, '').trim();
    const withoutControlChars = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
    try {
        return JSON.parse(withoutControlChars);
    }
    catch {
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
// GET /api/snow/task/:number — auto-detects across all known Allscripts task tables
exports.snowRouter.get('/task/:number', async (req, res) => {
    const { number } = req.params;
    if (!/^TASK\d+$/i.test(number)) {
        return res.status(400).json({ error: 'Expected TASK… number' });
    }
    const num = number.toUpperCase();
    const requestedTablesRaw = req.query.tables;
    const requestedTables = (Array.isArray(requestedTablesRaw) ? requestedTablesRaw : [requestedTablesRaw])
        .flatMap((value) => String(value ?? '').split(','))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    const allowedTableSet = new Set(KNOWN_TASK_TABLES);
    const preferredTables = Array.from(new Set(requestedTables.filter((table) => allowedTableSet.has(table))));
    // Try caller-preferred tables first, then remaining known tables.
    const tables = [
        ...preferredTables,
        ...KNOWN_TASK_TABLES.filter((table) => !preferredTables.includes(table)),
    ];
    for (const table of tables) {
        try {
            const url = `${SNOW_BASE}/GetTableJSON/?tablename=${table}&sysparm_query=number=${num}`;
            const decoded = snowDecode(await snowFetch(url));
            const records = Array.isArray(decoded?.result) ? decoded.result : [];
            if (records.length > 0)
                return res.json({ result: records, table });
        }
        catch { /* try next table */ }
    }
    return res.status(404).json({ error: `Task ${num} not found in any known task table (tried: ${tables.join(', ')})` });
});
// GET /api/snow/worknotes/:sysId — work notes + comments (separate endpoint per skill)
exports.snowRouter.get('/worknotes/:sysId', async (req, res) => {
    const { sysId } = req.params;
    const url = `${SNOW_BASE}/GetCommentsAndWorkNotes/?sysid=${sysId}`;
    try {
        return res.json(snowDecode(await snowFetch(url)));
    }
    catch (err) {
        return res.status(502).json({ error: err.message });
    }
});
// GET /api/snow/attachments/:sysId — list attachment metadata
exports.snowRouter.get('/attachments/:sysId', async (req, res) => {
    const { sysId } = req.params;
    const url = `${SNOW_BASE}/GetAttachments/?sysid=${sysId}`;
    try {
        return res.json(snowDecode(await snowFetch(url)));
    }
    catch (err) {
        return res.status(502).json({ error: err.message });
    }
});
// GET /api/snow/attachment/:attachmentSysId — download one attachment
// Use GetAttachment on the viewer, NOT download_link (service-now.com SSO blocks it)
exports.snowRouter.get('/attachment/:attachmentSysId', async (req, res) => {
    const { attachmentSysId } = req.params;
    try {
        const raw = await (0, powershell_1.execPowerShell)(`(Invoke-WebRequest -Uri '${SNOW_BASE}/GetAttachment/?sysid=${attachmentSysId}' ` +
            `-UseDefaultCredentials -UseBasicParsing).Content`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.send(raw);
    }
    catch (err) {
        res.status(502).json({ error: err.message });
    }
});
// GET /api/snow/incident/:number — fetch incident (INC…)
exports.snowRouter.get('/incident/:number', async (req, res) => {
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
    }
    catch (err) {
        return res.status(502).json({ error: err.message });
    }
});
// GET /api/snow/case/:number — fetch client case (CS…)
exports.snowRouter.get('/case/:number', async (req, res) => {
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
    }
    catch (err) {
        return res.status(502).json({ error: err.message });
    }
});
// GET /api/snow/incident-by-case/:number — find incident linked to a CS case
exports.snowRouter.get('/incident-by-case/:number', async (req, res) => {
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
    }
    catch (err) {
        return res.status(502).json({ error: err.message });
    }
});
// GET /api/snow/incident-tasks/:number — fetch TASK records linked to an incident
exports.snowRouter.get('/incident-tasks/:number', async (req, res) => {
    const { number } = req.params;
    const incNum = number.toUpperCase();
    const fields = [
        'sys_id',
        'number',
        'state',
        'short_description',
        'description',
        'priority',
        'assigned_to',
        'assignment_group',
        'incident',
        'incident.number',
        'u_devid',
        'u_dev_id',
        'u_vsts_id',
        'u_tfs_id',
        'u_case_number',
        'u_customer_case',
        'opened_at',
    ].join(',');
    for (const table of ['incident_task', 'sc_task']) {
        try {
            const query = encodeURIComponent(`incident.number=${incNum}`);
            const url = `${SNOW_BASE}/GetTableJSON/?tablename=${table}&sysparm_query=${query}&sysparm_fields=${fields}`;
            const decoded = await snowFetchDecoded(url);
            const records = Array.isArray(decoded?.result) ? decoded.result : [];
            if (records.length > 0)
                return res.json({ result: records, table });
        }
        catch {
            // try next table
        }
    }
    return res.json({ result: [], table: null });
});
// GET /api/snow/escalate/:taskSysId — Task → Incident → Case chain per snow-viewer-api.md
exports.snowRouter.get('/escalate/:taskSysId', async (req, res) => {
    const { taskSysId } = req.params;
    try {
        const taskUrl = `${SNOW_BASE}/GetTableJSON/?tablename=incident_task` +
            `&sysparm_query=sys_id=${taskSysId}` +
            `&sysparm_fields=sys_id,number,incident,incident.number,incident.sys_id`;
        const taskData = await snowFetchDecoded(taskUrl);
        const task = taskData?.result?.[0];
        if (!task)
            return res.json({ incident: null, case: null });
        const incSysId = task['incident.sys_id']?.value ?? task['incident']?.value;
        if (!incSysId)
            return res.json({ incident: null, case: null });
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
        const incData = await snowFetchDecoded(`${SNOW_BASE}/GetTableJSON/?tablename=incident&sysparm_query=sys_id=${incSysId}&sysparm_fields=${incFields}`);
        const incident = incData?.result?.[0] ?? null;
        let clientCase = null;
        const caseNum = getIncidentCaseNumber(incident);
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
            const caseData = await snowFetchDecoded(`${SNOW_BASE}/GetTableJSON/?tablename=sn_customerservice_case&sysparm_query=number=${caseNum}&sysparm_fields=${caseFields}`);
            clientCase = caseData?.result?.[0] ?? null;
        }
        return res.json({ incident, case: clientCase });
    }
    catch (err) {
        return res.status(502).json({ error: err.message });
    }
});
// GET /api/snow/lookups — distinct Product + Assignment Group options from recent SNOW records
exports.snowRouter.get('/lookups', async (_req, res) => {
    const tables = ['incident_task', 'sc_task', 'sn_customerservice_task', 'sn_customerservice_case'];
    const assignmentGroups = new Set();
    const products = new Set();
    const fields = [
        'assignment_group',
        'u_product',
        'product',
        'cmdb_ci',
        'service_offering',
        'business_service',
        'sys_updated_on',
    ].join(',');
    try {
        for (const table of tables) {
            try {
                const query = encodeURIComponent('active=true^ORDERBYDESCsys_updated_on');
                const url = `${SNOW_BASE}/GetTableJSON/?tablename=${table}&sysparm_query=${query}&sysparm_fields=${fields}&sysparm_limit=300`;
                const decoded = await snowFetchDecoded(url);
                const rows = Array.isArray(decoded?.result) ? decoded.result : [];
                for (const row of rows) {
                    const group = snowFieldValue(row.assignment_group);
                    if (group)
                        assignmentGroups.add(group);
                    const product = pickSnowProductField(row);
                    if (product)
                        products.add(product);
                }
            }
            catch {
                // Skip individual table failures; return best-effort merged list.
            }
        }
        const sortAlpha = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
        return res.json({
            assignmentGroups: Array.from(assignmentGroups).sort(sortAlpha),
            products: Array.from(products).sort(sortAlpha),
            sampledAt: new Date().toISOString(),
            sourceTables: tables,
        });
    }
    catch (err) {
        return res.status(502).json({ error: err.message });
    }
});
// POST /api/snow/kb-search — find related KB articles by terms + release hints
exports.snowRouter.post('/kb-search', async (req, res) => {
    const terms = Array.isArray(req.body?.terms) ? req.body.terms : [];
    const releaseHints = Array.isArray(req.body?.releaseHints) ? req.body.releaseHints : [];
    const normalizedTerms = [...terms, ...releaseHints]
        .map((v) => String(v ?? '').trim())
        .filter((v) => v.length >= 3)
        .map(escapeSnowQuery)
        .slice(0, 8);
    if (!normalizedTerms.length) {
        return res.json({ result: [] });
    }
    const fields = [
        'sys_id',
        'number',
        'short_description',
        'workflow_state',
        'published',
        'sys_updated_on',
        'kb_knowledge_base',
        'kb_category',
    ].join(',');
    try {
        const articleMap = new Map();
        for (const term of normalizedTerms) {
            try {
                const query = encodeURIComponent(`active=true^short_descriptionLIKE${term}^ORactive=true^textLIKE${term}`);
                const url = `${SNOW_BASE}/GetTableJSON/?tablename=kb_knowledge&sysparm_query=${query}&sysparm_fields=${fields}&sysparm_limit=15`;
                const decoded = snowDecode(await snowFetch(url));
                const rows = Array.isArray(decoded?.result) ? decoded.result : [];
                for (const row of rows.slice(0, 20)) {
                    const sysId = row?.sys_id?.value ?? row?.sys_id;
                    if (!sysId)
                        continue;
                    if (!articleMap.has(sysId))
                        articleMap.set(sysId, row);
                }
            }
            catch {
                // Skip malformed or oversized responses for this specific term.
            }
        }
        const result = Array.from(articleMap.values()).slice(0, 25);
        return res.json({ result });
    }
    catch (err) {
        return res.status(502).json({ error: err.message });
    }
});
