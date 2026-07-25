import type { FeatureOverrides } from "@/lib/features";
import {
  meetsConfluenceRequirement,
  resolvePatternConfluence,
} from "@/lib/patternConfluence";
import { buildReproductionRecipe } from "@/lib/reproductionRecipe";
import type {
  Condition,
  Confidence,
  Dataset,
  Direction,
  DiscoveryConfig,
  DiscoveryProgress,
  DiscoverySearchAudit,
  Feature,
  FeatureMatrix,
  OHLCVBar,
  OutcomeProfile,
  Pattern,
  PatternCoverage,
  PatternMetrics,
} from "@/types";

// ---------------------------------------------------------------------------
// Pattern discovery engine.
// Generates combinations of 2-6 conditions across enabled features, finds all
// bars matching ALL conditions, measures forward return outcome, and ranks
// patterns by statistical strength. Supports cancellation + progress.
//
// The main loop is async and yields to the main thread between chunks via
// real setTimeout(0) awaits so large datasets do not freeze the tab.
// Combination generation is lazy and capped so millions of arrays are never
// materialized in memory.
//
// MFE/MAE proxy: the engine measures entry-normalized percentage excursions
// per bar. The
// favorable/adverse labeling is direction-adjusted in evaluatePattern based
// on the pattern's dominant direction: bullish patterns keep
// MFE = upExcursion, MAE = downExcursion; bearish patterns flip to
// MFE = downExcursion, MAE = upExcursion so the ratio stays meaningful for
// short-side setups. The proxy labeling (long-side vs direction-adjusted)
// is a UI concern; the engine only computes the raw excursion values.
// ---------------------------------------------------------------------------

export interface DiscoveryRunHandle {
  patterns: Pattern[];
}

interface FeatureLookup {
  feature: Feature;
  values: (number | string | undefined)[];
}

function confidenceRating(
  winRate: number,
  sampleSize: number,
  baseline = 50,
): Confidence {
  // Margin-aware confidence: needs both a strong edge and enough samples.
  const margin = winRate - baseline;
  if (sampleSize < 30) return "low";
  if (sampleSize < 100) {
    if (margin >= 15) return "moderate";
    return "low";
  }
  if (sampleSize < 300) {
    if (margin >= 12) return "high";
    if (margin >= 8) return "moderate";
    return "low";
  }
  if (margin >= 15) return "very high";
  if (margin >= 10) return "high";
  if (margin >= 6) return "moderate";
  return "low";
}

function scorePattern(
  _winRate: number,
  sampleSize: number,
  margin: number,
): number {
  // Composite: confidence-weighted. Sample size contributes logarithmically.
  const sampleFactor = Math.log10(Math.max(10, sampleSize)) / 4; // ~0.25-1.0
  const edgeFactor = Math.max(0, margin) / 25; // 0-1 for 0-25pp edge
  return sampleFactor * 0.4 + edgeFactor * 0.6;
}

/**
 * Measure the forward outcome for a single entry bar.
 *
 * `horizon` is the forward window used for the win/loss outcome (the close
 * at `entryIdx + horizon` vs the entry close). `mfeMaeWindow` is a separate
 * forward window used only for the MFE/MAE excursion proxy; when omitted it
 * falls back to `horizon` so callers that don't care about a split window get
 * the original behavior.
 *
 * Returns percentage excursions, not pre-assigned MFE/MAE:
 *   upExcursion   = (maxHigh − entry) / entry * 100
 *   downExcursion = (entry − minLow) / entry * 100
 * The favorable/adverse assignment is direction-adjusted later in
 * evaluatePattern based on the pattern's dominant direction, so the ratio
 * stays meaningful for bearish patterns. The proxy labeling is a UI concern;
 * the engine only computes the raw excursion values.
 */
function measureOutcome(
  bars: OHLCVBar[],
  entryIdx: number,
  horizon: number,
  mfeMaeWindow?: number,
): {
  ret: number;
  upExcursion: number;
  downExcursion: number;
  direction: Direction;
} | null {
  const exitIdx = entryIdx + horizon;
  if (exitIdx >= bars.length) return null;
  const entry = bars[entryIdx].close;
  const mfeWindow = mfeMaeWindow ?? horizon;
  // The MFE/MAE window is bounded by the available bars; if it would run
  // past the dataset, clamp to the last bar so we still get a reading.
  const mfeEnd = Math.min(entryIdx + mfeWindow, bars.length - 1);
  let maxHigh = entry;
  let minLow = entry;
  for (let k = entryIdx + 1; k <= mfeEnd; k++) {
    if (bars[k].high > maxHigh) maxHigh = bars[k].high;
    if (bars[k].low < minLow) minLow = bars[k].low;
  }
  const exit = bars[exitIdx].close;
  const scale = Math.abs(entry) > 1e-9 ? Math.abs(entry) : 1;
  const ret = ((exit - entry) / scale) * 100;
  const upExcursion = ((maxHigh - entry) / scale) * 100;
  const downExcursion = ((entry - minLow) / scale) * 100;
  // Direction is determined by the sign of the average move across matches;
  // here we just return the per-bar direction for aggregation.
  const direction: Direction =
    ret > 0 ? "bullish" : ret < 0 ? "bearish" : "neutral";
  return { ret, upExcursion, downExcursion, direction };
}

/**
 * Compute the MFE:MAE ratio = avgMFE / avgMAE, guarded against zero MAE.
 * Returns +Infinity when avgMAE is zero and avgMFE is positive (a pattern
 * with no adverse excursion is maximally favorable), and 0 when both are
 * zero. Callers that need a finite number should clamp before comparison.
 */
