import type {
  CrossReferenceResult,
  Dataset,
  Feature,
  Pattern,
  Report,
  ValidationResult,
} from "@/types";

// ---------------------------------------------------------------------------
// Report generation.
// Produces a structured, plain-English report of top discoveries with
// dataset description, features generated, combinations tested, and time
// period. Designed to read like ranked pattern discoveries for non-developers.
// ---------------------------------------------------------------------------

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtPrice(n: number): string {
  return `${n.toFixed(2)}%`;
}

function directionText(dir: Pattern["direction"]): string {
  return dir === "bullish"
    ? "upward"
    : dir === "bearish"
      ? "downward"
      : "neutral";
}

function confidenceText(c: Pattern["confidence"]): string {
  return c === "very high" ? "very high" : c;
}

function fmtRatio(n: number): string {
  return n.toFixed(2);
}

function fmtSurvival(n: number): string {
  return fmtPct(n * 100);
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * Resolve the direction-adjusted MFE/MAE ratio for a pattern, preferring the
 * validation result's recomputed value and falling back to the pattern's raw
 * `mfeMaeRatio` when validation is unavailable. Returns `null` when neither
 * source yields a usable number.
 */
function resolveRatio(
  pattern: Pattern,
  validation?: ValidationResult,
): number | null {
  if (validation && validation.directionAdjustedMfeMaeRatio != null) {
    return validation.directionAdjustedMfeMaeRatio;
  }
  return pattern.mfeMaeRatio ?? null;
}

/**
 * Generate a structured plain-English report from the dataset, features,
 * discovered patterns, and validation results.
 */
export function generateReport(
  dataset: Dataset,
  features: Feature[],
  patterns: Pattern[],
  validationResults: ValidationResult[],
  crossReferenceResults: CrossReferenceResult[] = [],
  includedDatasets: Dataset[] = [dataset],
): Report {
  const generatedAt = Date.now();
  const validationById = new Map(
    validationResults.map((v) => [v.patternId, v]),
  );

  // ---- Empty-state guard ----
  // When no discovery run is active (no patterns, no validation results),
  // return a minimal report with a clear empty-state message so the UI can
  // render gracefully instead of showing an empty document.
  if (patterns.length === 0 && validationResults.length === 0) {
    return {
      generatedAt,
      summary:
        "No discovery run is active yet. Load a dataset, configure the discovery settings, and run discovery to generate a report.",
      datasetName: dataset.name,
      sections: [
        {
          id: "empty",
          title: "No Report Available",
          paragraphs: [
            "There is no active discovery run to summarize. Once you load a dataset and run discovery, this report will populate with the dataset overview, features generated, top discoveries, and validation summary.",
          ],
        },
      ],
      topDiscoveries: [],
    };
  }

  // ---- Top patterns by win rate (default ranking) ----
  const topPatterns = patterns.slice(0, 10);

  // ---- Top patterns by direction-adjusted MFE/MAE ratio ----
  // Rank patterns by their direction-adjusted MFE/MAE ratio (preferring the
  // validation result's recomputed value, falling back to the pattern's raw
  // ratio). Patterns with a null ratio sort to the bottom.
  const topByRatio = [...patterns]
    .map((p) => ({
      pattern: p,
      validation: validationById.get(p.id),
      ratio: resolveRatio(p, validationById.get(p.id)),
    }))
    .sort((a, b) => {
      const ar = a.ratio ?? Number.NEGATIVE_INFINITY;
      const br = b.ratio ?? Number.NEGATIVE_INFINITY;
      return br - ar;
    })
    .slice(0, 10);

  const topDiscoveries = topPatterns.map((p, i) => {
    const v = validationById.get(p.id);
    return {
      rank: i + 1,
      label: p.label,
      direction: p.direction,
      winRate: p.winRate,
      avgMove: p.avgMove,
      sampleSize: p.sampleSize,
      confidence: p.confidence,
      degraded: v?.degraded ?? false,
    };
  });

  // ---- Section: Dataset Overview ----
  const datasetsForReport =
    includedDatasets.length > 0 ? includedDatasets : [dataset];
  const totalBars = datasetsForReport.reduce(
    (sum, candidate) => sum + candidate.rowCount,
    0,
  );
  const datasetNames = datasetsForReport
    .map((candidate) => candidate.label ?? candidate.name)
    .join(", ");
  const datasetSection = {
    id: "dataset",
    title: "Dataset Overview",
    paragraphs: [
      `Used ${datasetsForReport.length} selected dataset${datasetsForReport.length === 1 ? "" : "s"} containing ${totalBars.toLocaleString()} source bars. Included: ${datasetNames}. "${dataset.label ?? dataset.name}" (${dataset.timeframe}, ${fmtDate(dataset.dateRange.start)} to ${fmtDate(dataset.dateRange.end)}) supplied the prediction outcomes; every other selected dataset supplied its latest causally completed state at each target decision time.`,
    ],
  };

  // ---- Section: Features Generated ----
  const enabledFeatures = features.filter((f) => f.enabled);
  const byCategory = new Map<string, number>();
  for (const f of enabledFeatures) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  }
  const categoryLines = Array.from(byCategory.entries()).map(
    ([cat, n]) => `${cat}: ${n}`,
  );
  const featuresSection = {
    id: "features",
    title: "Features Generated",
    paragraphs: [
      `Generated ${enabledFeatures.length} measurable features across ${byCategory.size} categories. Each feature describes one measurable property of the market at every bar.`,
      `Categories: ${categoryLines.join("; ")}.`,
    ],
  };

  // ---- Section: Discovery Summary ----
  const discoverySection = {
    id: "discovery",
    title: "Discovery Summary",
    paragraphs: [
      "Tested combinations of 2-6 conditions across timeframe-aware structure, session/level, sequence, imported-signal, and causally aligned multi-timeframe features. Patterns were ranked by sample size, directional win rate, and lift over their matching unconditional baseline.",
      `Found ${patterns.length} patterns meeting the minimum sample size and win-rate thresholds. The top ${topPatterns.length} are reported below.`,
    ],
  };

  // ---- Section: Top Discoveries (narrative) ----
  const discoveryParagraphs: string[] = [];
  for (const p of topPatterns) {
    const v = validationById.get(p.id);
    const degradedNote = v?.degraded
      ? ` However, this pattern ${v.degradationNote.toLowerCase()}`
      : " It held up out-of-sample.";
    const liftNote =
      p.liftVsBaseline != null
        ? ` This is ${p.liftVsBaseline.toFixed(1)} percentage points above the ${
            p.baselineWinRate != null
              ? `${p.baselineWinRate.toFixed(1)}%`
              : "unconditional"
          } directional baseline.`
        : "";
    discoveryParagraphs.push(
      `#${p.label.replace(/^When /, "")}: price moved ${directionText(
        p.direction,
      )} ${fmtPct(p.winRate)} of the time across ${p.sampleSize} occurrences, averaging ${fmtPrice(
        p.avgMove,
      )} per move. Confidence is ${confidenceText(p.confidence)}.${liftNote}${degradedNote}`,
    );
  }
  if (discoveryParagraphs.length === 0) {
    discoveryParagraphs.push(
      "No patterns met the discovery thresholds. Try lowering the minimum win rate or sample size, or enabling more feature categories.",
    );
  }
  const topDiscoveriesSection = {
    id: "top-discoveries",
    title: "Top Discoveries",
    paragraphs: discoveryParagraphs,
  };

  // ---- Section: Top Patterns by Direction-Adjusted MFE/MAE Ratio ----
  // Ranks the same discovered patterns by their direction-adjusted MFE/MAE
  // ratio (favorable excursion vs. adverse excursion, signed for direction),
  // so bearish patterns are scored on the same scale as bullish ones.
  const ratioParagraphs: string[] = [];
  const ratioRanked = topByRatio.filter((r) => r.ratio != null);
  if (ratioRanked.length === 0) {
    ratioParagraphs.push(
      "No patterns had a computable direction-adjusted MFE/MAE ratio. This usually means the adverse excursion (MAE) was zero across the measured window.",
    );
  } else {
    ratioParagraphs.push(
      "Ranked by direction-adjusted MFE/MAE ratio — favorable excursion divided by adverse excursion, signed so bearish patterns are scored on the same scale as bullish ones. Higher is better.",
    );
    for (const r of ratioRanked) {
      const p = r.pattern;
      const v = r.validation;
      const degradedNote = v?.degraded
        ? ` Flagged as degraded out-of-sample (${v.degradationNote.toLowerCase()}).`
        : "";
      ratioParagraphs.push(
        `#${p.label.replace(/^When /, "")}: direction-adjusted MFE/MAE ratio ${fmtRatio(
          r.ratio as number,
        )} across ${p.sampleSize} occurrences (win rate ${fmtPct(
          p.winRate,
        )}, ${directionText(p.direction)}).${degradedNote}`,
      );
    }
  }
  const ratioSection = {
    id: "top-by-ratio",
    title: "Top Patterns by Direction-Adjusted MFE/MAE Ratio",
    paragraphs: ratioParagraphs,
  };

  // ---- Section: Validation Summary ----
  const validatedCount = validationResults.length;
  const degradedCount = validationResults.filter((v) => v.degraded).length;

  // Aggregate direction-adjusted MFE/MAE ratio across validated patterns
  // (filtering out null values), and average cross-symbol survival.
  const ratioValues = validationResults
    .map((v) => v.directionAdjustedMfeMaeRatio)
    .filter((n): n is number => n != null);
  const survivalValues = validationResults
    .map((v) => v.crossSymbolSurvival)
    .filter((n): n is number => n != null);
  const avgRatio = ratioValues.length > 0 ? meanOf(ratioValues) : null;
  const avgSurvival = survivalValues.length > 0 ? meanOf(survivalValues) : null;

  const validationParagraphs: string[] = [
    `Re-tested the top ${validatedCount} patterns on a 30% out-of-sample holdout (the most recent 30% of the dataset).`,
    degradedCount === 0
      ? `All ${validatedCount} patterns held up out-of-sample — their win rates did not drop meaningfully.`
      : `${degradedCount} of ${validatedCount} pattern(s) degraded out-of-sample and should be treated with caution.`,
  ];
  if (avgRatio != null) {
    validationParagraphs.push(
      `Average direction-adjusted MFE/MAE ratio across ${ratioValues.length} validated pattern${ratioValues.length === 1 ? "" : "s"}: ${fmtRatio(
        avgRatio,
      )}.`,
    );
  } else if (validatedCount > 0) {
    validationParagraphs.push(
      "No direction-adjusted MFE/MAE ratios were available across the validated patterns.",
    );
  }
  if (avgSurvival != null) {
    validationParagraphs.push(
      `Average cross-symbol survival across ${survivalValues.length} validated pattern${survivalValues.length === 1 ? "" : "s"}: ${fmtSurvival(
        avgSurvival,
      )} (share of symbols on which each pattern remained profitable).`,
    );
  } else if (validatedCount > 0) {
    validationParagraphs.push(
      "No cross-symbol survival figures were available across the validated patterns.",
    );
  }
  const validationSection = {
    id: "validation",
    title: "Validation Summary",
    paragraphs: validationParagraphs,
  };

  // ---- Section: Methodology ----
  const methodologySection = {
    id: "methodology",
    title: "Methodology",
    paragraphs: [
      "Each pattern is a combination of 2-6 conditions on the generated features. For every combination, the engine finds all bars matching every condition, then measures the forward return over a fixed horizon. Win rate is the share of matches that moved in the pattern's dominant direction.",
      "Confidence combines sample size and the margin of win rate over 50%. Patterns are ranked by a composite score that rewards both a large sample and a strong edge.",
      "Validation splits the dataset chronologically (70% in-sample, 30% out-of-sample) so the most recent data is held out. Patterns whose out-of-sample win rate drops more than 10 percentage points, or whose out-of-sample sample is too small, are flagged as degraded.",
      "All computation runs in your browser. Nothing is uploaded — your data and results live only in this tab until you close it.",
    ],
  };

  // ---- Section: Cross-Reference Findings (only when present) ----
  const sections = [
    datasetSection,
    featuresSection,
    discoverySection,
    topDiscoveriesSection,
    ratioSection,
    validationSection,
  ];
  if (crossReferenceResults.length > 0) {
    const xrefParagraphs: string[] = [
      `Cross-referenced ${crossReferenceResults.length.toLocaleString()} coincident moment${crossReferenceResults.length === 1 ? "" : "s"} where threshold-based conditions across two or more datasets aligned by timestamp.`,
    ];
    for (const r of crossReferenceResults.slice(0, 10)) {
      const when = fmtDateTime(r.timestamp);
      const datasets = r.contributingDatasets
        .map((c) => c.datasetLabel)
        .join(", ");
      const conditions = r.contributingDatasets
        .map((c) => `${c.datasetLabel} ${c.column}: ${c.condition}`)
        .join("; ");
      xrefParagraphs.push(
        `At ${when}, conditions aligned across ${datasets}. Detected: ${conditions}. Correlation strength ${r.correlationStrength.toFixed(3)} (0-1) with ${r.confidence.toLowerCase()} confidence.`,
      );
    }
    if (crossReferenceResults.length > 10) {
      xrefParagraphs.push(
        `…and ${crossReferenceResults.length - 10} more moment${crossReferenceResults.length - 10 === 1 ? "" : "s"} not listed here.`,
      );
    }
    sections.push({
      id: "cross-reference",
      title: "Cross-Reference Findings",
      paragraphs: xrefParagraphs,
    });
  }
  sections.push(methodologySection);

  // ---- Overall summary ----
  const summary =
    patterns.length === 0
      ? `Analyzed ${totalBars.toLocaleString()} bars across ${datasetsForReport.length} selected dataset${datasetsForReport.length === 1 ? "" : "s"} but found no patterns meeting the current thresholds. Adjust the discovery settings and run again.`
      : `Analyzed ${totalBars.toLocaleString()} bars across ${datasetsForReport.length} selected dataset${datasetsForReport.length === 1 ? "" : "s"} and ranked ${patterns.length} patterns. The strongest pattern moved ${directionText(
          topPatterns[0].direction,
        )} ${fmtPct(topPatterns[0].winRate)} of the time across ${topPatterns[0].sampleSize} occurrences with ${confidenceText(
          topPatterns[0].confidence,
        )} confidence.`;

  return {
    generatedAt,
    summary,
    datasetName: dataset.name,
    sections,
    topDiscoveries,
  };
}

function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
