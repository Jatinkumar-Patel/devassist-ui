import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const targets = [
  path.join(root, 'packages/spa/src/components/AnalysisPanel.tsx'),
  path.join(root, 'packages/spa/src/components/LogAnalysisPanel.tsx'),
];

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assertNoMatch(content, regex, message, failures) {
  if (regex.test(content)) failures.push(message);
}

function assertMatch(content, regex, message, failures) {
  if (!regex.test(content)) failures.push(message);
}

function verifyEntityUsage(content, filePath, failures) {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes('&lt;') && !line.includes('&gt;')) continue;

    const allowed =
      /replace\(\/&lt;\/gi,\s*'<'\)/.test(line) ||
      /replace\(\/&gt;\/gi,\s*'>'\)/.test(line) ||
      /replace\(\/<\/g,\s*'&lt;'\)/.test(line) ||
      /replace\(\/>\/g,\s*'&gt;'\)/.test(line);

    if (!allowed) {
      failures.push(`${filePath}: unexpected escaped entity literal in render text -> ${line.trim()}`);
    }
  }
}

function verifyAnalysisPanel(content, failures) {
  assertNoMatch(content, /session\.kbEvidence!\.slice\(0,\s*\d+\)/, 'AnalysisPanel: KB section still truncates list.', failures);
  assertNoMatch(content, /session\.versionEvidence!\.slice\(0,\s*\d+\)/, 'AnalysisPanel: version evidence section still truncates list.', failures);
  assertNoMatch(content, /session\.areaEvidence!\.slice\(0,\s*\d+\)/, 'AnalysisPanel: area evidence section still truncates list.', failures);
  assertNoMatch(content, /session\.relatedItems!\.slice\(0,\s*\d+\)/, 'AnalysisPanel: related bugs section still truncates list.', failures);
  assertNoMatch(content, /session\.testCases!\.slice\(0,\s*\d+\)/, 'AnalysisPanel: test case section still truncates list.', failures);
  assertNoMatch(content, /session\.recentCommits!\.slice\(0,\s*\d+\)/, 'AnalysisPanel: recent commits section still truncates list.', failures);
  assertNoMatch(content, /analyzedArtifacts\.slice\(0,\s*\d+\)/, 'AnalysisPanel: artifact analyzed list still truncates.', failures);
  assertNoMatch(content, /notAnalyzedArtifacts\.slice\(0,\s*\d+\)/, 'AnalysisPanel: artifact not-analyzed list still truncates.', failures);
  assertNoMatch(content, /className="[^"]*\btruncate\b[^"]*"/, 'AnalysisPanel: truncate class still used in visible section content.', failures);

  assertMatch(content, /function\s+decodeHtmlEntities\(/, 'AnalysisPanel: missing HTML entity decoder.', failures);
  assertMatch(content, /function\s+normalizeDisplayText\(/, 'AnalysisPanel: missing display text normalizer.', failures);
}

function verifyLogPanel(content, failures) {
  assertNoMatch(content, /\.slice\(0,\s*30\)/, 'LogAnalysisPanel: category hit aggregation still truncates.', failures);
  assertNoMatch(content, /result\.spreadsheetSummaries\.slice\(0,\s*\d+\)/, 'LogAnalysisPanel: spreadsheet summaries section still truncates.', failures);
  assertNoMatch(content, /result\.imageSummaries\.slice\(0,\s*\d+\)/, 'LogAnalysisPanel: image summaries section still truncates.', failures);
  assertNoMatch(content, /summary\.topDelayed\.slice\(0,\s*\d+\)/, 'LogAnalysisPanel: timeline delayed rows still truncate.', failures);
  assertNoMatch(content, /stackTraces:\s*items\.flatMap\([^)]*\)\.slice\(0,\s*\d+\)/, 'LogAnalysisPanel: stack trace merge still truncates.', failures);
  assertNoMatch(content, /operationTimelineSummaries:\s*items\.flatMap\([^)]*\)\.slice\(0,\s*\d+\)/, 'LogAnalysisPanel: timeline merge still truncates.', failures);
  assertNoMatch(content, /className="[^"]*\btruncate\b[^"]*"/, 'LogAnalysisPanel: truncate class still used in visible section content.', failures);
}

const failures = [];

for (const target of targets) {
  if (!fs.existsSync(target)) {
    failures.push(`Missing target file: ${target}`);
    continue;
  }

  const content = read(target);
  verifyEntityUsage(content, target, failures);

  const fileName = path.basename(target);
  if (fileName === 'AnalysisPanel.tsx') verifyAnalysisPanel(content, failures);
  if (fileName === 'LogAnalysisPanel.tsx') verifyLogPanel(content, failures);
}

if (failures.length > 0) {
  console.error('Section verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Section verification passed: no section-level truncation and no escaped entity leakage in render text.');