export function computeMfeMaeRatio(avgMFE: number, avgMAE: number): number {
  if (avgMAE === 0) {
    return avgMFE > 0 ? Number.POSITIVE_INFINITY : 0;
  }
  return avgMFE / avgMAE;
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
    switch (cond.operator) {
      case "eq":
        return label === cond.bucketLabel;
      case "neq":
        return label !== cond.bucketLabel;
      default:
        return false;
    }
  }
  // numeric
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return false;
  switch (cond.operator) {
    case "eq":
      return n === cond.value;
    case "neq":
      return n !== cond.value;
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

interface EvalResult {
  metrics: PatternMetrics;
  matches: number[];
  mfeMaeRatio: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function buildTradeOutcomeSummary(
  bars: OHLCVBar[],
  matches: number[],
  direction: Direction,
  horizon: number,
): import("@/types").TradeOutcomeSummary {
  const moves: number[] = [];
  let wins = 0;
  for (const entryIndex of matches) {
    const exitIndex = entryIndex + horizon;
    if (exitIndex >= bars.length) continue;
    const entry = bars[entryIndex].close;
    const scale = Math.max(Math.abs(entry), 1e-9);
    const rawMove = ((bars[exitIndex].close - entry) / scale) * 100;
    const move = direction === "bearish" ? -rawMove : rawMove;
    moves.push(move);
    if (move > 0) wins++;
  }
  return {
    sampleSize: moves.length,
    winRate: moves.length > 0 ? (wins / moves.length) * 100 : 0,
    avgGrossMove:
      moves.length > 0
        ? moves.reduce((sum, move) => sum + move, 0) / moves.length
        : 0,
    medianGrossMove: median(moves),
  };
}

function buildExecutionComparison(
  bars: OHLCVBar[],
  matches: number[],
  direction: Direction,
  horizon: number,
): import("@/types").ExecutionComparison {
  const nonOverlapping: number[] = [];
  let nextEligibleIndex = 0;
  for (const entryIndex of matches) {
    if (entryIndex < nextEligibleIndex) continue;
    nonOverlapping.push(entryIndex);
    // A new position may begin on the bar where the prior fixed hold exits.
    nextEligibleIndex = entryIndex + horizon;
  }
  return {
    everyMatch: buildTradeOutcomeSummary(bars, matches, direction, horizon),
    nonOverlapping: buildTradeOutcomeSummary(
      bars,
      nonOverlapping,
      direction,
      horizon,
    ),
  };
}

function buildOutcomeProfile(
  bars: OHLCVBar[],
  matches: number[],
  direction: Direction,
  horizon: number,
  targets: number[],
  stops: number[],
): OutcomeProfile {
  const moves: number[] = [];
  const mfes: number[] = [];
  const maes: number[] = [];
  const targetHits = targets.map(() => 0);
  const targetBars = targets.map(() => [] as number[]);
  const stopHits = stops.map(() => 0);
  const targetBeforeStop = targets.flatMap((targetPct) =>
    stops.map((stopPct) => ({ targetPct, stopPct, hits: 0 })),
  );

  for (const entryIndex of matches) {
    const end = Math.min(entryIndex + horizon, bars.length - 1);
    if (end <= entryIndex) continue;
    const entry = bars[entryIndex].close;
    const scale = Math.max(Math.abs(entry), 1e-9);
    let favorable = 0;
    let adverse = 0;
    const firstTarget = new Array<number | null>(targets.length).fill(null);
    const firstStop = new Array<number | null>(stops.length).fill(null);
    for (let index = entryIndex + 1; index <= end; index++) {
      const up = ((bars[index].high - entry) / scale) * 100;
      const down = ((entry - bars[index].low) / scale) * 100;
      const favorableAtBar = direction === "bearish" ? down : up;
      const adverseAtBar = direction === "bearish" ? up : down;
      favorable = Math.max(favorable, favorableAtBar);
      adverse = Math.max(adverse, adverseAtBar);
      for (let ti = 0; ti < targets.length; ti++) {
        if (firstTarget[ti] == null && favorableAtBar >= targets[ti]) {
          firstTarget[ti] = index - entryIndex;
        }
      }
      for (let si = 0; si < stops.length; si++) {
        if (firstStop[si] == null && adverseAtBar >= stops[si]) {
          firstStop[si] = index - entryIndex;
        }
      }
    }
    const rawMove = ((bars[end].close - entry) / scale) * 100;
    moves.push(direction === "bearish" ? -rawMove : rawMove);
    mfes.push(favorable);
    maes.push(adverse);
    firstTarget.forEach((bar, index) => {
      if (bar != null) {
        targetHits[index]++;
        targetBars[index].push(bar);
      }
    });
    firstStop.forEach((bar, index) => {
      if (bar != null) stopHits[index]++;
    });
    for (let ti = 0; ti < targets.length; ti++) {
      for (let si = 0; si < stops.length; si++) {
        const candidate = targetBeforeStop[ti * stops.length + si];
        const targetBar = firstTarget[ti];
        const stopBar = firstStop[si];
        if (targetBar != null && (stopBar == null || targetBar < stopBar)) {
          candidate.hits++;
        }
      }
    }
  }
  const count = Math.max(1, moves.length);
  return {
    medianMove: median(moves),
    medianMFE: median(mfes),
    medianMAE: median(maes),
    targetHitRates: targets.map((targetPct, index) => ({
      targetPct,
      hitRate: (targetHits[index] / count) * 100,
      medianBars: targetBars[index].length ? median(targetBars[index]) : null,
    })),
    stopHitRates: stops.map((stopPct, index) => ({
      stopPct,
      hitRate: (stopHits[index] / count) * 100,
    })),
    targetBeforeStop: targetBeforeStop.map((candidate) => ({
      targetPct: candidate.targetPct,
      stopPct: candidate.stopPct,
      probability: (candidate.hits / count) * 100,
    })),
    failureRate: (moves.filter((move) => move <= 0).length / count) * 100,
  };
}

function approximateTwoSidedPValue(
  winRate: number,
  sampleSize: number,
  baselineWinRate: number,
): number {
  if (sampleSize <= 0) return 1;
  const p = Math.min(0.999999, Math.max(0.000001, baselineWinRate / 100));
  const observed = winRate / 100;
  const z = Math.abs(observed - p) / Math.sqrt((p * (1 - p)) / sampleSize);
  // Abramowitz-Stegun normal-tail approximation.
  const t = 1 / (1 + 0.2316419 * z);
  const density = 0.3989423 * Math.exp((-z * z) / 2);
  const tail =
    density *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return Math.min(1, Math.max(0, 2 * tail));
}

function applyFalseDiscoveryCorrection(
  patterns: Pattern[],
  tests: number,
): void {
  const ranked = patterns
    .map((pattern) => ({
      pattern,
      p: approximateTwoSidedPValue(
        pattern.winRate,
        pattern.sampleSize,
        pattern.baselineWinRate ?? 50,
      ),
    }))
    .sort((a, b) => a.p - b.p);
  let previous = 1;
  for (let index = ranked.length - 1; index >= 0; index--) {
    const q = Math.min(
      previous,
      (ranked[index].p * Math.max(1, tests)) / (index + 1),
    );
    ranked[index].pattern.falseDiscoveryRate = q;
    previous = q;
  }
}

function evaluatePattern(
  bars: OHLCVBar[],
  conditions: Condition[],
  lookups: Map<string, FeatureLookup>,
  horizon: number,
  mfeMaeWindow?: number,
): EvalResult | null {
  const matches: number[] = [];
  // Pre-filter: only scan bars where all features are defined.
  for (let i = 0; i < bars.length - horizon; i++) {
    if (matchesAll(conditions, lookups, i)) matches.push(i);
  }
  if (matches.length === 0) return null;

  let sumRet = 0;
  let sumUpExcursion = 0;
  let sumDownExcursion = 0;
  let bullCount = 0;
  let bearCount = 0;
  // Cache per-match outcomes so we don't recompute during the win-rate pass.
  const outcomes: { ret: number; direction: Direction }[] = new Array(
    matches.length,
  );
  for (let m = 0; m < matches.length; m++) {
    const idx = matches[m];
    const o = measureOutcome(bars, idx, horizon, mfeMaeWindow);
    if (!o) {
      outcomes[m] = { ret: 0, direction: "neutral" };
      continue;
    }
    sumRet += o.ret;
    sumUpExcursion += o.upExcursion;
    sumDownExcursion += o.downExcursion;
    if (o.direction === "bullish") bullCount++;
    else if (o.direction === "bearish") bearCount++;
    outcomes[m] = { ret: o.ret, direction: o.direction };
  }
  const n = matches.length;
  const avgMove = sumRet / n;
  const avgUpExcursion = sumUpExcursion / n;
  const avgDownExcursion = sumDownExcursion / n;
  // Win rate = directional accuracy: fraction of bars that moved in the
  // pattern's dominant direction.
  const direction: Direction = bullCount >= bearCount ? "bullish" : "bearish";
  let directionalWins = 0;
  for (let m = 0; m < matches.length; m++) {
    const o = outcomes[m];
    if (direction === "bullish" && o.ret > 0) directionalWins++;
    else if (direction === "bearish" && o.ret < 0) directionalWins++;
  }
  const winRate = (directionalWins / n) * 100;
  // Direction-adjusted MFE/MAE: bullish patterns keep the long-side proxy
  // (MFE = up excursion, MAE = down excursion); bearish patterns flip so
  // the favorable excursion is the down move and the adverse excursion is
  // the up move. This keeps the MFE:MAE ratio meaningful for short setups.
  const avgMFE = direction === "bearish" ? avgDownExcursion : avgUpExcursion;
  const avgMAE = direction === "bearish" ? avgUpExcursion : avgDownExcursion;
  const mfeMaeRatio = computeMfeMaeRatio(avgMFE, avgMAE);

  return {
    metrics: {
      winRate,
      avgMove,
      avgMAE,
      avgMFE,
      sampleSize: n,
      direction,
    },
    matches,
    mfeMaeRatio,
  };
}

function baselineWinRates(
  bars: OHLCVBar[],
  horizon: number,
): { bullish: number; bearish: number } {
  let bullish = 0;
  let bearish = 0;
  const total = Math.max(0, bars.length - horizon);
  if (total === 0) return { bullish: 0, bearish: 0 };
  for (let index = 0; index < total; index++) {
    const move = bars[index + horizon].close - bars[index].close;
    if (move > 0) bullish++;
    else if (move < 0) bearish++;
  }
  return {
    bullish: (bullish / total) * 100,
    bearish: (bearish / total) * 100,
  };
}

function winRateForDirection(
  bars: OHLCVBar[],
  matches: number[],
  horizon: number,
  direction: Direction,
): number {
  if (matches.length === 0) return 0;
  let wins = 0;
  for (const index of matches) {
    const exitIndex = index + horizon;
    if (exitIndex >= bars.length) continue;
    const move = bars[exitIndex].close - bars[index].close;
    if (
      (direction === "bullish" && move > 0) ||
      (direction === "bearish" && move < 0)
    ) {
      wins++;
    }
  }
  return (wins / matches.length) * 100;
}

function everyConditionAddsValue(
  bars: OHLCVBar[],
  conditions: Condition[],
  result: EvalResult,
  lookups: Map<string, FeatureLookup>,
  horizon: number,
  mfeMaeWindow: number,
): boolean {
  if (conditions.length < 2) return true;
  const minimumIncrementalLift = 0.5;
  for (let omitted = 0; omitted < conditions.length; omitted++) {
    const parentConditions = conditions.filter((_, index) => index !== omitted);
    const parent = evaluatePattern(
      bars,
      parentConditions,
      lookups,
      horizon,
      mfeMaeWindow,
    );
    if (!parent) continue;
    const parentWinRate = winRateForDirection(
      bars,
      parent.matches,
      horizon,
      result.metrics.direction,
    );
    if (result.metrics.winRate < parentWinRate + minimumIncrementalLift) {
      return false;
    }
  }
  return true;
}

function matchSetSimilarity(left: number[], right: number[]): number {
  let leftIndex = 0;
  let rightIndex = 0;
  let intersection = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      intersection++;
      leftIndex++;
      rightIndex++;
    } else if (left[leftIndex] < right[rightIndex]) {
      leftIndex++;
    } else {
      rightIndex++;
    }
  }
  const union = left.length + right.length - intersection;
  return union > 0 ? intersection / union : 1;
}

// ---------------------------------------------------------------------------
// Plain-English translation.
// Produces a natural sentence for each condition and a full pattern sentence.
// Built-in features use template-driven phrasing keyed by feature id; custom
// uploaded columns fall back to a raw "<column name> is above threshold" form.
// ---------------------------------------------------------------------------

function formatConditionValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const absolute = Math.abs(value);
  const digits = absolute >= 100 ? 2 : absolute >= 1 ? 3 : 4;
  return Number(value.toFixed(digits)).toString();
}

