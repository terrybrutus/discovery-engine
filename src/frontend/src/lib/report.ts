import { adjustForCosts, selectedExecutionSummary } from "@/lib/costAnalysis";
import { formatDefinitionParameters } from "@/lib/reproductionRecipe";
import { summarizeSymbolAttribution } from "@/lib/symbolAttribution";
import {
  validationFailureReason,
  validationHeldUp,
} from "@/lib/validationPolicy";
import type {
  CrossReferenceResult,
  Dataset,
  DiscoveryConfig,
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

function fmtDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "unknown";
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  if (hours < 24) {
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
  }
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} days`;
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
  discoveryConfig?: DiscoveryConfig,
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
      degraded: v ? !validationHeldUp(v) : false,
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
  const outcomeTargetIds = new Set(
    patterns
      .map((pattern) => pattern.targetDatasetId)
      .filter((id): id is string => Boolean(id)),
  );
  const usesMultipleOutcomeTargets = outcomeTargetIds.size > 1;
  const datasetSection = {
    id: "dataset",
    title: "Dataset Overview",
    paragraphs: [
      usesMultipleOutcomeTargets
        ? `Used ${datasetsForReport.length} selected datasets containing ${totalBars.toLocaleString()} source bars. Included: ${datasetNames}. Every selected dataset supplied prediction outcomes in its own bounded target pass; the other selected timelines supplied their latest causally completed context at each decision time.`
        : `Used ${datasetsForReport.length} selected dataset${datasetsForReport.length === 1 ? "" : "s"} containing ${totalBars.toLocaleString()} source bars. Included: ${datasetNames}. "${dataset.label ?? dataset.name}" (${dataset.timeframe}, ${fmtDate(dataset.dateRange.start)} to ${fmtDate(dataset.dateRange.end)}) supplied the prediction outcomes; every other selected dataset supplied its latest causally completed state at each target decision time.`,
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
    const degradedNote = v
      ? validationHeldUp(v)
        ? " It passed the out-of-sample reliability rule."
        : ` It failed the out-of-sample reliability rule (${validationFailureReason(v)}).`
      : " It has not been validated.";
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

  // ---- Section: Execution & Costs ----
  const executionView = discoveryConfig?.executionView ?? "non-overlapping";
  const roundTripCostBps = discoveryConfig?.roundTripCostBps ?? 0;
  const executionParagraphs = topPatterns.flatMap((pattern) => {
    const raw = pattern.executionComparison;
    const selected = selectedExecutionSummary(pattern, executionView);
    if (!raw || !selected) return [];
    const adjusted = adjustForCosts(selected, roundTripCostBps);
    return [
      `${pattern.label}: ${raw.everyMatch.sampleSize.toLocaleString()} matching bars reduce to ${raw.nonOverlapping.sampleSize.toLocaleString()} non-overlapping trades when only one ${pattern.horizon}-bar position is allowed at a time. Using the ${
        executionView === "non-overlapping"
          ? "non-overlapping trade"
          : "every-match"
      } view and ${roundTripCostBps.toFixed(1)} bps round-trip cost, the direction-adjusted average is ${adjusted.avgGrossMove.toFixed(2)}% gross and ${adjusted.avgNetMove.toFixed(2)}% net${
        adjusted.grossCostMultiple == null
          ? ""
          : ` (${adjusted.grossCostMultiple.toFixed(1)}× gross/cost, ${adjusted.cushion})`
      }.`,
    ];
  });
  const executionSection = {
    id: "execution-costs",
    title: "Execution and Cost Screen",
    paragraphs:
      executionParagraphs.length > 0
        ? [
            "This is a screening layer, not a full backtest. Estimated round-trip cost includes spread, commissions, and entry/exit slippage; a TradingView strategy should reproduce the broker-specific assumptions.",
            ...executionParagraphs,
          ]
        : [
            "This report predates the execution comparison. Re-run discovery to calculate every-match and non-overlapping trade results.",
          ],
  };

  // ---- Section: Pattern-specific hold recommendations ----
  const horizonParagraphs = topPatterns.flatMap((pattern) => {
    const analysis = pattern.horizonAnalysis;
    if (!analysis) return [];
    const curve = analysis.candidates
      .map(
        (candidate) =>
          `${candidate.horizon}b: ${candidate.nonOverlapping.sampleSize} trades, ${candidate.nonOverlapping.winRate.toFixed(1)}% wins, ${candidate.avgNetMove >= 0 ? "+" : ""}${candidate.avgNetMove.toFixed(3)}% net avg, ${candidate.maxDrawdown.toFixed(2)}% max DD`,
      )
      .join(" | ");
    return [
      `${pattern.label}: recommended ${analysis.recommendedHorizon} target bars (${fmtDuration(analysis.recommendedDurationMs)}) using ${analysis.roundTripCostBps.toFixed(1)} bps round-trip cost. ${analysis.rationale} Full curve — ${curve}.`,
    ];
  });
  const horizonSection = {
    id: "hold-window-analysis",
    title: "Pattern-Specific Hold Recommendations",
    paragraphs:
      horizonParagraphs.length > 0
        ? [
            "Each retained pattern was replayed across multiple exit horizons. Recommendations use non-overlapping net trade outcomes, return dispersion, drawdown, early/late stability, sample evidence, and time efficiency; a longer hold cannot win merely by allowing more time for price to move.",
            ...horizonParagraphs,
          ]
        : [
            "This report predates pattern-specific hold analysis. Re-run discovery to compare executable outcomes across multiple horizons.",
          ],
  };

  // ---- Section: Reproduction Recipes ----
  const recipeParagraphs = topPatterns.flatMap((pattern, index) => {
    const recipe = pattern.reproductionRecipe;
    if (!recipe) return [];
    const conditions = recipe.conditions
      .map(
        (condition, conditionIndex) =>
          `${conditionIndex + 1}) ${condition.expression}; formula: ${
            condition.formula ?? "not stored"
          }; definition: ${
            condition.definitionName ??
            (condition.source === "custom"
              ? "unidentified uploaded field"
              : "built-in")
          }; parameters: ${formatDefinitionParameters(
            condition.definitionParameters,
          )}`,
      )
      .join(" | ");
    return [
      `Recipe ${index + 1} — ${pattern.targetDatasetLabel ?? dataset.label ?? dataset.name} (${pattern.targetTimeframe ?? dataset.timeframe}): evaluate after the target observation closes. ${conditions}. Research measurement enters at the signal observation's close and exits at the close ${pattern.horizon} target observations later. ${recipe.overlapRule} ${recipe.portabilityNote} ${recipe.strategyEntryWarning}`,
    ];
  });
  const recipeSection = {
    id: "reproduction-recipes",
    title: "Reproduction Recipes",
    paragraphs:
      recipeParagraphs.length > 0
        ? [
            "These recipes are assembled deterministically from the exact feature lineage used during discovery. AI may explain a mapped definition, but it does not invent formulas, parameters, timing, or thresholds.",
            ...recipeParagraphs,
          ]
        : [
            "This report predates stored reproduction lineage. Re-run discovery to generate exact condition formulas, timing, and portability warnings.",
          ],
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
      const degradedNote = v
        ? validationHeldUp(v)
          ? " Passed the out-of-sample reliability rule."
          : ` Failed the out-of-sample reliability rule (${validationFailureReason(v)}).`
        : " Not validated.";
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
  const passedCount = validationResults.filter((result) =>
    validationHeldUp(result),
  ).length;
  const failedCount = validatedCount - passedCount;

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
  const timeframeSurvivalValues = validationResults
    .map((result) => result.crossTimeframeSurvival ?? null)
    .filter((value): value is number => value != null);
  const avgTimeframeSurvival =
    timeframeSurvivalValues.length > 0 ? meanOf(timeframeSurvivalValues) : null;

  const validationParagraphs: string[] = [
    `Re-tested the top ${validatedCount} patterns on a 30% out-of-sample holdout (the most recent 30% of the dataset).`,
    failedCount === 0
      ? `All ${validatedCount} patterns passed the reliability rule: sufficient out-of-sample occurrences, a winning OOS result, and no material degradation.`
      : `${failedCount} of ${validatedCount} pattern(s) failed the reliability rule because of insufficient out-of-sample occurrences, weak OOS performance, or material degradation.`,
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
  if (avgTimeframeSurvival != null) {
    validationParagraphs.push(
      `Average cross-timeframe survival across ${timeframeSurvivalValues.length} validated pattern${timeframeSurvivalValues.length === 1 ? "" : "s"}: ${fmtSurvival(
        avgTimeframeSurvival,
      )}.`,
    );
  } else if (validatedCount > 0) {
    validationParagraphs.push(
      "No compatible independent timeframe survival figures were available.",
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

  // ---- Section: Symbol Attribution ----
  const symbolRows = summarizeSymbolAttribution(patterns, validationResults);
  const symbolParagraphs =
    symbolRows.length > 0
      ? [
          "Reported pattern occurrences are attributed to the symbol whose future bars supplied the outcome. Percentages are shares of all reported pattern occurrences; overlapping patterns can count the same market bar more than once.",
          ...symbolRows.map(
            (row) =>
              `${row.symbol}: ${row.occurrences.toLocaleString()} occurrences (${fmtPct(
                row.shareOfReportedOccurrences,
              )}) across ${row.patternCount} reported pattern${
                row.patternCount === 1 ? "" : "s"
              }; occurrence-weighted win rate ${fmtPct(
                row.occurrenceWeightedWinRate,
              )}, average move ${fmtPrice(
                row.occurrenceWeightedAvgMove,
              )}, ${row.passedPatterns} passed and ${
                row.degradedPatterns
              } degraded.`,
          ),
        ]
      : ["No per-symbol occurrence attribution was available."];
  const symbolAttributionSection = {
    id: "symbol-attribution",
    title: "Symbol Attribution",
    paragraphs: symbolParagraphs,
  };

  // ---- Section: Methodology ----
  const methodologySection = {
    id: "methodology",
    title: "Methodology",
    paragraphs: [
      "Every imported field first passes through a versioned trading definition. Non-stationary prices and cumulative totals are converted into relative distance, ATR, percentile, change, slope, structure, and event relationships before discovery; their literal raw levels are excluded.",
      "Each pattern is a combination of 2-6 conditions on deterministic features and events. Events such as pivots, divergence, crossings, rejection, breakouts, compression, expansion, regimes, and sequences are detected first; forward outcomes are then measured separately.",
      "When more than one source dataset is selected, a reported pattern must contain conditions from at least two independently aligned sources. Single-source combinations are not reported as unified confluence discoveries.",
      "Outcomes include final return, MFE/MAE, median movement, target and stop hit rates, time-to-target, and target-before-stop probability. Confidence intervals and a multiple-testing-adjusted false-discovery estimate prevent a small sample or a large search from being presented as certainty.",
      "Every retained event is replayed across multiple holds on its outcome dataset. The recommended hold is pattern-specific and is ranked using non-overlapping net expectancy, dispersion, drawdown, early/late stability, sample evidence, and elapsed time rather than raw win rate.",
      "Validation uses a recent 30% holdout plus expanding chronological walk-forward folds. Cross-symbol and cross-timeframe survival are reported only when independent datasets were actually evaluated; a single dataset is not labeled 100% survival.",
      "Uploaded research rows and statistical calculations remain in your browser. The optional Gemini definition compiler sends only sampled column summary statistics, user notes, and optional indicator source; it never receives the uploaded row history or calculates profitability.",
    ],
  };

  // ---- Section: Cross-Reference Findings (only when present) ----
  const sections = [
    datasetSection,
    featuresSection,
    discoverySection,
    topDiscoveriesSection,
    recipeSection,
    horizonSection,
    executionSection,
    ratioSection,
    validationSection,
    symbolAttributionSection,
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
    datasetName: usesMultipleOutcomeTargets
      ? `${datasetsForReport.length}-dataset research universe`
      : dataset.name,
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
