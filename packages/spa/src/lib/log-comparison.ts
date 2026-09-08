export interface LogComparisonSource {
  topSeeds: Record<string, number>;
  byCategory: Record<string, Array<unknown>>;
  suggestions: Array<unknown>;
  explanation?: string[];
  diagnosticSummary?: {
    confidence: 'high' | 'medium' | 'low';
    evidenceCoverage: {
      errors: number;
      warnings: number;
      locks: number;
      operations: number;
      stackTraces: number;
      timelineDelayRows: number;
      spreadsheetSignals: number;
      imageSignals: number;
    };
  };
}

export interface LogComparisonSummary {
  baselineLabel: string;
  baselineScore: number;
  devassistScore: number;
  delta: number;
  baselineMetrics: {
    seeds: number;
    buckets: number;
    suggestions: number;
  };
  devassistMetrics: {
    evidenceDomains: number;
    sectionsWithSignal: number;
    confidenceBonus: number;
    explanationDepth: number;
  };
  whyBetter: string[];
}

function countNonEmpty(values: Array<number | undefined | null>): number {
  return values.filter((value) => (value ?? 0) > 0).length;
}

function scale(actual: number, target: number, points: number): number {
  if (target <= 0 || points <= 0) return 0;
  return Math.round(points * Math.min(1, Math.max(0, actual / target)));
}

export function buildLogComparisonSummary(result: LogComparisonSource): LogComparisonSummary {
  const seedCount = Object.values(result.topSeeds ?? {}).filter((count) => (count ?? 0) > 0).length;
  const bucketCount = countNonEmpty([
    result.byCategory?.error?.length,
    result.byCategory?.warning?.length,
    result.byCategory?.lock?.length,
    result.byCategory?.ops?.length,
    result.byCategory?.other?.length,
  ]);

  const baselineMetrics = {
    seeds: seedCount,
    buckets: bucketCount,
    suggestions: result.suggestions?.length ?? 0,
  };

  const coverage = result.diagnosticSummary?.evidenceCoverage;
  const evidenceDomains = countNonEmpty([
    coverage?.errors,
    coverage?.warnings,
    coverage?.locks,
    coverage?.operations,
    coverage?.stackTraces,
    coverage?.timelineDelayRows,
    coverage?.spreadsheetSignals,
    coverage?.imageSignals,
  ]);
  const sectionsWithSignal = countNonEmpty([
    coverage?.errors,
    coverage?.warnings,
    coverage?.locks,
    coverage?.stackTraces,
    coverage?.timelineDelayRows,
    coverage?.spreadsheetSignals,
    coverage?.imageSignals,
  ]);
  const confidenceBonus = result.diagnosticSummary?.confidence === 'high' ? 15 : result.diagnosticSummary?.confidence === 'medium' ? 8 : 2;
  const explanationDepth = Math.min(15, (result.explanation?.length ?? 0) * 3);

  const devassistMetrics = {
    evidenceDomains,
    sectionsWithSignal,
    confidenceBonus,
    explanationDepth,
  };

  const baselineScore =
    scale(baselineMetrics.seeds, 4, 24) +
    scale(baselineMetrics.buckets, 3, 18) +
    scale(baselineMetrics.suggestions, 2, 18);

  const devassistScore =
    scale(devassistMetrics.evidenceDomains, 6, 26) +
    scale(devassistMetrics.sectionsWithSignal, 5, 24) +
    devassistMetrics.confidenceBonus +
    devassistMetrics.explanationDepth;

  const whyBetter: string[] = [];
  if (devassistMetrics.evidenceDomains > baselineMetrics.seeds) {
    whyBetter.push(`Captures ${devassistMetrics.evidenceDomains} evidence domains instead of ${baselineMetrics.seeds} seed-only signals.`);
  }
  if (devassistMetrics.sectionsWithSignal > baselineMetrics.buckets) {
    whyBetter.push(`Preserves ${devassistMetrics.sectionsWithSignal} active evidence sections instead of ${baselineMetrics.buckets} coarse buckets.`);
  }
  if ((result.diagnosticSummary?.confidence ?? 'low') !== 'low') {
    whyBetter.push(`Assigns ${result.diagnosticSummary?.confidence ?? 'low'} confidence to the primary finding.`);
  }
  if ((result.explanation?.length ?? 0) > 0) {
    whyBetter.push(`Explains the result with ${result.explanation?.length ?? 0} reasoning lines instead of a generic summary.`);
  }

  return {
    baselineLabel: 'VSCode + keyword-only baseline',
    baselineScore,
    devassistScore,
    delta: devassistScore - baselineScore,
    baselineMetrics,
    devassistMetrics,
    whyBetter,
  };
}