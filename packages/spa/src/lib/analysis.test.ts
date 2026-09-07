import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssessment, summarizeSpreadsheetFindings } from './analysis.ts';
import { filterVersionEvidenceItems } from './ado-client.ts';
import { filterKbEvidenceRows } from './snow-client.ts';

test('buildAssessment does not emit generic support email wording', () => {
  const adoItem = {
    id: 12345,
    fields: {
      'System.Title': 'Users cannot submit the form after timeout',
      'System.Description': 'The progress indicator times out after 60 seconds during submission.',
      'System.AreaPath': 'Sunrise > SHM',
      'Allscripts.Field.CustomerName': 'Acme Health',
      'Allscripts.Field.SupportVersion': '25.3.0',
    },
  } as any;

  const assessment = buildAssessment(adoItem, null, [], 'Timeout on submit workflow', [{ seed: 'progress indicator has timed out', text: 'progress indicator has timed out after 60s', file: 'hws.log' }], {
    'progress indicator has timed out': 4,
  });

  assert.ok(assessment.l2Draft);
  assert.doesNotMatch(assessment.l2Draft, /Thank you for contacting Altera support/i);
  assert.match(assessment.l2Draft, /root cause|Findings|Evidence|Observed gap|issue/i);
});

test('same-version historical evidence and KB rows are filtered by actual issue semantics', () => {
  const items = [
    {
      id: 9387316,
      title: 'Users cannot submit form after progress indicator times out',
      state: 'Active',
      type: 'Defect',
      url: 'https://example.test/9387316',
      supportVersion: '25.3.0',
    },
    {
      id: 9367373,
      title: 'Order requisition update linked server for account number value',
      state: 'In Product',
      type: 'Defect',
      url: 'https://example.test/9367373',
      supportVersion: '25.3.0',
    },
  ] as any;

  const filteredItems = filterVersionEvidenceItems(items, ['25.3.0'], ['submit', 'timeout', 'progress', 'indicator']);
  assert.deepEqual(filteredItems.map((item) => item.id), [9387316]);

  const kbRows = [
    { number: 'KB0089941', short_description: 'Order Requisition Says Update Linked Server for Account Number Value', workflow_state: 'Published' },
    { number: 'KB1234567', short_description: 'Timeout when progress indicator hangs during form submit', workflow_state: 'Published' },
  ] as any;

  const filteredKb = filterKbEvidenceRows(kbRows, ['submit', 'timeout', 'progress', 'indicator'], ['25.3.0']);
  assert.deepEqual(filteredKb.map((row) => row.number), ['KB1234567']);
});

test('spreadsheet findings interpret duplicate names as a likely duplicate-record issue, not just a row count', () => {
  const summary = summarizeSpreadsheetFindings([
    {
      file: 'patient-export.xlsx',
      sheet: 'Patients',
      rowCount: 12,
      columnCount: 8,
      findings: [
        'Rows analyzed: 12; unique GUIDs: 8; unique PersonGUIDs: 7',
        'Duplicate display names: Test One (2)',
        'PersonGUIDs with multiple NameTypeCode values: ABC123: Patient/Provider',
        'Status counts: Active=10, Inactive=2',
      ],
    },
  ]);

  assert.ok(summary.some((line) => /duplicate.*person|same.*patient|multiple.*nametype|display names/i.test(line)));
});
