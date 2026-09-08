import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogComparisonSummary } from './log-comparison';

test('log comparison summary scores DevAssist above a seed-only baseline when richer evidence exists', () => {
  const summary = buildLogComparisonSummary({
    topSeeds: {
      ERROR: 4,
      Timeout: 2,
      LockWithTimeout: 8,
    },
    byCategory: {
      error: [{}, {}],
      warning: [{}],
      lock: [{}],
      ops: [],
      other: [],
    },
    suggestions: [{}, {}],
    explanation: [
      'Primary diagnostic finding: Lock contention and long-running operations are the dominant signal (confidence: high).',
      'LockWithTimeout=8 with delayed rows.',
    ],
    diagnosticSummary: {
      confidence: 'high',
      evidenceCoverage: {
        errors: 2,
        warnings: 1,
        locks: 1,
        operations: 0,
        stackTraces: 1,
        timelineDelayRows: 3,
        spreadsheetSignals: 0,
        imageSignals: 0,
      },
    },
  });

  assert.ok(summary.devassistScore > summary.baselineScore);
  assert.ok(summary.delta > 0);
  assert.equal(summary.baselineMetrics.seeds, 3);
  assert.equal(summary.devassistMetrics.evidenceDomains, 5);
  assert.equal(summary.coverageCard[0]?.domain, 'errors');
  assert.equal(summary.coverageCard[0]?.rank, 1);
  assert.equal(summary.coverageCard[0]?.verdict, 'pass');
  assert.ok((summary.coverageCard[0]?.gap ?? 0) > 0);
  assert.ok(summary.coverageCard.some((entry) => entry.verdict === 'fail'));
  assert.ok(summary.coverageCard.some((entry) => entry.domain === 'stackTraces'));
  assert.ok(summary.whyBetter.some((line) => /evidence domains/i.test(line)));
  assert.ok(summary.whyBetter.some((line) => /confidence/i.test(line)));
  assert.ok(summary.whyBetter.some((line) => /top improved evidence domain/i.test(line)));
});

test('log comparison summary stays low when only coarse seed signals exist', () => {
  const summary = buildLogComparisonSummary({
    topSeeds: {
      ERROR: 1,
    },
    byCategory: {
      error: [{}],
      warning: [],
      lock: [],
      ops: [],
      other: [],
    },
    suggestions: [],
    explanation: [],
    diagnosticSummary: undefined,
  });

  assert.equal(summary.baselineMetrics.seeds, 1);
  assert.equal(summary.devassistScore, 2);
  assert.ok(summary.delta < 0);
  assert.ok(summary.baselineScore > summary.devassistScore);
  assert.equal(summary.coverageCard.length, 8);
  assert.ok(summary.coverageCard.every((entry) => entry.verdict === 'fail'));
});