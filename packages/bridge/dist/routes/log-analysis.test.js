"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const log_analysis_1 = require("./log-analysis");
function makeHit(category, seed, line) {
    return {
        file: 'sample.log',
        line,
        text: `${seed} at line ${line}`,
        seed,
        category,
    };
}
(0, node_test_1.default)('diagnostic summary prefers server exception finding when errors and stack traces exist', () => {
    const summary = (0, log_analysis_1.buildDiagnosticSummary)({
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
    strict_1.default.match(summary.primaryFinding, /Server-side exception path/i);
    strict_1.default.equal(summary.confidence, 'high');
    strict_1.default.equal(summary.evidenceCoverage.errors, 2);
    strict_1.default.equal(summary.evidenceCoverage.stackTraces, 2);
});
(0, node_test_1.default)('diagnostic summary prefers lock contention finding for heavy lock and delay signals', () => {
    const summary = (0, log_analysis_1.buildDiagnosticSummary)({
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
    strict_1.default.match(summary.primaryFinding, /Lock contention/i);
    strict_1.default.equal(summary.confidence, 'high');
    strict_1.default.equal(summary.evidenceCoverage.locks, 28);
    strict_1.default.equal(summary.evidenceCoverage.timelineDelayRows, 22);
});
(0, node_test_1.default)('diagnostic summary prefers data-quality finding when spreadsheet signals dominate', () => {
    const summary = (0, log_analysis_1.buildDiagnosticSummary)({
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
    strict_1.default.match(summary.primaryFinding, /Data-quality|mapping drift/i);
    strict_1.default.equal(summary.confidence, 'medium');
    strict_1.default.equal(summary.evidenceCoverage.spreadsheetSignals, 3);
});
(0, node_test_1.default)('diagnostic summary prefers deadlock, auth, and network failure modes when those signals dominate', () => {
    const deadlockSummary = (0, log_analysis_1.buildDiagnosticSummary)({
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
    strict_1.default.match(deadlockSummary.primaryFinding, /deadlock/i);
    strict_1.default.equal(deadlockSummary.confidence, 'high');
    const authSummary = (0, log_analysis_1.buildDiagnosticSummary)({
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
    strict_1.default.match(authSummary.primaryFinding, /authentication|authorization/i);
    strict_1.default.equal(authSummary.confidence, 'medium');
    const networkSummary = (0, log_analysis_1.buildDiagnosticSummary)({
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
    strict_1.default.match(networkSummary.primaryFinding, /network|downstream/i);
    strict_1.default.equal(networkSummary.confidence, 'high');
});
(0, node_test_1.default)('suggestion builder emits deadlock, auth, network, and null-reference guidance', () => {
    const suggestions = (0, log_analysis_1.buildSuggestions)([
        makeHit('error', 'Deadlock', 3),
        makeHit('error', 'Authentication failed', 8),
        makeHit('error', 'HttpRequestException', 11),
        makeHit('error', 'NullReferenceException', 15),
        makeHit('warning', 'LogTraceInfo', 16),
    ]);
    strict_1.default.ok(suggestions.some((s) => /deadlock/i.test(s.title)));
    strict_1.default.ok(suggestions.some((s) => /authentication|authorization/i.test(s.title)));
    strict_1.default.ok(suggestions.some((s) => /connectivity|downstream/i.test(s.title)));
    strict_1.default.ok(suggestions.some((s) => /null guard/i.test(s.title)));
});
