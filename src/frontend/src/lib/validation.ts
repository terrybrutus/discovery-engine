import { computeMfeMaeRatio } from "@/lib/discovery";
import type {
  Condition,
  Dataset,
  Direction,
  Feature,
  FeatureMatrix,
  OHLCVBar,
  Pattern,
  PatternMetrics,
  ValidationResult,
} from "@/types";

// ---------------------------------------------------------------------------
// Validation engine.
// Splits the dataset chronologically 70/30, re-tests top patterns on both
// halves, breaks down by market condition (bull vs bear) and by year, and
// flags patterns that degrade significantly out-of-sample.
//
// MFE/MAE is direction-adjusted to match the discovery engine exactly.
// Raw excursions are upExcursion = maxHigh - entry and downExcursion =
// entry - minLow over the pattern's own horizon; the pattern's dominant
// direction is derived from the matches (bullCount vs bearCount by return
// sign), then for bearish patterns the favorable/adverse labeling is
// swapped so MFE = downExcursion and MAE = upExcursion. This keeps the
// MFE:MAE ratio meaningful for short setups and comparable to the discovery
// ratio. The MFE:MAE ratio is computed via the shared computeMfeMaeRatio
// helper so discovery and validation stay consistent. The ratio is not
// stored on PatternMetrics (the type has no field for it); callers that
// need it can recompute from avgMFE/avgMAE.
// ---------------------------------------------------------------------------

const SMA_PERIOD = 50;
const DEGRADATION_THRESHOLD_PP = 10; // 10 percentage points
const MIN_OOS_SAMPLE = 20;

interface Split {
  inSample: OHLCVBar[];
  outOfSample: OHLCVBar[];
  splitIdx: number; // first OOS bar index in the full dataset
}

function chronologicalSplit(bars: OHLCVBar[]): Split {
  const splitIdx = Math.floor(bars.length * 0.7);
  return {
    inSample: bars.slice(0, splitIdx),
    outOfSample: bars.slice(splitIdx),
    splitIdx,
  };
}

interface FeatureLookup {
  feature: Feature;
  values: (number | string | undefined)[];
}

function conditionMatches(
  cond: Condition,
  lookup: FeatureLookup,
  barIdx: number,
): boolean {
  const v = lookup.values[barIdx];
  if (v == null) return false;
  if (lookup.feature.type === "categorical") {
    const label = String(v);
    if (cond.operator === "eq") return label === cond.bucketLabel;
    if (cond.operator === "neq") return label !== cond.bucketLabel;
    return false;
  }
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return false;
  switch (cond.operator) {
    case "gt":
      return n > (cond.value ?? 0);
    case "gte":
      return n >= (cond.value ?? 0);
    case "lt":
      return n < (cond.value ?? 0);
    case "lte":
      return n <= (cond.value ?? 0);
    case "between":
      return n >= (cond.value ?? 0) && n <= (cond.highValue ?? 0);
    default:
      return false;
  }
}

function matchesAll(
  conditions: Condition[],
  lookups: Map<string, FeatureLookup>,
  barIdx: number,
): boolean {
  for (const c of conditions) {
    const lk = lookups.get(c.featureId);
    if (!lk || !conditionMatches(c, lk, barIdx)) return false;
  }
  return true;
}

/**
 * Measure pattern metrics over a set of matched bar indices. Uses the
 * pattern's own `horizon` for the forward window (consistent with the
 * discovery engine). MFE/MAE is direction-adjusted to mirror discovery's
 * `evaluatePattern`: excursions are normalized to entry-price percentages;
 * the pattern's dominant direction is
 * derived from the matches (bullCount vs bearCount by return sign, matching
 * discovery), then for bearish patterns the favorable/adverse labeling is
 * swapped so MFE = downExcursion and MAE = upExcursion. This keeps the
 * MFE:MAE ratio meaningful for short setups and comparable to the discovery
 * ratio. The ratio itself is computed via the shared computeMfeMaeRatio
 * helper for consistency.
 */
