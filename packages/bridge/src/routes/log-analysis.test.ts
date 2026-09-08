import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosticSummary, buildSuggestions, type LogHit } from './log-analysis';

function makeHit(category: LogHit['category'], seed: string, line: number): LogHit {
  return {
    file: 'sample.log',
    line,
    text: `${seed} at line ${line}`,
    seed,
    category,
  };
}

test('diagnostic summary prefers server exception finding when errors and stack traces exist', () => {
  const summary = buildDiagnosticSummary({
    byCategory: {
      error: [
        makeHit('error', 'ERROR', 12),
        makeHit('error', 'FATAL', 18),
      ],
      warning: [],
      lock: [],
      ops: [],
      other: [],
    },
    topSeeds: {
      ERROR: 2,
      FATAL: 1,
    },
    stackTraces: [
      {
        file: 'sample.log',
        exception: 'NullReferenceException',
        signature: 'NullReferenceException|at Foo.Bar()',
        firstLine: 12,
        preview: 'NullReferenceException at Foo.Bar()',
      },
      {
        file: 'sample.log',
        exception: 'SqlException',
        signature: 'SqlException|at Data.Run()',
        firstLine: 18,
        preview: 'SqlException at Data.Run()',
      },
    ],
    operationTimelineSummaries: [],
    spreadsheetSummaries: [],
    imageSummaries: [],
  });

  assert.match(summary.primaryFinding, /Server-side exception path/i);
  assert.equal(summary.confidence, 'high');
  assert.equal(summary.evidenceCoverage.errors, 2);
  assert.equal(summary.evidenceCoverage.stackTraces, 2);
});

test('diagnostic summary prefers lock contention finding for heavy lock and delay signals', () => {
  const summary = buildDiagnosticSummary({
    byCategory: {
      error: [],
      warning: [makeHit('warning', 'Timeout', 4)],
      lock: Array.from({ length: 28 }, (_, i) => makeHit('lock', 'LockWithTimeout', i + 1)),
      ops: [],
      other: [],
    },
    topSeeds: {
      LockWithTimeout: 64,
      Timeout: 10,
    },
    stackTraces: [],
    operationTimelineSummaries: [
      {
        file: 'timeline.tsv',
        rowsParsed: 200,
        delayedCount: 22,
        errorRows: 1,
        thresholdSeconds: 2,
        topDelayed: [],
      },
    ],
    spreadsheetSummaries: [],
    imageSummaries: [],
  });

  assert.match(summary.primaryFinding, /Lock contention/i);
  assert.equal(summary.confidence, 'high');
  assert.equal(summary.evidenceCoverage.locks, 28);
  assert.equal(summary.evidenceCoverage.timelineDelayRows, 22);
});

test('diagnostic summary prefers data-quality finding when spreadsheet signals dominate', () => {
  const summary = buildDiagnosticSummary({
    byCategory: {
      error: [],
      warning: [],
      lock: [],
      ops: [makeHit('ops', 'GetPatientList', 33)],
      other: [],
    },
    topSeeds: {
      GetPatientList: 5,
    },
    stackTraces: [],
    operationTimelineSummaries: [],
    spreadsheetSummaries: [
      {
        file: 'extract.xlsx',
        sheet: 'Sheet1',
        rowCount: 100,
        columnCount: 12,
        headers: [],
        sampleRows: [],
        findings: [
          'Conversion summary: changed=20, unchanged=5, missing_target=3',
          'Potential mapping gaps: missing target for X, missing target for Y',
          'Status distribution: failed:6, success:30',
        ],
      },
    ],
    imageSummaries: [],
  });

  assert.match(summary.primaryFinding, /Data-quality|mapping drift/i);
  assert.equal(summary.confidence, 'medium');
  assert.equal(summary.evidenceCoverage.spreadsheetSignals, 3);
});

test('diagnostic summary prefers deadlock, auth, and network failure modes when those signals dominate', () => {
  const deadlockSummary = buildDiagnosticSummary({
    byCategory: {
      error: [makeHit('error', 'Deadlock', 2)],
      warning: [],
      lock: Array.from({ length: 12 }, (_, i) => makeHit('lock', 'LockWithTimeout', i + 1)),
      ops: [],
      other: [],
    },
    topSeeds: {
      Deadlock: 4,
      'deadlock victim': 1,
    },
    stackTraces: [],
    operationTimelineSummaries: [],
    spreadsheetSummaries: [],
    imageSummaries: [],
  });

  assert.match(deadlockSummary.primaryFinding, /deadlock/i);
  assert.equal(deadlockSummary.confidence, 'high');

  const authSummary = buildDiagnosticSummary({
    byCategory: {
      error: [makeHit('error', 'Authentication failed', 9)],
      warning: [],
      lock: [],
      ops: [],
      other: [],
    },
    topSeeds: {
      'Authentication failed': 2,
      UnauthorizedAccessException: 1,
    },
    stackTraces: [],
    operationTimelineSummaries: [],
    spreadsheetSummaries: [],
    imageSummaries: [],
  });

  assert.match(authSummary.primaryFinding, /authentication|authorization/i);
  assert.equal(authSummary.confidence, 'high');

  const networkSummary = buildDiagnosticSummary({
    byCategory: {
      error: [makeHit('error', 'HttpRequestException', 14)],
      warning: [],
      lock: [],
      ops: [],
      other: [],
    },
    topSeeds: {
      HttpRequestException: 2,
      WebException: 1,
      'connection refused': 1,
    },
    stackTraces: [],
    operationTimelineSummaries: [],
    spreadsheetSummaries: [],
    imageSummaries: [],
  });

  assert.match(networkSummary.primaryFinding, /network|downstream/i);
  assert.equal(networkSummary.confidence, 'high');
});

test('suggestion builder emits deadlock, auth, network, and null-reference guidance', () => {
  const suggestions = buildSuggestions([
    makeHit('error', 'Deadlock', 3),
    makeHit('error', 'Authentication failed', 8),
    makeHit('error', 'HttpRequestException', 11),
    makeHit('error', 'NullReferenceException', 15),
    makeHit('warning', 'LogTraceInfo', 16),
  ]);

  assert.ok(suggestions.some((s) => /deadlock/i.test(s.title)));
  assert.ok(suggestions.some((s) => /authentication|authorization/i.test(s.title)));
  assert.ok(suggestions.some((s) => /connectivity|downstream/i.test(s.title)));
  assert.ok(suggestions.some((s) => /null guard/i.test(s.title)));
});