/** A natural-language fragment for a single condition, e.g. "RVOL is High". */
function conditionPhrase(
  cond: Condition,
  feature: Feature | undefined,
): string {
  const fname = feature?.name ?? cond.featureId;
  const isCustom = feature?.source === "custom";

  if (feature?.type === "categorical") {
    if (cond.operator === "eq") return `${fname} is ${cond.bucketLabel}`;
    if (cond.operator === "neq") return `${fname} is not ${cond.bucketLabel}`;
  }

  // Numeric conditions. For custom columns we keep the phrasing concrete and
  // reference the column name directly rather than a feature-code label.
  const v = cond.value ?? 0;
  const hv = cond.highValue ?? 0;
  const formattedValue = formatConditionValue(v);
  const formattedHighValue = formatConditionValue(hv);
  if (cond.operator === "eq" && (v === 0 || v === 1)) {
    return `${fname} is ${v === 1 ? "present" : "absent"}`;
  }
  if (cond.operator === "neq" && v === 0) {
    return `${fname} is present`;
  }
  if (isCustom) {
    switch (cond.operator) {
      case "eq":
        return `${fname} is ${formattedValue}`;
      case "neq":
        return `${fname} is not ${formattedValue}`;
      case "gt":
        return `${fname} is above ${formattedValue}`;
      case "gte":
        return `${fname} is at or above ${formattedValue}`;
      case "lt":
        return `${fname} is below ${formattedValue}`;
      case "lte":
        return `${fname} is at or below ${formattedValue}`;
      case "between":
        return `${fname} is between ${formattedValue} and ${formattedHighValue}`;
      default:
        return `${fname} matches a threshold`;
    }
  }

  switch (cond.operator) {
    case "gt":
      return `${fname} is above ${formattedValue}`;
    case "gte":
      return `${fname} is at or above ${formattedValue}`;
    case "lt":
      return `${fname} is below ${formattedValue}`;
    case "lte":
      return `${fname} is at or below ${formattedValue}`;
    case "between":
      return `${fname} is between ${formattedValue} and ${formattedHighValue}`;
    default:
      return fname;
  }
}