function measureMetrics(
  bars: OHLCVBar[],
  matches: number[],
  horizon: number,
  directionHint?: Direction,
): PatternMetrics {
  if (matches.length === 0) {
    return {
      winRate: 0,
      avgMove: 0,
      avgMAE: 0,
      avgMFE: 0,
      sampleSize: 0,
      direction: directionHint ?? "neutral",
    };
  }
  let sumRet = 0;
  let sumUpExcursion = 0; // maxHigh - entry
  let sumDownExcursion = 0; // entry - minLow
  let bull = 0;
  let bear = 0;
  // Cache per-match returns so the win-rate pass doesn't recompute.
  const rets: number[] = new Array(matches.length).fill(0);
  for (let m = 0; m < matches.length; m++) {
    const idx = matches[m];
    const exitIdx = idx + horizon;
    if (exitIdx >= bars.length) {
      rets[m] = 0;
      continue;
    }
    const entry = bars[idx].close;
    let maxHigh = entry;
    let minLow = entry;
    for (let k = idx + 1; k <= exitIdx; k++) {
      if (bars[k].high > maxHigh) maxHigh = bars[k].high;
      if (bars[k].low < minLow) minLow = bars[k].low;
    }
    const scale = Math.abs(entry) > 1e-9 ? Math.abs(entry) : 1;
    const ret = ((bars[exitIdx].close - entry) / scale) * 100;
    rets[m] = ret;
    sumRet += ret;
    sumUpExcursion += ((maxHigh - entry) / scale) * 100;
    sumDownExcursion += ((entry - minLow) / scale) * 100;
    if (ret > 0) bull++;
    else if (ret < 0) bear++;
  }
  const n = matches.length;
  // Direction is derived from the matches exactly as in discovery's
  // evaluatePattern: bullCount >= bearCount ? bullish : bearish.
  const direction: Direction =
    directionHint ?? (bull >= bear ? "bullish" : "bearish");
  let wins = 0;
  for (let m = 0; m < matches.length; m++) {
    const ret = rets[m];
    if (direction === "bullish" && ret > 0) wins++;
    else if (direction === "bearish" && ret < 0) wins++;
  }
  const avgUpExcursion = sumUpExcursion / n;
  const avgDownExcursion = sumDownExcursion / n;
  // Direction-adjusted MFE/MAE: bullish keeps the long-side proxy
  // (MFE = up excursion, MAE = down excursion); bearish flips so the
  // favorable excursion is the down move and the adverse excursion is the
  // up move. Mirrors discovery's evaluatePattern so validation ratios are
  // comparable to discovery ratios regardless of pattern direction.
  const avgMFE = direction === "bearish" ? avgDownExcursion : avgUpExcursion;
  const avgMAE = direction === "bearish" ? avgUpExcursion : avgDownExcursion;
  // Compute the ratio for consistency with discovery. PatternMetrics has no
  // field for it, so we don't store it here, but computing it via the shared
  // helper keeps the formula identical across engines.
  void computeMfeMaeRatio(avgMFE, avgMAE);
  const winRate = (wins / n) * 100;
  const z = 1.959963984540054;
  const proportion = wins / n;
  const denominator = 1 + (z * z) / n;
  const center = (proportion + (z * z) / (2 * n)) / denominator;
  const margin =
    (z *
      Math.sqrt((proportion * (1 - proportion)) / n + (z * z) / (4 * n * n))) /
    denominator;
  return {
    winRate,
    avgMove: sumRet / n,
    avgMAE,
    avgMFE,
    sampleSize: n,
    direction,
    winRateInterval: [
      Math.max(0, (center - margin) * 100),
      Math.min(100, (center + margin) * 100),
    ],
  };
}

