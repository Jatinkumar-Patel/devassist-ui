"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAnalysisRouter = void 0;
const express_1 = require("express");
const powershell_1 = require("../utils/powershell");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const XLSX = __importStar(require("xlsx"));
exports.logAnalysisRouter = (0, express_1.Router)();
const SNOW_BASE = 'https://servicenowviewer.allscripts.com/api/SNData';
// Key patterns from areas/sunrise-mobile/logs.md + analysis-playbook.md
const GREP_SEEDS = [
    'progress indicator has timed out',
    'LogTraceInfo',
    'LockWithTimeout',
    'Client service error',
    'timed out',
    'GetPatientVisit',
    'GetSelectedVisitDataAndObservations',
    'GetPatientList',
    'lock granted',
    'lock released',
    'Application_Start',
    'ERROR',
    'FATAL',
    'Exception',
    'overlay',
    'spinner',
    'RecycleClient',
    'WARNING',
    'warn',
    'Timeout',
    'SqlException',
    'UnauthorizedAccessException',
    'OutOfMemoryException',
    'StackOverflow',
    'NullReferenceException',
    'ArgumentException',
];
const SEED_CATEGORY = {
    'ERROR': 'error',
    'FATAL': 'error',
    'Exception': 'error',
    'SqlException': 'error',
    'UnauthorizedAccessException': 'error',
    'OutOfMemoryException': 'error',
    'StackOverflow': 'error',
    'NullReferenceException': 'error',
    'ArgumentException': 'error',
    'WARNING': 'warning',
    'warn': 'warning',
    'progress indicator has timed out': 'warning',
    'Client service error': 'warning',
    'timed out': 'warning',
    'Timeout': 'warning',
    'LogTraceInfo': 'warning',
    'LockWithTimeout': 'lock',
    'lock granted': 'lock',
    'lock released': 'lock',
    'GetPatientVisit': 'ops',
    'GetSelectedVisitDataAndObservations': 'ops',
    'GetPatientList': 'ops',
    'Application_Start': 'other',
    'overlay': 'other',
    'spinner': 'other',
    'RecycleClient': 'other',
};
const LOG_ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;
const LOG_ANALYSIS_PARSER_VERSION = '3';
const logAnalysisCache = new Map();
const MAX_PLAIN_BYTES = 50 * 1024 * 1024; // 50 MB — read whole file
const MAX_CHUNK_BYTES = 200 * 1024 * 1024; // 200 MB — read last N lines
const TAIL_LINES = 5000; // lines to tail on very large files
const MAX_SKIP_BYTES = 500 * 1024 * 1024; // 500 MB — truly skip
/** Read up to TAIL_LINES from the end of a large log file */
function readTail(filePath, maxLines) {
    const stat = fs_1.default.statSync(filePath);
    // For large files: read last ~2 MB as bytes and decode
    const chunkSize = Math.min(stat.size, 2 * 1024 * 1024);
    const buf = Buffer.alloc(chunkSize);
    const fd = fs_1.default.openSync(filePath, 'r');
    fs_1.default.readSync(fd, buf, 0, chunkSize, stat.size - chunkSize);
    fs_1.default.closeSync(fd);
    const text = buf.toString('utf-8');
    const lines = text.split('\n');
    // Drop the first line (likely partial) and take the last maxLines
    return lines.slice(Math.max(1, lines.length - maxLines)).join('\n');
}
const SCANNABLE_EXTENSIONS = ['.log', '.txt', '.zip', '.csv', '.json', '.xml', '.xlsx', '.xls'];
const MAX_XLSX_BYTES = 30 * 1024 * 1024;
function extensionOf(fileName) {
    const lower = fileName.toLowerCase();
    const idx = lower.lastIndexOf('.');
    return idx >= 0 ? lower.slice(idx) : '';
}
function attachmentFingerprint(attachments) {
    const parts = attachments
        .map((att) => [val(att.sys_id), val(att.file_name), val(att.content_type), val(att.size_bytes)].join(':'))
        .sort((a, b) => a.localeCompare(b));
    return `${LOG_ANALYSIS_PARSER_VERSION}|${parts.join('|')}`;
}
function val(f) {
    if (!f)
        return '';
    if (typeof f === 'string')
        return f;
    if (typeof f === 'object' && 'value' in f)
        return f.value ?? '';
    return String(f);
}
function parseHwsLog(content, fileName) {
    const hits = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const seed of GREP_SEEDS) {
            if (line.toLowerCase().includes(seed.toLowerCase())) {
                hits.push({
                    file: fileName,
                    line: i + 1,
                    text: line.trim().slice(0, 300),
                    seed,
                    category: SEED_CATEGORY[seed] ?? 'other',
                });
                break;
            }
        }
    }
    return hits;
}
function parseSpreadsheet(filePath, fileName) {
    const hits = [];
    const summaries = [];
    const wb = XLSX.readFile(filePath, { dense: true, cellDates: false });
    const norm = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const parseBoolish = (value) => {
        const v = value.trim().toLowerCase();
        if (!v)
            return undefined;
        if (v === '1' || v === 'true' || v === 'active' || v === 'yes' || v === 'y')
            return true;
        if (v === '0' || v === 'false' || v === 'inactive' || v === 'no' || v === 'n')
            return false;
        return undefined;
    };
    for (const sheetName of wb.SheetNames.slice(0, 10)) {
        const ws = wb.Sheets[sheetName];
        if (!ws)
            continue;
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        const visibleRows = rows
            .map((row) => Array.isArray(row) ? row.map((v) => String(v ?? '').trim()) : [String(row ?? '').trim()])
            .filter((cells) => cells.some((c) => c.length > 0));
        if (visibleRows.length > 0) {
            const headers = visibleRows[0]
                .map((x) => String(x ?? '').trim())
                .filter(Boolean)
                .slice(0, 20);
            const columnCount = Math.max(...visibleRows.map((r) => r.length));
            const sampleRows = visibleRows
                .slice(1, 6)
                .map((r) => r.slice(0, 20).join(' | ').slice(0, 300));
            const headerRow = visibleRows[0].map((x) => String(x ?? '').trim());
            const headerMap = new Map();
            headerRow.forEach((h, idx) => {
                if (h)
                    headerMap.set(norm(h), idx);
            });
            const indexOfAny = (aliases) => {
                for (const alias of aliases) {
                    const idx = headerMap.get(norm(alias));
                    if (typeof idx === 'number')
                        return idx;
                }
                return -1;
            };
            const idxDisplayName = indexOfAny(['DisplayName']);
            const idxFirstName = indexOfAny(['FirstName']);
            const idxLastName = indexOfAny(['LastName']);
            const idxPersonGuid = indexOfAny(['PersonGUID', 'PersonGuid']);
            const idxGuid = indexOfAny(['GUID', 'Guid']);
            const idxNameType = indexOfAny(['NameTypeCode']);
            const idxActive = indexOfAny(['Active']);
            const idxStatus = indexOfAny(['Status']);
            const rows = visibleRows.slice(1).filter((row) => {
                if (!row.length)
                    return false;
                const joined = row.slice(0, Math.min(row.length, 10)).map((x) => String(x ?? '').trim().toLowerCase()).join('|');
                // Skip repeated header lines embedded in exports.
                return !(joined.includes('siteid') && joined.includes('repflags') && (joined.includes('firstname') || joined.includes('displayname')));
            });
            const conversionInsight = analyzeConversionRows(fileName, sheetName, headerRow, rows);
            const displayNameCounts = new Map();
            const personGuidSet = new Set();
            const guidSet = new Set();
            const nameTypeCounts = new Map();
            const personGuidToNameTypes = new Map();
            let activeTrue = 0;
            let activeFalse = 0;
            let statusActive = 0;
            let statusInactive = 0;
            for (const row of rows) {
                const val = (idx) => (idx >= 0 ? String(row[idx] ?? '').trim() : '');
                const first = val(idxFirstName);
                const last = val(idxLastName);
                const displayName = val(idxDisplayName) || [last, first].filter(Boolean).join(', ');
                const personGuid = val(idxPersonGuid);
                const guid = val(idxGuid);
                const nameType = val(idxNameType);
                const activeVal = val(idxActive);
                const status = val(idxStatus);
                if (displayName)
                    displayNameCounts.set(displayName, (displayNameCounts.get(displayName) ?? 0) + 1);
                if (personGuid)
                    personGuidSet.add(personGuid);
                if (guid)
                    guidSet.add(guid);
                if (nameType)
                    nameTypeCounts.set(nameType, (nameTypeCounts.get(nameType) ?? 0) + 1);
                if (personGuid && nameType) {
                    const set = personGuidToNameTypes.get(personGuid) ?? new Set();
                    set.add(nameType);
                    personGuidToNameTypes.set(personGuid, set);
                }
                const active = parseBoolish(activeVal);
                if (active === true)
                    activeTrue += 1;
                if (active === false)
                    activeFalse += 1;
                if (status) {
                    const s = status.trim().toLowerCase();
                    if (s === 'active')
                        statusActive += 1;
                    if (s === 'inactive')
                        statusInactive += 1;
                }
            }
            const duplicateDisplayNames = Array.from(displayNameCounts.entries())
                .filter(([, count]) => count > 1)
                .sort((a, b) => b[1] - a[1]);
            const multiTypePersons = Array.from(personGuidToNameTypes.entries())
                .filter(([, types]) => types.size > 1)
                .slice(0, 3)
                .map(([pg, types]) => `${pg}: ${Array.from(types).join('/')}`);
            const findings = [];
            findings.push(`Rows analyzed: ${rows.length}; unique GUIDs: ${guidSet.size}; unique PersonGUIDs: ${personGuidSet.size}`);
            if (duplicateDisplayNames.length) {
                findings.push(`Duplicate display names: ${duplicateDisplayNames.slice(0, 3).map(([name, count]) => `${name} (${count})`).join(', ')}`);
            }
            if (nameTypeCounts.size) {
                findings.push(`NameTypeCode distribution: ${Array.from(nameTypeCounts.entries()).map(([type, count]) => `${type}:${count}`).join(', ')}`);
            }
            if (activeTrue || activeFalse) {
                findings.push(`Active flag counts: true=${activeTrue}, false=${activeFalse}`);
            }
            if (statusActive || statusInactive) {
                findings.push(`Status counts: Active=${statusActive}, Inactive=${statusInactive}`);
            }
            if (multiTypePersons.length) {
                findings.push(`PersonGUIDs with multiple NameTypeCode values: ${multiTypePersons.join(' | ')}`);
            }
            findings.push(...conversionInsight.findings);
            summaries.push({
                file: fileName,
                sheet: sheetName,
                rowCount: visibleRows.length,
                columnCount,
                headers,
                sampleRows,
                findings,
            });
            hits.push(...conversionInsight.syntheticHits);
        }
        const maxRows = Math.min(rows.length, 20000);
        for (let i = 0; i < maxRows; i++) {
            const row = rows[i];
            const rowText = Array.isArray(row)
                ? row.map((v) => String(v ?? '')).join(' | ')
                : String(row ?? '');
            if (!rowText.trim())
                continue;
            for (const seed of GREP_SEEDS) {
                if (rowText.toLowerCase().includes(seed.toLowerCase())) {
                    hits.push({
                        file: `${fileName}#${sheetName}`,
                        line: i + 1,
                        text: rowText.trim().slice(0, 300),
                        seed,
                        category: SEED_CATEGORY[seed] ?? 'other',
                    });
                    break;
                }
            }
        }
    }
    return { hits, summaries };
}
function analyzeConversionRows(fileName, sheetName, headers, rows) {
    const out = { findings: [], syntheticHits: [] };
    if (!headers.length || !rows.length)
        return out;
    const norm = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const headerMap = new Map();
    headers.forEach((h, idx) => {
        const key = norm(String(h ?? ''));
        if (key)
            headerMap.set(key, idx);
    });
    const findIndex = (aliases) => {
        for (const alias of aliases) {
            const idx = headerMap.get(norm(alias));
            if (typeof idx === 'number')
                return idx;
        }
        return -1;
    };
    const idxOld = findIndex(['OldValue', 'Old', 'SourceValue', 'Source', 'Before', 'From']);
    const idxNew = findIndex(['NewValue', 'New', 'TargetValue', 'Target', 'After', 'To']);
    const idxStatus = findIndex(['Status', 'Result', 'Outcome', 'State']);
    const idxReason = findIndex(['Reason', 'Message', 'Comments', 'Note']);
    let changed = 0;
    let unchanged = 0;
    let blankTargets = 0;
    const statusCounts = new Map();
    const conversionExamples = [];
    const issueExamples = [];
    const maxRows = Math.min(rows.length, 20000);
    for (let i = 0; i < maxRows; i++) {
        const row = rows[i];
        const valueAt = (idx) => (idx >= 0 ? String(row[idx] ?? '').trim() : '');
        const oldVal = valueAt(idxOld);
        const newVal = valueAt(idxNew);
        const status = valueAt(idxStatus);
        const reason = valueAt(idxReason);
        if (oldVal || newVal) {
            if (oldVal && newVal) {
                if (oldVal !== newVal) {
                    changed += 1;
                    if (conversionExamples.length < 3)
                        conversionExamples.push(`${oldVal} -> ${newVal}`);
                }
                else {
                    unchanged += 1;
                }
            }
            else if (oldVal && !newVal) {
                blankTargets += 1;
                if (issueExamples.length < 3)
                    issueExamples.push(`missing target for ${oldVal}`);
            }
        }
        if (status) {
            const key = status.toLowerCase();
            statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
            if (/fail|error|reject|invalid|missing|not found|unmapped/i.test(status) || /fail|error|reject|invalid|missing|not found|unmapped/i.test(reason)) {
                out.syntheticHits.push({
                    file: `${fileName}#${sheetName}`,
                    line: i + 2,
                    text: `${status}${reason ? ` | ${reason}` : ''}`.slice(0, 300),
                    seed: 'SpreadsheetDataSignal',
                    category: 'other',
                });
            }
        }
    }
    if (changed > 0 || blankTargets > 0 || statusCounts.size > 0) {
        out.findings.push(`Conversion summary: changed=${changed}, unchanged=${unchanged}, missing_target=${blankTargets}`);
    }
    if (conversionExamples.length > 0) {
        out.findings.push(`Conversion examples: ${conversionExamples.join(' | ')}`);
    }
    if (issueExamples.length > 0) {
        out.findings.push(`Potential mapping gaps: ${issueExamples.join(' | ')}`);
    }
    if (statusCounts.size > 0) {
        const topStatuses = Array.from(statusCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([status, count]) => `${status}:${count}`)
            .join(', ');
        out.findings.push(`Status distribution: ${topStatuses}`);
    }
    out.syntheticHits = out.syntheticHits.slice(0, 40);
    return out;
}
// GET /api/log-analysis/:recordSysId — download + parse all log attachments for a SNOW record
exports.logAnalysisRouter.get('/:recordSysId', async (req, res) => {
    const { recordSysId } = req.params;
    const tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'devassist-'));
    try {
        // 1. Get attachment list
        const attachListRaw = await (0, powershell_1.execPowerShell)(`(Invoke-WebRequest -Uri '${SNOW_BASE}/GetAttachments/?sysid=${recordSysId}' -UseDefaultCredentials -UseBasicParsing).Content`);
        const outer = JSON.parse(attachListRaw.trim());
        const parsed = typeof outer === 'string' ? JSON.parse(outer) : outer;
        const attachments = Array.isArray(parsed?.result) ? parsed.result : [];
        const fingerprint = attachmentFingerprint(attachments);
        const cached = logAnalysisCache.get(recordSysId);
        if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
            return res.json({ ...cached.result, cached: true });
        }
        const scannableFiles = [];
        const allHits = [];
        const spreadsheetSummaries = [];
        const analyzed = [];
        const skipped = [];
        for (const att of attachments) {
            const fileName = val(att.file_name) || '(unnamed attachment)';
            const ext = extensionOf(fileName);
            if (SCANNABLE_EXTENSIONS.includes(ext)) {
                scannableFiles.push(att);
            }
            else {
                const ctype = val(att.content_type) || 'unknown type';
                skipped.push(`${fileName} (evidence-only attachment; manual review required: ${ctype})`);
            }
        }
        for (const att of scannableFiles) {
            const fileName = val(att.file_name);
            const sysId = val(att.sys_id);
            const contentType = val(att.content_type);
            const sizeBytesStr = val(att.size_bytes);
            const sizeBytes = parseInt(sizeBytesStr, 10) || 0;
            // Skip very large files (> 500 MB) entirely
            if (sizeBytes > MAX_SKIP_BYTES) {
                skipped.push(`${fileName} (too large to process: ${Math.round(sizeBytes / 1024 / 1024)}MB)`);
                continue;
            }
            const outPath = path_1.default.join(tmpDir, fileName.replace(/[^\w.\-]/g, '_'));
            try {
                // Suppress PS progress output (fixes transport errors on large downloads)
                await (0, powershell_1.execPowerShell)(`$ProgressPreference = 'SilentlyContinue'; ` +
                    `Invoke-WebRequest -Uri '${SNOW_BASE}/GetAttachment/?sysid=${sysId}' ` +
                    `-UseDefaultCredentials -UseBasicParsing -TimeoutSec 300 -OutFile '${outPath}'`);
                if (contentType.includes('zip') || fileName.endsWith('.zip')) {
                    // Extract zip and parse each .log file inside
                    const extractDir = outPath + '_extracted';
                    fs_1.default.mkdirSync(extractDir, { recursive: true });
                    await (0, powershell_1.execPowerShell)(`Expand-Archive -Path '${outPath}' -DestinationPath '${extractDir}' -Force`);
                    const extracted = fs_1.default.readdirSync(extractDir);
                    for (const inner of extracted) {
                        if (inner.toLowerCase().endsWith('.log') ||
                            inner.toLowerCase().endsWith('.txt') ||
                            inner.toLowerCase().endsWith('.csv') ||
                            inner.toLowerCase().endsWith('.json') ||
                            inner.toLowerCase().endsWith('.xml') ||
                            inner.toLowerCase().endsWith('.xlsx') ||
                            inner.toLowerCase().endsWith('.xls')) {
                            const innerPath = path_1.default.join(extractDir, inner);
                            const innerStat = fs_1.default.statSync(innerPath);
                            let note = '';
                            if (innerStat.size > MAX_SKIP_BYTES) {
                                skipped.push(`${fileName}/${inner} (too large: ${Math.round(innerStat.size / 1024 / 1024)}MB)`);
                                continue;
                            }
                            let hits = [];
                            const innerExt = extensionOf(inner);
                            if (innerExt === '.xlsx' || innerExt === '.xls') {
                                if (innerStat.size > MAX_XLSX_BYTES) {
                                    skipped.push(`${fileName}/${inner} (spreadsheet too large: ${Math.round(innerStat.size / 1024 / 1024)}MB)`);
                                    continue;
                                }
                                const parsed = parseSpreadsheet(innerPath, `${fileName}/${inner}`);
                                hits = parsed.hits;
                                spreadsheetSummaries.push(...parsed.summaries);
                                analyzed.push(`${fileName}/${inner} (spreadsheet parsed: ${parsed.summaries.length} sheet(s), ${hits.length} log-pattern hit(s))`);
                            }
                            else {
                                let content;
                                if (innerStat.size > MAX_PLAIN_BYTES) {
                                    content = readTail(innerPath, TAIL_LINES);
                                    note = ` [last ${TAIL_LINES} lines of ${Math.round(innerStat.size / 1024 / 1024)}MB]`;
                                }
                                else {
                                    content = fs_1.default.readFileSync(innerPath, 'utf-8');
                                }
                                hits = parseHwsLog(content, `${fileName}/${inner}`);
                                analyzed.push(`${fileName}/${inner}${note} (${hits.length} hit(s))`);
                            }
                            allHits.push(...hits);
                        }
                    }
                }
                else {
                    let note = '';
                    const rawStat = fs_1.default.statSync(outPath);
                    const ext = extensionOf(fileName);
                    let hits = [];
                    if (ext === '.xlsx' || ext === '.xls') {
                        if (rawStat.size > MAX_XLSX_BYTES) {
                            skipped.push(`${fileName} (spreadsheet too large: ${Math.round(rawStat.size / 1024 / 1024)}MB)`);
                            continue;
                        }
                        const parsed = parseSpreadsheet(outPath, fileName);
                        hits = parsed.hits;
                        spreadsheetSummaries.push(...parsed.summaries);
                        analyzed.push(`${fileName} (spreadsheet parsed: ${parsed.summaries.length} sheet(s), ${hits.length} log-pattern hit(s))`);
                    }
                    else {
                        let content;
                        if (rawStat.size > MAX_PLAIN_BYTES) {
                            content = readTail(outPath, TAIL_LINES);
                            note = ` [last ${TAIL_LINES} lines of ${Math.round(rawStat.size / 1024 / 1024)}MB]`;
                        }
                        else {
                            content = fs_1.default.readFileSync(outPath, 'utf-8');
                        }
                        hits = parseHwsLog(content, fileName);
                        analyzed.push(`${fileName}${note} (${hits.length} hit(s))`);
                    }
                    allHits.push(...hits);
                }
            }
            catch (e) {
                skipped.push(`${fileName} (${e.message.slice(0, 80)})`);
            }
        }
        // Build op-duration summary from lock granted/released pairs (per analysis-playbook.md tooling)
        const lockPairs = extractLockPairs(allHits);
        const byCategory = groupByCategory(allHits);
        const suggestions = buildSuggestions(allHits);
        const result = {
            totalAttachments: attachments.length,
            scannableAttachments: scannableFiles.length,
            analyzed,
            skipped,
            totalHits: allHits.length,
            hits: allHits.slice(0, 100), // cap display at 100
            byCategory,
            lockPairs: lockPairs.slice(0, 20),
            topSeeds: summariseBySeeds(allHits),
            spreadsheetSummaries: spreadsheetSummaries.slice(0, 60),
            suggestions,
            cached: false,
        };
        logAnalysisCache.set(recordSysId, {
            fingerprint,
            expiresAt: Date.now() + LOG_ANALYSIS_CACHE_TTL_MS,
            result,
        });
        return res.json(result);
    }
    finally {
        // Clean up temp files
        try {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { /* ignore */ }
    }
});
function extractLockPairs(hits) {
    return hits.filter((h) => h.seed === 'lock granted' || h.seed === 'lock released' ||
        h.seed === 'LockWithTimeout' || h.seed === 'progress indicator has timed out');
}
function groupByCategory(hits) {
    const groups = { error: [], warning: [], lock: [], ops: [], other: [] };
    for (const h of hits) {
        groups[h.category].push(h);
    }
    // Cap each group to 30 lines for display
    for (const k of Object.keys(groups)) {
        groups[k] = groups[k].slice(0, 30);
    }
    return groups;
}
function summariseBySeeds(hits) {
    const counts = {};
    for (const h of hits) {
        counts[h.seed] = (counts[h.seed] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort(([, a], [, b]) => b - a));
}
function buildSuggestions(hits) {
    const suggestions = [];
    const counts = summariseBySeeds(hits);
    // progress indicator timed out → client-side overlay bug (Pattern #3)
    if (counts['progress indicator has timed out']) {
        suggestions.push({
            title: 'Client-side overlay/spinner left stuck',
            severity: 'critical',
            observation: `"progress indicator has timed out" found ${counts['progress indicator has timed out']}× — client gave up waiting while server was still processing.`,
            codeDirection: 'The overlay/spinner dismissal is tied to a server response that the client never received. Look for the spinner/overlay lifecycle: where it is set visible and where it is cleared. The clear path must handle the timeout case.',
            repo: 'allscriptshealthcare/SunriseMobile',
            searchTerms: ['overlay', 'spinner', 'progressIndicator', 'HideProgressIndicator', 'ShowProgressIndicator'],
        });
    }
    // High lock contention
    if ((counts['LockWithTimeout'] ?? 0) > 100) {
        suggestions.push({
            title: `SCMLib lock contention (${counts['LockWithTimeout']}× LockWithTimeout)`,
            severity: 'high',
            observation: `${counts['LockWithTimeout']} LockWithTimeout events — workers are queuing heavily. This is the IIS web-garden bottleneck described in the analysis playbook.`,
            codeDirection: 'Increase IIS app pool Maximum Worker Processes (e.g. 4 → 6). The SCMLibServiceManager lock is a known contention point; more workers reduce queue depth. Validated fix on similar DAs (DA 9358329 → Defect 9377813).',
            repo: 'allscriptshealthcare/sunrise-mobilewebservices',
            searchTerms: ['LockWithTimeout', 'SCMLibServiceManager', 'maxWorkerProcesses'],
        });
    }
    // LogTraceInfo client timeouts
    if ((counts['LogTraceInfo'] ?? 0) > 100) {
        suggestions.push({
            title: `High client timeout rate (${counts['LogTraceInfo']}× LogTraceInfo)`,
            severity: 'high',
            observation: `${counts['LogTraceInfo']} LogTraceInfo entries — these are anonymous client-side traces showing the mobile app logged errors/timeouts. Cannot tie to specific user (anonymization per Spike 9375402).`,
            codeDirection: 'Correlate LogTraceInfo timestamps with server-side op durations. If server ops complete in < client timeout threshold, the bug is in the client timeout/retry logic. Check HWS RecycleClient and connection backoff settings.',
            repo: 'allscriptshealthcare/sunrise-mobilewebservices',
            searchTerms: ['LogTraceInfo', 'RecycleClient', 'ClientTimeout'],
        });
    }
    // Raw errors in log
    if ((counts['ERROR'] ?? 0) > 0 || (counts['FATAL'] ?? 0) > 0) {
        const total = (counts['ERROR'] ?? 0) + (counts['FATAL'] ?? 0);
        suggestions.push({
            title: `${total} ERROR/FATAL entries in logs`,
            severity: total > 50 ? 'critical' : 'high',
            observation: `${counts['ERROR'] ?? 0} ERROR + ${counts['FATAL'] ?? 0} FATAL lines. Review the key log lines section for exact error messages — these are the primary diagnostic signals.`,
            codeDirection: 'Find the first ERROR/FATAL in the incident window and trace back the call stack. Match against known exception types (SqlException → DB, UnauthorizedException → auth, NullReferenceException → data model).',
            repo: 'allscriptshealthcare/sunrise-mobilewebservices',
            searchTerms: ['ERROR', 'FATAL', 'Exception', 'catch'],
        });
    }
    // App pool recycle
    if (counts['Application_Start']) {
        suggestions.push({
            title: 'App pool recycle during incident window',
            severity: 'medium',
            observation: `Application_Start found — app pool recycled during the log window. A cold-start stall right after recycle can cause slow responses (Pattern #5).`,
            codeDirection: 'Enable IIS warmup: set startMode=AlwaysRunning + preloadEnabled=true + applicationInitialization warmup URL. This prevents cold-start stalls from affecting active med-pass users.',
            repo: 'allscriptshealthcare/sunrise-mobilewebservices',
            searchTerms: ['Application_Start', 'preloadEnabled', 'startMode', 'LoadAzureAppConfigKeyVaultSecrets'],
        });
    }
    return suggestions;
}