/** Build the full plain-English sentence for a pattern. */
export function buildPlainEnglishSentence(
  conditions: Condition[],
  features: Feature[],
  direction: Direction,
  horizon: number,
  outcomeLabel = "price",
): string {
  const byId = new Map(features.map((f) => [f.id, f]));
  const clauses = conditions.map((c) =>
    conditionPhrase(c, byId.get(c.featureId)),
  );
  // Join clauses with ", " and insert " and " before the last one for natural
  // reading. Two clauses → "A and B". Three+ → "A, B and C".
  let joined: string;
  if (clauses.length === 1) {
    joined = clauses[0];
  } else if (clauses.length === 2) {
    joined = `${clauses[0]} and ${clauses[1]}`;
  } else {
    joined = `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
  }

  const tendency =
    direction === "bullish"
      ? "rise"
      : direction === "bearish"
        ? "fall"
        : "move";
  return `When ${joined}, ${outcomeLabel} tends to ${tendency} over the next ${horizon} observations.`;
}

function conditionLabel(cond: Condition, feature: Feature | undefined): string {
  const fname = feature?.name ?? cond.featureId;
  if (feature?.type === "categorical") {
    if (cond.operator === "eq") return `${fname} is ${cond.bucketLabel}`;
    if (cond.operator === "neq") return `${fname} is not ${cond.bucketLabel}`;
  }
  if (cond.operator === "eq" && (cond.value === 0 || cond.value === 1)) {
    return `${fname} is ${cond.value === 1 ? "present" : "absent"}`;
  }
  if (cond.operator === "neq" && cond.value === 0) {
    return `${fname} is present`;
  }
  const value = formatConditionValue(cond.value ?? 0);
  const highValue = formatConditionValue(cond.highValue ?? 0);
  switch (cond.operator) {
    case "eq":
      return `${fname} = ${value}`;
    case "neq":
      return `${fname} ≠ ${value}`;
    case "gt":
      return `${fname} > ${value}`;
    case "gte":
      return `${fname} ≥ ${value}`;
    case "lt":
      return `${fname} < ${value}`;
    case "lte":
      return `${fname} ≤ ${value}`;
    case "between":
      return `${fname} between ${value} and ${highValue}`;
    default:
      return fname;
  }
}

function patternLabel(conditions: Condition[], features: Feature[]): string {
  const byId = new Map(features.map((f) => [f.id, f]));
  return `When ${conditions
    .map((c) => conditionLabel(c, byId.get(c.featureId)))
    .join(" AND ")}`;
}

const NON_STATIONARY_BUILT_INS = new Set([
  "candle_body_size",
  "candle_range",
  "trend_slope",
]);

/**
 * Raw price levels and running totals are tied to a particular instrument and
 * price regime. A threshold such as "session high > 48,409" can look
 * predictive in-sample while conveying no reusable technical relationship.
 *
 * Relative/normalised columns remain eligible, even when their names mention
 * price, so users can upload features such as "distance from resistance pct".
 */
function isNonStationaryRawLevel(feature: Feature): boolean {
  if (NON_STATIONARY_BUILT_INS.has(feature.id)) return true;
  if (feature.source !== "custom") return false;

  const name = feature.name.toLowerCase().replace(/[_-]+/g, " ");
  const isNormalised =
    /\b(?:pct|percent|percentage|ratio|relative|normalized|normalised|distance|change|return|roc|z ?score|percentile|position|location|bandwidth)\b/.test(
      name,
    );
  if (isNormalised) return false;

  const isCumulative =
    /\b(?:obv|on balance volume|cumulative|cum volume|running total)\b/.test(
      name,
    );
  const isAbsolutePrice =
    /\b(?:price|vwap|support|resistance|price level)\b/.test(name) ||
    /^(?:upper|lower|basis|middle|midline|upper band|lower band|bb upper|bb lower)$/.test(
      name,
    ) ||
    /\b(?:upper|lower|basis)\s+(?:band|level|price)\b/.test(name) ||
    /\b(?:session|daily|day|weekly|week|monthly|month)\s+(?:average\s+|avg\s+)?(?:open|high|low|close)\b/.test(
      name,
    ) ||
    /\b(?:open|high|low|close)\s+price\b/.test(name);

  return isCumulative || isAbsolutePrice;
}

export function isFeatureEligibleForDiscovery(feature: Feature): boolean {
  return !isNonStationaryRawLevel(feature);
}

function categoricalNumericValues(
  values: (number | string | undefined)[],
): number[] | null {
  const unique = new Set<number>();
  const stride = Math.max(1, Math.floor(values.length / 4096));
  for (let index = 0; index < values.length; index += stride) {
    const value = values[index];
    if (value == null) continue;
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) continue;
    unique.add(numeric);
    if (unique.size > 3) return null;
  }
  return unique.size >= 2
    ? [...unique].sort((left, right) => left - right)
    : null;
}

/**
 * Generate candidate conditions from enabled features.
 *
 * Per-feature manual overrides (FeatureOverrides) complement the default
 * empirical-quantile bucketing. For each numeric feature:
 *   - If an override provides `thresholds`, those values replace the
 *     empirical thresholds (each generates both `lt` and `gt`).
 *   - Else if an override provides `ranges`, each `{low, high}` pair generates
 *     a `between` candidate (and the empirical `lt`/`gt` candidates are
 *     dropped for that feature).
 *   - Else if an override provides a `range`, four evenly spaced thresholds
 *     are generated inside those explicit manual bounds.
 *   - Else thresholds come from observed 20/40/60/80 percentiles.
 */
function generateCandidates(
  features: Feature[],
  matrix: FeatureMatrix,
  _bars: OHLCVBar[],
  overrides: FeatureOverrides = {},
): Condition[] {
  const candidates: Condition[] = [];
  for (const feat of features) {
    if (!feat.enabled) continue;
    if (!isFeatureEligibleForDiscovery(feat)) continue;
    if (feat.type === "categorical" && feat.buckets) {
      for (const b of feat.buckets) {
        candidates.push({ featureId: feat.id, operator: "eq", bucketLabel: b });
      }
    } else if (feat.type === "numeric") {
      // Uploaded indicator/signal columns are commonly encoded as 0/1. Treat
      // them as categorical states instead of inventing thresholds such as
      // "Piercing Line < 0.6".
      const stateValues = categoricalNumericValues(matrix[feat.id] ?? []);
      if (stateValues) {
        if (stateValues.length === 2 && stateValues.includes(0)) {
          candidates.push({ featureId: feat.id, operator: "eq", value: 0 });
          candidates.push({ featureId: feat.id, operator: "neq", value: 0 });
        } else {
          for (const value of stateValues) {
            candidates.push({ featureId: feat.id, operator: "eq", value });
          }
        }
        continue;
      }
      const ov = overrides[feat.id];
      // Explicit threshold overrides replace empirical thresholds.
      if (ov?.thresholds && ov.thresholds.length > 0) {
        for (const t of ov.thresholds) {
          candidates.push({ featureId: feat.id, operator: "lt", value: t });
          candidates.push({ featureId: feat.id, operator: "gt", value: t });
        }
        // Explicit range boundaries generate `between` candidates.
        if (ov.ranges && ov.ranges.length > 0) {
          for (const r of ov.ranges) {
            candidates.push({
              featureId: feat.id,
              operator: "between",
              value: r.low,
              highValue: r.high,
            });
          }
        }
        continue;
      }
      // Explicit range boundaries (without threshold overrides) generate
      // `between` candidates and skip the empirical lt/gt set.
      if (ov?.ranges && ov.ranges.length > 0) {
        for (const r of ov.ranges) {
          candidates.push({
            featureId: feat.id,
            operator: "between",
            value: r.low,
            highValue: r.high,
          });
        }
        continue;
      }
      // A manual range intentionally controls the candidate search bounds.
      // Without one, use empirical quantiles from the actual dataset rather
      // than evenly spacing thresholds across a theoretical min/max range.
      if (ov?.range) {
        const rangeHint = ov.range;
        const [lo, hi] = rangeHint;
        const span = hi - lo;
        // 4 quantile-style thresholds per numeric feature.
        for (let q = 1; q <= 4; q++) {
          const t = lo + (span * q) / 5;
          candidates.push({ featureId: feat.id, operator: "lt", value: t });
          candidates.push({ featureId: feat.id, operator: "gt", value: t });
        }
      } else {
        const sourceValues = matrix[feat.id] ?? [];
        const stride = Math.max(1, Math.floor(sourceValues.length / 5000));
        const vals: number[] = [];
        for (let index = 0; index < sourceValues.length; index += stride) {
          const value = sourceValues[index];
          if (typeof value === "number" && Number.isFinite(value)) {
            vals.push(value);
          }
        }
        if (vals.length === 0) continue;
        vals.sort((left, right) => left - right);
        for (let q = 1; q <= 4; q++) {
          const index = Math.min(
            vals.length - 1,
            Math.floor((vals.length * q) / 5),
          );
          const t = vals[index];
          candidates.push({ featureId: feat.id, operator: "lt", value: t });
          candidates.push({ featureId: feat.id, operator: "gt", value: t });
        }
      }
    }
  }
  // Dedupe identical conditions.
  const seen = new Set<string>();
  const out: Condition[] = [];
  for (const c of candidates) {
    const key = JSON.stringify(c);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

/**
 * Lazy k-combination generator. Yields one combination at a time and never
 * materializes the full binomial set in memory. Stops early once `maxResults`
 * combinations have been yielded, so nCk in the millions never allocates
 * millions of arrays.
 *
 * The stride-sampling for the cap is deterministic and evenly distributed:
 * when the total nCk exceeds the cap, we walk the combination space in a
 * fixed stride and only yield every stride-th combination.
 */
export function* iterateCombinations<T>(
  arr: T[],
  k: number,
  maxResults: number,
): Generator<T[], void, unknown> {
  const n = arr.length;
  if (k > n || k <= 0 || maxResults <= 0) return;

  // Total number of combinations (nCk), capped at MAX_SAFE_INTEGER.
  const total = binomial(n, k);
  if (total <= maxResults) {
    // Yield every combination in lexicographic order.
    const idx = Array.from({ length: k }, (_, i) => i);
    let yielded = 0;
    while (true) {
      yield idx.map((i) => arr[i]);
      yielded++;
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
    void yielded;
    return;
  }

  // Stride sampling: walk the lexicographic combination sequence but only
  // yield every `stride`-th combination, so we emit exactly maxResults evenly
  // spaced combinations without materializing the full set.
  const stride = total / maxResults;
  // We advance the lexicographic index by `stride` between yields. To do that
  // without enumerating every combination, we use the combinatorial number
  // system: convert a target rank into a combination directly.
  for (let s = 0; s < maxResults; s++) {
    const targetRank = Math.floor(s * stride);
    yield rankToCombination(arr, k, targetRank);
  }
}

/**
 * Convert a lexicographic rank (0-based) into the corresponding k-combination
 * of `arr` using the combinatorial number system. This lets us jump directly
 * to the s-th sampled combination without enumerating the ones in between.
 */
function rankToCombination<T>(arr: T[], k: number, rank: number): T[] {
  const n = arr.length;
  const out: T[] = [];
  let r = rank;
  // Choose indices c[0] < c[1] < ... < c[k-1] such that the rank equals
  // sum_{i=0}^{k-1} C(c[i], i+1). Walk from the largest position down.
  let x = n;
  for (let i = k - 1; i >= 0; i--) {
    // Find the largest c < x such that C(c, i+1) <= r.
    let c = x - 1;
    while (c >= 0 && binomial(c, i + 1) > r) c--;
    if (c < 0) c = i; // defensive floor
    out.unshift(arr[c]);
    r -= binomial(c, i + 1);
    x = c;
  }
  return out;
}

/**
 * Resolve the effective MFE/MAE ratio mode, honoring the new
 * `mfeMaeRatioMode` field with backward-compat fallback to the legacy
 * `mfeMaeRatioEnabled` boolean.
 *   - mode === "off"      → no ratio filter.
 *   - mode === "positive" → keep patterns whose direction-adjusted ratio is
 *                           greater than `minMfeMaeRatio`.
 *   - mode === "auto"     → grid-search the threshold and pick the best.
 *   - mode undefined      → legacy: mfeMaeRatioEnabled true ⇒ "positive",
 *                                          false ⇒ "off".
 */
function resolveMfeMaeMode(
  config: DiscoveryConfig,
): "off" | "positive" | "auto" {
  if (config.mfeMaeRatioMode) return config.mfeMaeRatioMode;
  return config.mfeMaeRatioEnabled ? "positive" : "off";
}

/**
 * Decide whether a pattern passes the MFE/MAE ratio filter for a given
 * threshold. Infinity (zero MAE) passes any finite threshold; only a finite
 * ratio at or below the threshold fails. A threshold of 0 (or negative) lets
 * every pattern through — used by "off" mode and the bottom of the auto grid.
 */
function passesRatioFilter(ratio: number, threshold: number): boolean {
  if (threshold <= 0) return true;
  if (!Number.isFinite(ratio)) return true; // zero MAE ⇒ maximally favorable
  return ratio > threshold;
}

function featureAssociationScore(
  feature: Feature,
  values: FeatureMatrix[string],
  bars: OHLCVBar[],
): number {
  const usable = Math.max(0, bars.length - 1);
  if (usable === 0) return 0;
  const stride = Math.max(1, Math.floor(usable / 256));
  if (feature.type === "numeric") {
    let count = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < usable; i += stride) {
      const value = values[i];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const base = Math.abs(bars[i].close) || 1;
      const outcome = (bars[i + 1].close - bars[i].close) / base;
      count++;
      sx += value;
      sy += outcome;
      sxx += value * value;
      syy += outcome * outcome;
      sxy += value * outcome;
    }
    if (count < 8) return 0;
    const denominator = Math.sqrt(
      Math.max(0, count * sxx - sx * sx) * Math.max(0, count * syy - sy * sy),
    );
    return denominator > 0
      ? Math.abs((count * sxy - sx * sy) / denominator)
      : 0;
  }

  const groups = new Map<string, { sum: number; count: number }>();
  let total = 0;
  for (let i = 0; i < usable; i += stride) {
    const value = values[i];
    if (typeof value !== "string") continue;
    const base = Math.abs(bars[i].close) || 1;
    const outcome = (bars[i + 1].close - bars[i].close) / base;
    const group = groups.get(value) ?? { sum: 0, count: 0 };
    group.sum += outcome;
    group.count++;
    groups.set(value, group);
    total++;
  }
  if (total < 8 || groups.size < 2) return 0;
  const means = [...groups.values()]
    .filter((group) => group.count >= 2)
    .map((group) => group.sum / group.count);
  return means.length >= 2 ? Math.max(...means) - Math.min(...means) : 0;
}

/**
 * Every available feature is inspected on a bounded chronological sample.
 * Only the strongest features advance to combinatorial testing, preventing a
 * wide upload from turning into hundreds of thousands of condition objects.
 */
function screenFeatures(
  features: Feature[],
  matrix: FeatureMatrix,
  bars: OHLCVBar[],
  limit = 1200,
): Feature[] {
  if (features.length <= limit) return features;
  return features
    .map((feature, index) => ({
      feature,
      index,
      score: featureAssociationScore(feature, matrix[feature.id] ?? [], bars),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.feature);
}

/**
 * Quality score for a set of surviving patterns, used to compare grid-search
 * settings. Mirrors the Max Data probe's "pick the best" approach: we want
 * the setting that yields the strongest, most reliable pattern set, not just
 * the most patterns. The score rewards a high average win rate with enough
 * samples, and penalizes empty result sets so the grid never picks a
 * threshold that filters everything out.
 */
function scorePatternSet(patterns: Pattern[], minSampleSize: number): number {
  if (patterns.length === 0) return -1;
  let weightedWinRate = 0;
  let totalSamples = 0;
  for (const p of patterns) {
    if (p.sampleSize >= minSampleSize) {
      weightedWinRate += p.winRate * p.sampleSize;
      totalSamples += p.sampleSize;
    }
  }
  if (totalSamples === 0) return 0;
  const avgWinRate = weightedWinRate / totalSamples;
  // Reward edge (winRate above 50) weighted by sample volume, with a small
  // bonus for pattern count so a richer viable set is preferred at equal edge.
  const edge = Math.max(0, avgWinRate - 50);
  return edge * Math.log10(Math.max(10, totalSamples)) + patterns.length * 0.01;
}

const PRIORITY_TRIGGER_FEATURES = new Set([
  "pivot_event",
  "break_of_structure",
  "liquidity_sweep",
  "prev_day_level_event",
  "box_event",
  "or_breakout",
  "structure_event_sequence",
  "sweep_reclaim_sequence",
  "break_retest_sequence",
]);

const PRIORITY_CONTEXT_FEATURES = new Set([
  "candle_direction",
  "swing_sequence",
  "structure_state",
  "prev_day_level_state",
  "pivot_event",
  "break_of_structure",
  "liquidity_sweep",
  "prev_day_level_event",
  "box_event",
  "or_breakout",
  "structure_event_sequence",
  "sweep_reclaim_sequence",
  "break_retest_sequence",
]);

function baseFeatureId(featureId: string): string {
  const parts = featureId.split("__");
  return parts[parts.length - 1] ?? featureId;
}

function isInactiveState(condition: Condition): boolean {
  const label = condition.bucketLabel?.toLowerCase();
  return (
    label === "none" ||
    label === "neutral" ||
    label === "inside prior range" ||
    label === "no prior-range sweep"
  );
}

function conditionKey(conditions: Condition[]): string {
  return [...conditions]
    .map((condition) => JSON.stringify(condition))
    .sort()
    .join("|");
}

/**
 * Structural events are rare in the full threshold pool, so a uniform sample
 * can miss the exact event + cross-source state combination. Build a bounded,
 * deterministic first-pass directly from the uploaded feature lineage.
 * Dataset ids and timeframes are never named here: every source group comes
 * from Feature.originDatasetId assigned by the alignment layer.
 */
export function buildEventPriorityCombinations(
  candidates: Condition[],
  features: Feature[],
  maxDepth: number,
  budget: number,
): { combinations: Condition[][]; eligibleCount: number; skipped: number } {
  if (budget <= 0 || maxDepth < 2) {
    return { combinations: [], eligibleCount: 0, skipped: 0 };
  }
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const bySource = new Map<
    string,
    { triggers: Condition[]; contexts: Condition[] }
  >();
  for (const condition of candidates) {
    const feature = featureById.get(condition.featureId);
    const source = feature?.originDatasetId;
    if (!feature || !source || isInactiveState(condition)) continue;
    const baseId = baseFeatureId(feature.id);
    const entry = bySource.get(source) ?? { triggers: [], contexts: [] };
    if (PRIORITY_TRIGGER_FEATURES.has(baseId)) entry.triggers.push(condition);
    if (PRIORITY_CONTEXT_FEATURES.has(baseId)) entry.contexts.push(condition);
    bySource.set(source, entry);
  }

  const sources = [...bySource.keys()].sort();
  const groups: { count: number; at: (index: number) => Condition[] }[] = [];
  for (const triggerSource of sources) {
    const triggerSet = bySource.get(triggerSource)?.triggers ?? [];
    for (const contextSource of sources) {
      if (contextSource === triggerSource) continue;
      const contexts = bySource.get(contextSource)?.contexts ?? [];
      const count = triggerSet.length * contexts.length;
      if (count > 0) {
        groups.push({
          count,
          at: (index) => [
            triggerSet[index % triggerSet.length],
            contexts[Math.floor(index / triggerSet.length)],
          ],
        });
      }
    }
    if (maxDepth >= 3) {
      for (let left = 0; left < sources.length; left++) {
        const sourceA = sources[left];
        if (sourceA === triggerSource) continue;
        for (let right = left + 1; right < sources.length; right++) {
          const sourceB = sources[right];
          if (sourceB === triggerSource) continue;
          const contextsA = bySource.get(sourceA)?.contexts ?? [];
          const contextsB = bySource.get(sourceB)?.contexts ?? [];
          const count = triggerSet.length * contextsA.length * contextsB.length;
          if (count > 0) {
            groups.push({
              count,
              at: (index) => {
                const triggerIndex = index % triggerSet.length;
                const contextRank = Math.floor(index / triggerSet.length);
                const contextBIndex = contextRank % contextsB.length;
                const contextAIndex = Math.floor(
                  contextRank / contextsB.length,
                );
                return [
                  triggerSet[triggerIndex],
                  contextsA[contextAIndex],
                  contextsB[contextBIndex],
                ];
              },
            });
          }
        }
      }
    }
  }

  const eligibleCount = groups.reduce(
    (sum, group) => Math.min(Number.MAX_SAFE_INTEGER, sum + group.count),
    0,
  );
  const combinations: Condition[][] = [];
  const seen = new Set<string>();
  // Round-robin lazily across source relationships. No group's Cartesian
  // product is allocated, which keeps 40+ uploaded datasets memory bounded.
  let position = 0;
  while (combinations.length < budget) {
    const activeGroups = groups.filter((group) => position < group.count);
    if (activeGroups.length === 0) break;
    const remaining = budget - combinations.length;
    const sampleCount = Math.min(activeGroups.length, remaining);
    const stride = activeGroups.length / sampleCount;
    let added = false;
    for (let sample = 0; sample < sampleCount; sample++) {
      const group = activeGroups[Math.floor(sample * stride)];
      const combination = group.at(position);
      const key = conditionKey(combination);
      if (!seen.has(key)) {
        seen.add(key);
        combinations.push(combination);
        if (combinations.length >= budget) break;
      }
      added = true;
    }
    if (!added) break;
    position++;
  }
  return {
    combinations,
    eligibleCount,
    skipped: Math.max(0, eligibleCount - combinations.length),
  };
}

/**
 * Run pattern discovery. Generates combinations of 2-maxDepth conditions
 * across enabled features, evaluates each, and returns ranked patterns.
 *
 * The function is async and yields to the main thread between chunks via
 * real `await new Promise(r => setTimeout(r, 0))` calls (every YIELD_EVERY
 * combinations or ~50ms), so the browser stays responsive on large datasets.
 * Combination generation is lazy and capped per depth so millions of arrays
 * are never materialized.
 *
 * Calls onProgress periodically and checks shouldCancel between batches.
 * Caps total combinations at config.maxCombinations.
 *
 * Filtering: patterns must satisfy minSampleSize, minWinRate, and a 5pp
 * margin. MFE/MAE ratio filtering is controlled by `config.mfeMaeRatioMode`
 * (with backward-compat fallback to the legacy `mfeMaeRatioEnabled` flag):
 *   - "off"      → no ratio filter.
 *   - "positive" → keep patterns whose direction-adjusted ratio exceeds
 *                  `config.minMfeMaeRatio`.
 *   - "auto"     → grid-search the ratio threshold and apply the winner.
 * When `config.holdWindowAutoFind` is true, the hold-window (outcome
 * horizon) is grid-searched and the winning value is used to measure
 * outcomes; otherwise the manual `config.horizon` is used.
 *
 * `featureOverrides` (optional) is plumbed to `generateCandidates` so manual
 * per-feature threshold/range overrides complement empirical quantile
 * bucketing. Features without an override keep the empirical default.
 */
export async function runDiscovery(
  bars: OHLCVBar[],
  features: Feature[],
  matrix: FeatureMatrix,
  config: DiscoveryConfig,
  onProgress: (p: DiscoveryProgress) => void,
  shouldCancel: () => boolean,
  featureOverrides: FeatureOverrides = {},
  outcomeLabel = "price",
  onAudit?: (
    audit: Omit<
      DiscoverySearchAudit,
      "targetDatasetId" | "targetDatasetLabel" | "targetTimeframe"
    >,
  ) => void,
): Promise<Pattern[]> {
  const availableFeatures = features.filter(
    (f) =>
      f.enabled &&
      config.enabledCategories.includes(f.category) &&
      matrix[f.id] != null,
  );
  const enabledFeatures = screenFeatures(availableFeatures, matrix, bars);
  const lookups = new Map<string, FeatureLookup>();
  for (const f of enabledFeatures) {
    lookups.set(f.id, { feature: f, values: matrix[f.id] });
  }

  const candidates = generateCandidates(
    enabledFeatures,
    matrix,
    bars,
    featureOverrides,
  );
  if (candidates.length === 0) {
    onProgress({
      total: 0,
      tested: 0,
      current: "No candidate conditions available.",
      isRunning: false,
      estimatedRemainingMs: 0,
    });
    return [];
  }

  // Build combination list across depths 2..maxDepth.
  const depths: number[] = [];
  for (let d = 2; d <= config.maxDepth; d++) depths.push(d);

  let totalCombos = 0;
  const perDepth: number[] = [];
  for (const d of depths) {
    // nCk can be huge; cap each depth's contribution.
    const nCk = binomial(candidates.length, d);
    perDepth.push(nCk);
    totalCombos += nCk;
  }

  // Cap total combinations.
  const cap = Math.min(config.maxCombinations, totalCombos);
  const priorityBudget = Math.min(
    cap,
    15_000,
    Math.max(1_000, Math.floor(cap * 0.5)),
  );
  const priority = buildEventPriorityCombinations(
    candidates,
    features,
    config.maxDepth,
    priorityBudget,
  );
  const generalCap = Math.max(0, cap - priority.combinations.length);
  // Distribute the cap across depths proportionally.
  const depthCaps = perDepth.map((n) =>
    totalCombos > 0 && generalCap > 0
      ? Math.max(1, Math.round((n / totalCombos) * generalCap))
      : 0,
  );

  const startTime = Date.now();

  onProgress({
    total: cap,
    tested: 0,
    current: "Generating candidate combinations…",
    isRunning: true,
    estimatedRemainingMs: 0,
  });

  // ---- Hold-window auto-find (grid-search the outcome horizon) ----
  // When enabled, mirror the Max Data probe: iterate candidate hold-window
  // lengths, run the full evaluation pipeline for each, score the surviving
  // pattern set, and pick the value that yields the best quality. The
  // winning horizon is then used as the effective horizon for the final run.
  const HOLD_WINDOW_GRID = [1, 2, 3, 5, 8, 12, 13, 21];
  let effectiveHorizon = config.horizon;
  if (config.holdWindowAutoFind) {
    onProgress({
      total: HOLD_WINDOW_GRID.length,
      tested: 0,
      current: "Auto-finding hold window…",
      isRunning: true,
      estimatedRemainingMs: 0,
    });
    let bestHoldScore = Number.NEGATIVE_INFINITY;
    let bestHold = config.horizon;
    for (let hi = 0; hi < HOLD_WINDOW_GRID.length; hi++) {
      if (shouldCancel()) {
        onProgress({
          total: cap,
          tested: 0,
          current: "Cancelled.",
          isRunning: false,
          estimatedRemainingMs: 0,
        });
        return [];
      }
      const hw = HOLD_WINDOW_GRID[hi];
      const probePatterns = await evaluateAllPatterns(
        bars,
        candidates,
        lookups,
        features,
        config,
        depthCaps,
        depths,
        hw,
        config.mfeMaeWindow,
        "off", // skip ratio filter during hold-window probe to isolate the
        // effect of the hold window itself
        0,
        onProgress,
        shouldCancel,
        startTime,
        /* quiet */ true,
        outcomeLabel,
        priority.combinations,
      );
      const score = scorePatternSet(probePatterns, config.minSampleSize);
      if (score > bestHoldScore) {
        bestHoldScore = score;
        bestHold = hw;
      }
      onProgress({
        total: HOLD_WINDOW_GRID.length,
        tested: hi + 1,
        current: `Auto-finding hold window (${hi + 1}/${HOLD_WINDOW_GRID.length})`,
        isRunning: true,
        estimatedRemainingMs: 0,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    effectiveHorizon = bestHold;
  }

  // ---- MFE/MAE ratio mode resolution ----
  const ratioMode = resolveMfeMaeMode(config);

  // ---- MFE/MAE ratio auto-find (grid-search the threshold) ----
  // When mode === "auto", iterate candidate thresholds, evaluate the full
  // pattern set for each, score the survivors, and pick the threshold that
  // yields the best quality. The winning threshold is then applied as the
  // final filter. Mirrors the Max Data probe grid-search.
  let effectiveRatioThreshold = config.minMfeMaeRatio;
  if (ratioMode === "auto") {
    const RATIO_GRID = [0, 0.5, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];
    onProgress({
      total: RATIO_GRID.length,
      tested: 0,
      current: "Auto-finding MFE/MAE ratio threshold…",
      isRunning: true,
      estimatedRemainingMs: 0,
    });
    let bestRatioScore = Number.NEGATIVE_INFINITY;
    let bestThreshold = 0;
    for (let ri = 0; ri < RATIO_GRID.length; ri++) {
      if (shouldCancel()) {
        onProgress({
          total: cap,
          tested: 0,
          current: "Cancelled.",
          isRunning: false,
          estimatedRemainingMs: 0,
        });
        return [];
      }
      const threshold = RATIO_GRID[ri];
      const probePatterns = await evaluateAllPatterns(
        bars,
        candidates,
        lookups,
        features,
        config,
        depthCaps,
        depths,
        effectiveHorizon,
        config.mfeMaeWindow,
        "positive",
        threshold,
        onProgress,
        shouldCancel,
        startTime,
        /* quiet */ true,
        outcomeLabel,
        priority.combinations,
      );
      const score = scorePatternSet(probePatterns, config.minSampleSize);
      if (score > bestRatioScore) {
        bestRatioScore = score;
        bestThreshold = threshold;
      }
      onProgress({
        total: RATIO_GRID.length,
        tested: ri + 1,
        current: `Auto-finding MFE/MAE ratio (${ri + 1}/${RATIO_GRID.length})`,
        isRunning: true,
        estimatedRemainingMs: 0,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    effectiveRatioThreshold = bestThreshold;
  }

  // ---- Final evaluation pass with the resolved settings ----
  const finalAudit = onAudit
    ? {
        priorityPlanned: priority.combinations.length,
        priorityTested: 0,
        priorityAccepted: 0,
        generalTested: 0,
        skippedByBudget: priority.skipped,
        rejected: {
          duplicateFeature: 0,
          insufficientConfluence: 0,
          noOutcome: 0,
          smallSample: 0,
          weakWinRate: 0,
          weakLift: 0,
          redundantCondition: 0,
          weakExcursion: 0,
          duplicatePattern: 0,
        },
      }
    : undefined;
  const patterns = await evaluateAllPatterns(
    bars,
    candidates,
    lookups,
    features,
    config,
    depthCaps,
    depths,
    effectiveHorizon,
    config.mfeMaeWindow,
    ratioMode === "off" ? "off" : "positive",
    effectiveRatioThreshold,
    onProgress,
    shouldCancel,
    startTime,
    /* quiet */ false,
    outcomeLabel,
    priority.combinations,
    finalAudit,
  );

  if (onAudit && finalAudit) onAudit(finalAudit);

  // Rank by score desc, then sample size desc.
  patterns.sort((a, b) => b.score - a.score || b.sampleSize - a.sampleSize);

  onProgress({
    total: cap,
    tested: cap,
    current: "Done.",
    isRunning: false,
    estimatedRemainingMs: 0,
  });

  return patterns;
}

/**
 * Core evaluation loop, factored out so the auto-find grid-searches can
 * reuse it. Generates combinations across the configured depths, evaluates
 * each, applies the win-rate / sample-size / margin filters, and applies the
 * MFE/MAE ratio filter according to `ratioMode` + `ratioThreshold`.
 *
 * `horizon` is the effective outcome horizon (manual or auto-found hold
 * window). `mfeMaeWindow` is the separate MFE/MAE excursion window.
 *
 * When `quiet` is true, progress callbacks are suppressed (used during
 * grid-search probes so the UI doesn't flicker per-probe); the caller drives
 * its own progress reporting around the grid.
 */
async function evaluateAllPatterns(
  bars: OHLCVBar[],
  candidates: Condition[],
  lookups: Map<string, FeatureLookup>,
  features: Feature[],
  config: DiscoveryConfig,
  depthCaps: number[],
  depths: number[],
  horizon: number,
  mfeMaeWindow: number,
  ratioMode: "off" | "positive",
  ratioThreshold: number,
  onProgress: (p: DiscoveryProgress) => void,
  shouldCancel: () => boolean,
  startTime: number,
  quiet: boolean,
  outcomeLabel: string,
  priorityCombinations: Condition[][] = [],
  audit?: Omit<
    DiscoverySearchAudit,
    "targetDatasetId" | "targetDatasetLabel" | "targetTimeframe"
  >,
): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const seenMatchSets = new Set<string>();
  const keptMatchSets: number[][] = [];
  const baselines = baselineWinRates(bars, horizon);
  const minimumConfluenceSources = config.requireCrossSourceConfluence
    ? Math.max(2, config.minConfluenceSources ?? 2)
    : 1;
  let tested = 0;

  // Yield to the main thread every YIELD_EVERY combinations or every
  // YIELD_INTERVAL_MS, whichever comes first. This keeps the tab responsive
  // on large datasets without flooding the event loop with setTimeout(0).
  const YIELD_EVERY = 200;
  const YIELD_INTERVAL_MS = 50;
  let lastYieldTime = startTime;
  let sinceLastYield = 0;

  const generalKeys = new Set(priorityCombinations.map(conditionKey));
  const totalCap =
    priorityCombinations.length + depthCaps.reduce((a, b) => a + b, 0);

  const evaluateConditions = (
    conds: Condition[],
    tier: Pattern["searchTier"],
  ): void => {
    const isPriority = tier === "event-priority";
    if (isPriority && audit) audit.priorityTested++;
    if (!isPriority && audit) audit.generalTested++;

    const featIds = new Set(conds.map((condition) => condition.featureId));
    if (featIds.size !== conds.length) {
      if (isPriority && audit) audit.rejected.duplicateFeature++;
      return;
    }
    if (
      !meetsConfluenceRequirement(conds, features, minimumConfluenceSources)
    ) {
      if (isPriority && audit) audit.rejected.insufficientConfluence++;
      return;
    }
    const confluence = resolvePatternConfluence(conds, features);
    const result = evaluatePattern(bars, conds, lookups, horizon, mfeMaeWindow);
    if (!result) {
      if (isPriority && audit) audit.rejected.noOutcome++;
      return;
    }
    if (result.metrics.sampleSize < config.minSampleSize) {
      if (isPriority && audit) audit.rejected.smallSample++;
      return;
    }
    const baseline =
      result.metrics.direction === "bearish"
        ? baselines.bearish
        : baselines.bullish;
    const lift = result.metrics.winRate - baseline;
    if (result.metrics.winRate < config.minWinRate) {
      if (isPriority && audit) audit.rejected.weakWinRate++;
      return;
    }
    if (lift < 3) {
      if (isPriority && audit) audit.rejected.weakLift++;
      return;
    }
    if (
      !everyConditionAddsValue(
        bars,
        conds,
        result,
        lookups,
        horizon,
        mfeMaeWindow,
      )
    ) {
      if (isPriority && audit) audit.rejected.redundantCondition++;
      return;
    }
    if (
      ratioMode !== "off" &&
      !passesRatioFilter(result.mfeMaeRatio, ratioThreshold)
    ) {
      if (isPriority && audit) audit.rejected.weakExcursion++;
      return;
    }
    const matchSetKey = result.matches.join(",");
    const isNearDuplicate = keptMatchSets.some(
      (matches) =>
        Math.abs(matches.length - result.matches.length) /
          Math.max(matches.length, result.matches.length) <=
          0.1 && matchSetSimilarity(matches, result.matches) >= 0.95,
    );
    if (seenMatchSets.has(matchSetKey) || isNearDuplicate) {
      if (isPriority && audit) audit.rejected.duplicatePattern++;
      return;
    }
    seenMatchSets.add(matchSetKey);
    keptMatchSets.push(result.matches);
    const score = scorePattern(
      result.metrics.winRate,
      result.metrics.sampleSize,
      lift,
    );
    patterns.push({
      id: `p_${patterns.length}`,
      searchTier: tier,
      conditions: conds,
      label: patternLabel(conds, features),
      plainEnglishSentence: buildPlainEnglishSentence(
        conds,
        features,
        result.metrics.direction,
        horizon,
        outcomeLabel,
      ),
      coverage: computePatternCoverage(
        bars,
        result.matches,
        result.metrics,
        "",
        "unknown",
      ),
      direction: result.metrics.direction,
      winRate: result.metrics.winRate,
      baselineWinRate: baseline,
      liftVsBaseline: lift,
      avgMove: result.metrics.avgMove,
      avgMAE: result.metrics.avgMAE,
      avgMFE: result.metrics.avgMFE,
      mfeMaeRatio: Number.isFinite(result.mfeMaeRatio)
        ? result.mfeMaeRatio
        : undefined,
      sampleSize: result.metrics.sampleSize,
      confidence: confidenceRating(
        result.metrics.winRate,
        result.metrics.sampleSize,
        baseline,
      ),
      score,
      horizon,
      outcomeProfile: buildOutcomeProfile(
        bars,
        result.matches,
        result.metrics.direction,
        horizon,
        config.outcomeTargetsPct ?? [0.1, 0.25, 0.5, 1],
        config.outcomeStopsPct ?? [0.1, 0.25, 0.5, 1],
      ),
      executionComparison: buildExecutionComparison(
        bars,
        result.matches,
        result.metrics.direction,
        horizon,
      ),
      reproductionRecipe: buildReproductionRecipe(conds, features, horizon),
      confluenceDatasetIds: confluence.datasetIds,
      confluenceTimeframes: confluence.timeframes,
    });
    if (isPriority && audit) audit.priorityAccepted++;
  };

  const streams: {
    tier: Pattern["searchTier"];
    depth: number;
    cap: number;
    values: Iterable<Condition[]>;
  }[] = [
    {
      tier: "event-priority",
      depth: 0,
      cap: priorityCombinations.length,
      values: priorityCombinations,
    },
    ...depths.map((depth, index) => ({
      tier: "general" as const,
      depth,
      cap: depthCaps[index],
      values: iterateCombinations(candidates, depth, depthCaps[index]),
    })),
  ];

  for (const stream of streams) {
    if (stream.cap <= 0) continue;
    let ci = 0;
    for (const conds of stream.values) {
      if (shouldCancel()) {
        if (!quiet) {
          onProgress({
            total: totalCap,
            tested,
            current: "Cancelled.",
            isRunning: false,
            estimatedRemainingMs: 0,
          });
        }
        return patterns;
      }
      if (stream.tier === "general" && generalKeys.has(conditionKey(conds))) {
        tested++;
        ci++;
        continue;
      }
      evaluateConditions(conds, stream.tier);
      tested++;
      ci++;

      // Yield to the event loop + report progress every YIELD_EVERY combos
      // or every YIELD_INTERVAL_MS, whichever comes first. The await on a
      // real setTimeout(0) lets the browser paint and handle input.
      sinceLastYield++;
      const now = Date.now();
      if (
        sinceLastYield >= YIELD_EVERY ||
        now - lastYieldTime >= YIELD_INTERVAL_MS
      ) {
        if (!quiet) {
          const elapsed = now - startTime;
          const perCombo = tested > 0 ? elapsed / tested : 0;
          const remaining = Math.max(0, (totalCap - tested) * perCombo);
          onProgress({
            total: totalCap,
            tested,
            current:
              stream.tier === "event-priority"
                ? `Testing structural/event confluence ${ci}/${stream.cap}`
                : `Testing depth-${stream.depth} combination ${ci}/${stream.cap}`,
            isRunning: true,
            estimatedRemainingMs: remaining,
          });
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYieldTime = Date.now();
        sinceLastYield = 0;
      }
    }
  }

  applyFalseDiscoveryCorrection(patterns, tested);
  return patterns;
}

// ---------------------------------------------------------------------------
// Pattern coverage.
// Computes how broadly a pattern is validated across the examined history
// and flags concentration risks (single symbol, single timeframe, short
// window, few occurrences). For a single-dataset discovery run,
// isBroadlyValidated is false — cross-symbol validation (see
// computeCrossSymbolCoverage) is what flips it to true.
// ---------------------------------------------------------------------------

const FEW_OCCURRENCES_THRESHOLD = 30;
const CONCENTRATED_SPAN_FRACTION = 0.25;
const SPAN_CONSISTENCY_PP = 10;

/**
 * Compute coverage for a pattern given its matched bar indices within a
 * single dataset. `metrics` is the pattern's own aggregated metrics, used to
 * populate pooledResult/equalSymbolResult (which are identical for a single
 * dataset).
 */
export function computePatternCoverage(
  bars: OHLCVBar[],
  matches: number[],
  metrics: PatternMetrics,
  datasetName: string,
  timeframe: string,
): PatternCoverage {
  const totalBarsExamined = bars.length;
  const totalOccurrences = matches.length;

  let earliestTimestamp = 0;
  let latestTimestamp = 0;
  let firstOccurrence = 0;
  let mostRecentOccurrence = 0;
  if (matches.length > 0) {
    earliestTimestamp = bars[matches[0]].timestamp;
    latestTimestamp = bars[matches[matches.length - 1]].timestamp;
    firstOccurrence = earliestTimestamp;
    mostRecentOccurrence = latestTimestamp;
  }

  // Occurrences per symbol / timeframe. Discovery runs per-dataset, so each
  // has a single entry, but the structure supports multi-symbol.
  const symbolKey = datasetName || "dataset";
  const occurrencesPerSymbol: Record<string, number> = {
    [symbolKey]: totalOccurrences,
  };
  const occurrencesPerTimeframe: Record<string, number> = {
    [timeframe || "unknown"]: totalOccurrences,
  };

  // Occurrences by period (year). Group matches by the bar's UTC year.
  const byYearMap = new Map<number, number>();
  for (const idx of matches) {
    const year = new Date(bars[idx].timestamp).getUTCFullYear();
    byYearMap.set(year, (byYearMap.get(year) ?? 0) + 1);
  }
  const occurrencesByPeriod = Array.from(byYearMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({ period: String(year), count }));

  // Percent of history containing occurrences: occurrences / total bars * 100.
  const percentOfHistoryContainingOccurrences =
    totalBarsExamined > 0 ? (totalOccurrences / totalBarsExamined) * 100 : 0;

  // Performance consistency across the span: compare first-half vs second-half
  // win rates (within SPAN_CONSISTENCY_PP). We re-derive per-half win rates
  // from the matched bars using the pattern's direction.
  const performanceConsistentAcrossSpan = computeSpanConsistency(
    bars,
    matches,
    metrics.direction,
  );

  // Concentration flags.
  const concentrationFlags: string[] = [];
  const symbolCount = Object.keys(occurrencesPerSymbol).length;
  const timeframeCount = Object.keys(occurrencesPerTimeframe).length;
  if (symbolCount <= 1) concentrationFlags.push("symbol-specific");
  if (timeframeCount <= 1) concentrationFlags.push("timeframe-specific");
  if (totalOccurrences < FEW_OCCURRENCES_THRESHOLD)
    concentrationFlags.push("few-occurrences");
  // Concentrated in a short period: the span from first to last occurrence
  // covers less than CONCENTRATED_SPAN_FRACTION of the full data range.
  if (totalBarsExamined > 0 && matches.length > 0) {
    const dataStart = bars[0].timestamp;
    const dataEnd = bars[totalBarsExamined - 1].timestamp;
    const dataSpan = dataEnd - dataStart;
    const occSpan = latestTimestamp - earliestTimestamp;
    if (dataSpan > 0 && occSpan / dataSpan < CONCENTRATED_SPAN_FRACTION) {
      concentrationFlags.push("concentrated-in-short-period");
    }
  }

  // For a single dataset, pooled and equal-symbol results both equal the
  // pattern's own stats. isBroadlyValidated is false until cross-symbol
  // validation passes.
  const pooledResult = {
    winRate: metrics.winRate,
    avgMove: metrics.avgMove,
    sampleSize: metrics.sampleSize,
  };
  const equalSymbolResult = {
    winRate: metrics.winRate,
    avgMove: metrics.avgMove,
    sampleSize: metrics.sampleSize,
  };

  return {
    earliestTimestamp,
    latestTimestamp,
    totalBarsExamined,
    totalOccurrences,
    occurrencesPerSymbol,
    occurrencesPerTimeframe,
    occurrencesByPeriod,
    firstOccurrence,
    mostRecentOccurrence,
    percentOfHistoryContainingOccurrences,
    performanceConsistentAcrossSpan,
    concentrationFlags,
    isBroadlyValidated: false,
    pooledResult,
    equalSymbolResult,
  };
}

/**
 * Compare first-half vs second-half win rates of the matched bars. Returns
 * true when the two halves are within SPAN_CONSISTENCY_PP of each other,
 * indicating no obvious regime drift across the examined span.
 */
function computeSpanConsistency(
  bars: OHLCVBar[],
  matches: number[],
  direction: Direction,
): boolean {
  if (matches.length < 2) return matches.length > 0;
  const mid = Math.floor(matches.length / 2);
  const firstHalf = matches.slice(0, mid);
  const secondHalf = matches.slice(mid);
  const wr1 = halfWinRate(bars, firstHalf, direction);
  const wr2 = halfWinRate(bars, secondHalf, direction);
  return Math.abs(wr1 - wr2) <= SPAN_CONSISTENCY_PP;
}

function halfWinRate(
  bars: OHLCVBar[],
  matches: number[],
  direction: Direction,
): number {
  if (matches.length === 0) return 0;
  let wins = 0;
  for (const idx of matches) {
    // We don't have the horizon here; use a sign-only proxy on the next bar's
    // close vs entry close. This is a coarse consistency check, not the
    // authoritative win rate (which is computed in evaluatePattern).
    if (idx + 1 >= bars.length) continue;
    const ret = bars[idx + 1].close - bars[idx].close;
    if (direction === "bullish" && ret > 0) wins++;
    else if (direction === "bearish" && ret < 0) wins++;
  }
  return (wins / matches.length) * 100;
}

// ---------------------------------------------------------------------------
// Cross-symbol validation.
// Re-evaluates a pattern's conditions on each of several datasets, collects
// per-symbol occurrences and win rates, and computes pooled (sum all) and
// equal-symbol (average each symbol's win rate equally) results. The pattern
// is broadly validated only when >= 2 symbols each have >= minSampleSize
// occurrences and win rates within 10pp of each other.
// ---------------------------------------------------------------------------

const CROSS_SYMBOL_MIN_SYMBOLS = 2;
const CROSS_SYMBOL_WINRATE_PP = 10;

/**
 * Re-evaluate a pattern across multiple datasets and return an updated
 * coverage object whose pooled/equal-symbol results and isBroadlyValidated
 * flag reflect cross-symbol performance. The returned coverage merges the
 * per-dataset occurrence counts into occurrencesPerSymbol /
 * occurrencesPerTimeframe / occurrencesByPeriod.
 */
export function computeCrossSymbolCoverage(
  pattern: Pattern,
  datasets: Dataset[],
  featuresPerDataset: Map<string, Feature[]> = new Map(),
  matrixPerDataset: Map<string, FeatureMatrix> = new Map(),
  minSampleSize = 30,
  primaryDatasetId?: string,
): PatternCoverage | null {
  if (datasets.length === 0) return null;

  const perSymbol: {
    symbol: string;
    timeframe: string;
    occurrences: number;
    winRate: number;
    avgMove: number;
    bars: OHLCVBar[];
    matches: number[];
    metrics: PatternMetrics | null;
  }[] = [];

  const occurrencesPerSymbol: Record<string, number> = {};
  const occurrencesPerTimeframe: Record<string, number> = {};
  const byPeriodMap = new Map<string, number>();
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  let totalOccurrences = 0;
  let totalBarsExamined = 0;
  const primaryTimeframe = datasets.find(
    (dataset) => dataset.id === primaryDatasetId,
  )?.timeframe;
  const timeframeMs = (timeframe: Dataset["timeframe"]): number => {
    switch (timeframe) {
      case "1m":
        return 60_000;
      case "3m":
        return 180_000;
      case "5m":
        return 300_000;
      case "15m":
        return 900_000;
      case "30m":
        return 1_800_000;
      case "1h":
        return 3_600_000;
      case "4h":
        return 14_400_000;
      case "1d":
        return 86_400_000;
      case "1w":
        return 604_800_000;
      default:
        return 60_000;
    }
  };
  const holdDurationMs =
    pattern.horizon * timeframeMs(primaryTimeframe ?? "unknown");

  for (const ds of datasets) {
    totalBarsExamined += ds.bars.length;
    const feats = featuresPerDataset.get(ds.id);
    const mat = matrixPerDataset.get(ds.id);
    if (!feats || !mat) {
      // No feature matrix for this dataset — it contributes zero occurrences.
      perSymbol.push({
        symbol: ds.label ?? ds.name,
        timeframe: ds.timeframe,
        occurrences: 0,
        winRate: 0,
        avgMove: 0,
        bars: ds.bars,
        matches: [],
        metrics: null,
      });
      continue;
    }

    const lookups = new Map<string, FeatureLookup>();
    for (const f of feats) {
      if (mat[f.id]) lookups.set(f.id, { feature: f, values: mat[f.id] });
    }
    const datasetHorizon = Math.max(
      1,
      Math.round(holdDurationMs / timeframeMs(ds.timeframe)),
    );
    const result = evaluatePattern(
      ds.bars,
      pattern.conditions,
      lookups,
      datasetHorizon,
      datasetHorizon,
    );
    const symbol = ds.label ?? ds.name;
    const occ = result ? result.metrics.sampleSize : 0;
    const wr = result ? result.metrics.winRate : 0;
    const am = result ? result.metrics.avgMove : 0;
    perSymbol.push({
      symbol,
      timeframe: ds.timeframe,
      occurrences: occ,
      winRate: wr,
      avgMove: am,
      bars: ds.bars,
      matches: result ? result.matches : [],
      metrics: result ? result.metrics : null,
    });
    occurrencesPerSymbol[symbol] = occ;
    occurrencesPerTimeframe[ds.timeframe] =
      (occurrencesPerTimeframe[ds.timeframe] ?? 0) + occ;
    totalOccurrences += occ;
    if (result && result.matches.length > 0) {
      const first = ds.bars[result.matches[0]].timestamp;
      const last = ds.bars[result.matches[result.matches.length - 1]].timestamp;
      if (first < earliest) earliest = first;
      if (last > latest) latest = last;
      for (const idx of result.matches) {
        const year = String(new Date(ds.bars[idx].timestamp).getUTCFullYear());
        byPeriodMap.set(year, (byPeriodMap.get(year) ?? 0) + 1);
      }
    }
  }

  // Pooled result: sum all occurrences across symbols, recompute win rate as
  // the occurrence-weighted average.
  let pooledWins = 0;
  let pooledSumMove = 0;
  for (const s of perSymbol) {
    pooledWins += (s.winRate / 100) * s.occurrences;
    pooledSumMove += s.avgMove * s.occurrences;
  }
  const pooledWinRate =
    totalOccurrences > 0 ? (pooledWins / totalOccurrences) * 100 : 0;
  const pooledAvgMove =
    totalOccurrences > 0 ? pooledSumMove / totalOccurrences : 0;

  // Equal-symbol result: average each symbol's win rate equally regardless
  // of occurrence count.
  const symbolsWithOccurrences = perSymbol.filter((s) => s.occurrences > 0);
  const equalWinRate =
    symbolsWithOccurrences.length > 0
      ? symbolsWithOccurrences.reduce((acc, s) => acc + s.winRate, 0) /
        symbolsWithOccurrences.length
      : 0;
  const equalAvgMove =
    symbolsWithOccurrences.length > 0
      ? symbolsWithOccurrences.reduce((acc, s) => acc + s.avgMove, 0) /
        symbolsWithOccurrences.length
      : 0;
  const equalSampleSize = symbolsWithOccurrences.reduce(
    (acc, s) => acc + s.occurrences,
    0,
  );

  // Broadly validated: >= 2 symbols each with >= minSampleSize occurrences
  // and win rates within 10pp of each other.
  const qualifying = perSymbol.filter((s) => s.occurrences >= minSampleSize);
  let isBroadlyValidated = false;
  if (qualifying.length >= CROSS_SYMBOL_MIN_SYMBOLS) {
    const wrs = qualifying.map((s) => s.winRate);
    const minWr = Math.min(...wrs);
    const maxWr = Math.max(...wrs);
    isBroadlyValidated = maxWr - minWr <= CROSS_SYMBOL_WINRATE_PP;
  }

  // Concentration flags (recomputed across the pooled symbol set).
  const concentrationFlags: string[] = [];
  const symbolCount = Object.keys(occurrencesPerSymbol).filter(
    (k) => occurrencesPerSymbol[k] > 0,
  ).length;
  const timeframeCount = Object.keys(occurrencesPerTimeframe).filter(
    (k) => occurrencesPerTimeframe[k] > 0,
  ).length;
  if (symbolCount <= 1) concentrationFlags.push("symbol-specific");
  if (timeframeCount <= 1) concentrationFlags.push("timeframe-specific");
  if (totalOccurrences < FEW_OCCURRENCES_THRESHOLD)
    concentrationFlags.push("few-occurrences");

  const occurrencesByPeriod = Array.from(byPeriodMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, count]) => ({ period, count }));

  // Percent of history containing occurrences across all datasets.
  const percentOfHistoryContainingOccurrences =
    totalBarsExamined > 0 ? (totalOccurrences / totalBarsExamined) * 100 : 0;

  // Span consistency across the pooled matches: use the first dataset's
  // pattern direction as the reference direction.
  const allMatches: { bars: OHLCVBar[]; idx: number }[] = [];
  for (const s of perSymbol) {
    for (const idx of s.matches) allMatches.push({ bars: s.bars, idx });
  }
  const performanceConsistentAcrossSpan =
    allMatches.length >= 2
      ? computeSpanConsistencyPooled(allMatches, pattern.direction)
      : allMatches.length > 0;

  return {
    earliestTimestamp: Number.isFinite(earliest) ? earliest : 0,
    latestTimestamp: Number.isFinite(latest) ? latest : 0,
    totalBarsExamined,
    totalOccurrences,
    occurrencesPerSymbol,
    occurrencesPerTimeframe,
    occurrencesByPeriod,
    firstOccurrence: Number.isFinite(earliest) ? earliest : 0,
    mostRecentOccurrence: Number.isFinite(latest) ? latest : 0,
    percentOfHistoryContainingOccurrences,
    performanceConsistentAcrossSpan,
    concentrationFlags,
    isBroadlyValidated,
    pooledResult: {
      winRate: pooledWinRate,
      avgMove: pooledAvgMove,
      sampleSize: totalOccurrences,
    },
    equalSymbolResult: {
      winRate: equalWinRate,
      avgMove: equalAvgMove,
      sampleSize: equalSampleSize,
    },
  };
}

/** Span consistency across pooled matches from multiple datasets. */
function computeSpanConsistencyPooled(
  allMatches: { bars: OHLCVBar[]; idx: number }[],
  direction: Direction,
): boolean {
  if (allMatches.length < 2) return allMatches.length > 0;
  // Order by timestamp, then split into halves.
  const sorted = [...allMatches].sort(
    (a, b) => a.bars[a.idx].timestamp - b.bars[b.idx].timestamp,
  );
  const mid = Math.floor(sorted.length / 2);
  const wr = (slice: typeof sorted) => {
    if (slice.length === 0) return 0;
    let wins = 0;
    for (const m of slice) {
      if (m.idx + 1 >= m.bars.length) continue;
      const ret = m.bars[m.idx + 1].close - m.bars[m.idx].close;
      if (direction === "bullish" && ret > 0) wins++;
      else if (direction === "bearish" && ret < 0) wins++;
    }
    return (wins / slice.length) * 100;
  };
  return (
    Math.abs(wr(sorted.slice(0, mid)) - wr(sorted.slice(mid))) <=
    SPAN_CONSISTENCY_PP
  );
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(result));
}