function walkForwardAudit(
  bars: OHLCVBar[],
  pattern: Pattern,
  lookups: Map<string, FeatureLookup>,
  foldCount = 4,
): NonNullable<ValidationResult["walkForward"]> {
  const folds = Math.max(2, Math.min(8, foldCount));
  const initialTraining = 0.4;
  const remaining = 1 - initialTraining;
  const rates: number[] = [];
  let passedFolds = 0;
  for (let fold = 0; fold < folds; fold++) {
    const start = Math.floor(
      bars.length * (initialTraining + (remaining * fold) / folds),
    );
    const end = Math.floor(
      bars.length * (initialTraining + (remaining * (fold + 1)) / folds),
    );
    const matches = findMatchesInRange(
      bars,
      pattern.conditions,
      lookups,
      start,
      end,
      pattern.horizon,
    );
    const metrics = measureMetrics(
      bars,
      matches,
      pattern.horizon,
      pattern.direction,
    );
    rates.push(metrics.winRate);
    const directionHeld =
      (pattern.direction === "bullish" && metrics.avgMove > 0) ||
      (pattern.direction === "bearish" && metrics.avgMove < 0);
    if (metrics.sampleSize >= 5 && metrics.winRate >= 50 && directionHeld) {
      passedFolds++;
    }
  }
  return {
    folds,
    passedFolds,
    meanWinRate: rates.reduce((sum, value) => sum + value, 0) / rates.length,
    worstWinRate: Math.min(...rates),
  };
}

/** Classify each bar as bull or bear using a 50-period SMA of closes. */
function classifyMarket(bars: OHLCVBar[]): ("bull" | "bear")[] {
  const out: ("bull" | "bear")[] = new Array(bars.length).fill("bull");
  for (let i = 0; i < bars.length; i++) {
    if (i < SMA_PERIOD) continue;
    let sum = 0;
    for (let k = i - SMA_PERIOD + 1; k <= i; k++) sum += bars[k].close;
    const sma = sum / SMA_PERIOD;
    out[i] = bars[i].close >= sma ? "bull" : "bear";
  }
  return out;
}

function findMatchesInRange(
  bars: OHLCVBar[],
  conditions: Condition[],
  lookups: Map<string, FeatureLookup>,
  startIdx: number,
  endIdx: number,
  horizon: number,
): number[] {
  const matches: number[] = [];
  const upper = Math.min(endIdx, bars.length - horizon);
  for (let i = startIdx; i < upper; i++) {
    if (matchesAll(conditions, lookups, i)) matches.push(i);
  }
  return matches;
}

/**
 * An additional dataset (with its own feature matrix) that can be used to
 * evaluate cross-symbol survival. The primary dataset passed to
 * validatePatterns is always counted as one of the survival datasets.
 */
export interface SurvivalDataset {
  dataset: Dataset;
  matrix: FeatureMatrix;
  /** Equivalent real-time hold window expressed in this dataset's bars. */
  horizon?: number;
  /** Pattern-specific real-time conversions when recommended holds differ. */
  horizonByPatternId?: Record<string, number>;
}

/**
 * Validate the top patterns: split chronologically 70/30, re-test on both
 * halves, break down by market condition and year, and flag degradation.
 *
 * `additionalDatasets` optionally supplies other datasets (each with its own
 * feature matrix) so cross-symbol survival can be computed as the fraction
 * of datasets the pattern remains profitable on. When omitted (or empty),
 * the pattern is only evaluated on the primary dataset and
 * `crossSymbolSurvival` is `null`, because survival cannot be claimed
 * without an independent symbol.
 */
