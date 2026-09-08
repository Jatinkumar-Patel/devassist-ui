import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTriageCacheKey } from './Triage.tsx';

test('same work item is normalized across pasted variants', () => {
  const fromWithPrefix = buildTriageCacheKey('DA 9358329', [], []);
  const fromNumericOnly = buildTriageCacheKey('9358329', [], []);
  const fromCompactPrefix = buildTriageCacheKey('DA9358329', [], []);

  assert.equal(fromWithPrefix, fromNumericOnly);
  assert.equal(fromWithPrefix, fromCompactPrefix);
});
