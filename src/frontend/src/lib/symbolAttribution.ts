import type { Pattern, ValidationResult } from "@/types";

export interface PatternSymbolEntry {
  symbol: string;
  occurrences: number;
  shareOfPattern: number;
}

export interface SymbolAttributionRow {
  symbol: string;
  patternCount: number;
  occurrences: number;
  shareOfReportedOccurrences: number;
  occurrenceWeightedWinRate: number;
  occurrenceWeightedAvgMove: number;
  passedPatterns: number;
  degradedPatterns: number;
}

/**
 * Resolve the symbols that actually supplied a pattern's outcome matches.
 * Coverage is authoritative; the target label is a compatibility fallback for
 * older restored runs that predate per-symbol coverage.
 */
export function patternSymbolEntries(pattern: Pattern): PatternSymbolEntry[] {
  const coverageEntries = Object.entries(
    pattern.coverage?.occurrencesPerSymbol ?? {},
  ).filter(([, count]) => Number.isFinite(count) && count > 0);
  const entries =
    coverageEntries.length > 0
      ? coverageEntries
      : [
          [
            pattern.targetDatasetLabel ?? "Unknown target",
            Math.max(0, pattern.sampleSize),
          ] as const,
        ];
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return entries
    .map(([symbol, occurrences]) => ({
      symbol,
      occurrences,
      shareOfPattern: total > 0 ? (occurrences / total) * 100 : 0,
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Aggregate reported pattern occurrences by outcome symbol. This is an
 * attribution summary, not a unique-trade count: the same bar can satisfy more
 * than one reported pattern and is intentionally counted once for each.
 */
export function summarizeSymbolAttribution(
  patterns: Pattern[],
  validationResults: ValidationResult[],
): SymbolAttributionRow[] {
  const validationById = new Map(
    validationResults.map((result) => [result.patternId, result]),
  );
  const rows = new Map<
    string,
    {
      patternIds: Set<string>;
      occurrences: number;
      weightedWinRate: number;
      weightedAvgMove: number;
      passedPatterns: number;
      degradedPatterns: number;
    }
  >();

  for (const pattern of patterns) {
    const validation = validationById.get(pattern.id);
    for (const entry of patternSymbolEntries(pattern)) {
      const row = rows.get(entry.symbol) ?? {
        patternIds: new Set<string>(),
        occurrences: 0,
        weightedWinRate: 0,
        weightedAvgMove: 0,
        passedPatterns: 0,
        degradedPatterns: 0,
      };
      row.patternIds.add(pattern.id);
      row.occurrences += entry.occurrences;
      row.weightedWinRate += pattern.winRate * entry.occurrences;
      row.weightedAvgMove += pattern.avgMove * entry.occurrences;
      if (validation) {
        if (validation.degraded) row.degradedPatterns++;
        else row.passedPatterns++;
      } else if (pattern.validationStatus === "degraded") {
        row.degradedPatterns++;
      } else if (pattern.validationStatus === "held") {
        row.passedPatterns++;
      }
      rows.set(entry.symbol, row);
    }
  }

  const totalOccurrences = [...rows.values()].reduce(
    (sum, row) => sum + row.occurrences,
    0,
  );
  return [...rows.entries()]
    .map(([symbol, row]) => ({
      symbol,
      patternCount: row.patternIds.size,
      occurrences: row.occurrences,
      shareOfReportedOccurrences:
        totalOccurrences > 0 ? (row.occurrences / totalOccurrences) * 100 : 0,
      occurrenceWeightedWinRate:
        row.occurrences > 0 ? row.weightedWinRate / row.occurrences : 0,
      occurrenceWeightedAvgMove:
        row.occurrences > 0 ? row.weightedAvgMove / row.occurrences : 0,
      passedPatterns: row.passedPatterns,
      degradedPatterns: row.degradedPatterns,
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
}