export function validatePatterns(
  dataset: Dataset,
  features: Feature[],
  matrix: FeatureMatrix,
  patterns: Pattern[],
  additionalDatasets: SurvivalDataset[] = [],
): ValidationResult[] {
  const bars = dataset.bars;
  const split = chronologicalSplit(bars);
  const market = classifyMarket(bars);

  const lookups = new Map<string, FeatureLookup>();
  for (const f of features) {
    if (matrix[f.id]) lookups.set(f.id, { feature: f, values: matrix[f.id] });
  }

  const results: ValidationResult[] = [];

  for (const pattern of patterns) {
    const inSampleMatches = findMatchesInRange(
      bars,
      pattern.conditions,
      lookups,
      0,
      split.splitIdx,
      pattern.horizon,
    );
    const outOfSampleMatches = findMatchesInRange(
      bars,
      pattern.conditions,
      lookups,
      split.splitIdx,
      bars.length,
      pattern.horizon,
    );

    const inSampleMetrics = measureMetrics(
      bars,
      inSampleMatches,
      pattern.horizon,
      pattern.direction,
    );
    const outOfSampleMetrics = measureMetrics(
      bars,
      outOfSampleMatches,
      pattern.horizon,
      pattern.direction,
    );

    // Market condition breakdown (over the full dataset).
    const bullMatches: number[] = [];
    const bearMatches: number[] = [];
    for (const idx of [...inSampleMatches, ...outOfSampleMatches]) {
      if (market[idx] === "bull") bullMatches.push(idx);
      else bearMatches.push(idx);
    }
    const byMarketCondition = {
      bull: measureMetrics(
        bars,
        bullMatches,
        pattern.horizon,
        pattern.direction,
      ),
      bear: measureMetrics(
        bars,
        bearMatches,
        pattern.horizon,
        pattern.direction,
      ),
    };

    // Per-year breakdown.
    const byYearMap = new Map<number, number[]>();
    for (const idx of [...inSampleMatches, ...outOfSampleMatches]) {
      const year = new Date(bars[idx].timestamp).getFullYear();
      if (!byYearMap.has(year)) byYearMap.set(year, []);
      byYearMap.get(year)!.push(idx);
    }
    const byYear = Array.from(byYearMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, idxs]) => ({
        year,
        metrics: measureMetrics(bars, idxs, pattern.horizon, pattern.direction),
      }));

    // Per-condition breakdown (drop one condition at a time? No — re-evaluate
    // each condition's contribution by measuring matches per condition alone).
    const conditionBreakdowns = pattern.conditions.map((cond) => {
      const lk = lookups.get(cond.featureId);
      const inMatches: number[] = [];
      const outMatches: number[] = [];
      if (lk) {
        for (let i = 0; i < split.splitIdx; i++) {
          if (conditionMatches(cond, lk, i)) inMatches.push(i);
        }
        for (let i = split.splitIdx; i < bars.length; i++) {
          if (conditionMatches(cond, lk, i)) outMatches.push(i);
        }
      }
      return {
        condition: cond,
        inSample: measureMetrics(
          bars,
          inMatches,
          pattern.horizon,
          pattern.direction,
        ),
        outOfSample: measureMetrics(
          bars,
          outMatches,
          pattern.horizon,
          pattern.direction,
        ),
      };
    });

    // Degradation flag.
    const ppDrop = inSampleMetrics.winRate - outOfSampleMetrics.winRate;
    const degraded =
      ppDrop > DEGRADATION_THRESHOLD_PP ||
      outOfSampleMetrics.sampleSize < MIN_OOS_SAMPLE;
    const degradationNote = degraded
      ? outOfSampleMetrics.sampleSize < MIN_OOS_SAMPLE
        ? `Out-of-sample sample too small (${outOfSampleMetrics.sampleSize} < ${MIN_OOS_SAMPLE}).`
        : `Win rate dropped ${ppDrop.toFixed(1)}pp out-of-sample.`
      : "Held up out-of-sample.";

    // Direction-adjusted MFE/MAE ratio. measureMetrics now returns
    // direction-adjusted avgMFE/avgMAE (matching discovery's evaluatePattern:
    // bearish patterns swap favorable/adverse), so the ratio is computed
    // directly from the out-of-sample metrics without any further swap.
    // Falls back to the pattern's raw `mfeMaeRatio` when OOS metrics are
    // empty. `null` when the ratio cannot be computed (zero MAE and zero
    // MFE, or Infinity).
    let directionAdjustedMfeMaeRatio: number | null;
    if (outOfSampleMetrics.sampleSize === 0) {
      directionAdjustedMfeMaeRatio =
        pattern.mfeMaeRatio == null || !Number.isFinite(pattern.mfeMaeRatio)
          ? null
          : pattern.mfeMaeRatio;
    } else {
      const ratio = computeMfeMaeRatio(
        outOfSampleMetrics.avgMFE,
        outOfSampleMetrics.avgMAE,
      );
      directionAdjustedMfeMaeRatio = Number.isFinite(ratio) ? ratio : null;
    }

    // Cross-symbol survival: fraction of datasets the pattern remains
    // profitable on. Profitability is direction-aware — a bullish pattern is
    // profitable when its average forward move is positive, a bearish
    // pattern when it is negative — matching the directional-accuracy
    // definition used for win rate. When only the primary dataset is
    // available the pattern trivially survives (1.0). When additional
    // datasets are supplied, the pattern is re-evaluated on each one (using
    // its own bars + feature matrix) and survival = profitable / total.
    let crossSymbolSurvival: number | null;
    let crossTimeframeSurvival: number | null = null;
    if (additionalDatasets.length === 0) {
      crossSymbolSurvival = null;
    } else {
      // Build the lookup for each additional dataset once per pattern is
      // wasteful, but patterns are few (top 20) and datasets are few.
      let profitable = 0;
      let evaluated = 0;
      let timeframeProfitable = 0;
      let timeframeEvaluated = 0;
      // Primary dataset profitability: use the pooled (in+out) matches we
      // already computed. A pattern is profitable when its average move is
      // in its dominant direction.
      const primaryMatches = outOfSampleMatches;
      if (primaryMatches.length > 0) {
        evaluated++;
        let sumRet = 0;
        for (const idx of primaryMatches) {
          const exitIdx = idx + pattern.horizon;
          if (exitIdx >= bars.length) continue;
          sumRet += bars[exitIdx].close - bars[idx].close;
        }
        const avgRet = sumRet / primaryMatches.length;
        const dir = pattern.direction;
        const isProfitable =
          (dir === "bullish" && avgRet > 0) ||
          (dir === "bearish" && avgRet < 0) ||
          (dir === "neutral" && avgRet !== 0);
        if (isProfitable) profitable++;
      }
      // Additional datasets: re-evaluate matches on each dataset's bars
      // using its own feature matrix.
      for (const additional of additionalDatasets) {
        const { dataset: ds, matrix: mx } = additional;
        const datasetHorizon =
          additional.horizonByPatternId?.[pattern.id] ??
          additional.horizon ??
          pattern.horizon;
        const lk = new Map<string, FeatureLookup>();
        for (const f of features) {
          if (mx[f.id]) lk.set(f.id, { feature: f, values: mx[f.id] });
        }
        const outOfSampleStart = Math.floor(ds.bars.length * 0.7);
        const dsMatches = findMatchesInRange(
          ds.bars,
          pattern.conditions,
          lk,
          outOfSampleStart,
          ds.bars.length,
          datasetHorizon,
        );
        if (dsMatches.length === 0) {
          // No matches on this dataset: not profitable, but still counts
          // as an evaluated dataset (the pattern did not survive here).
          evaluated++;
          if (ds.timeframe !== dataset.timeframe) timeframeEvaluated++;
          continue;
        }
        evaluated++;
        let sumRet = 0;
        for (const idx of dsMatches) {
          const exitIdx = idx + datasetHorizon;
          if (exitIdx >= ds.bars.length) continue;
          sumRet += ds.bars[exitIdx].close - ds.bars[idx].close;
        }
        const avgRet = sumRet / dsMatches.length;
        const dir = pattern.direction;
        const isProfitable =
          (dir === "bullish" && avgRet > 0) ||
          (dir === "bearish" && avgRet < 0) ||
          (dir === "neutral" && avgRet !== 0);
        if (isProfitable) profitable++;
        if (ds.timeframe !== dataset.timeframe) {
          timeframeEvaluated++;
          if (isProfitable) timeframeProfitable++;
        }
      }
      crossSymbolSurvival = evaluated > 0 ? profitable / evaluated : null;
      crossTimeframeSurvival =
        timeframeEvaluated > 0
          ? timeframeProfitable / timeframeEvaluated
          : null;
    }

    results.push({
      patternId: pattern.id,
      patternLabel: pattern.label,
      inSampleMetrics,
      outOfSampleMetrics,
      degraded,
      degradationNote,
      byMarketCondition,
      byYear,
      conditionBreakdowns,
      directionAdjustedMfeMaeRatio,
      crossSymbolSurvival,
      crossTimeframeSurvival,
      walkForward: walkForwardAudit(bars, pattern, lookups),
    });
  }

  return results;
}
