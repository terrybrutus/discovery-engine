import { normalizeHeader } from "@/lib/csvParser";
import type {
  CrossReferenceConfig,
  CrossReferenceContribution,
  CrossReferenceResult,
  Dataset,
  OHLCVBar,
  Timeframe,
} from "@/types";

// ---------------------------------------------------------------------------
// Cross-timeframe pattern correlation engine.
//
// Given two or more datasets on different timeframes, aligns them by
// timestamp and surfaces moments where threshold-based conditions coincide
// across timeframes — e.g. an indicator threshold hit on a higher timeframe
// lining up with a price event on a lower timeframe.
//
// The main loop is async and yields to the main thread between chunks via
// real setTimeout(0) awaits (every ~200 iterations) so large datasets do
// not freeze the tab — same pattern as discovery.ts.
// ---------------------------------------------------------------------------

/** A numeric column series extracted from a dataset's bars. */
interface ColumnSeries {
  datasetId: string;
  datasetLabel: string;
  /** Original column name (preserved verbatim). */
  column: string;
  /** Per-bar value, aligned to `bars` by index. */
  values: number[];
  /** Mean of values (for threshold/condition detection). */
  mean: number;
  /** Standard deviation of values. */
  std: number;
  /** Sorted timestamps for nearest-bar lookup. */
  timestamps: number[];
  /** Reference to the source bars (for OHLC conditions). */
  bars: OHLCVBar[];
}

/** A detected threshold event on one column at one bar. */
interface DetectedEvent {
  datasetId: string;
  datasetLabel: string;
  column: string;
  barIndex: number;
  timestamp: number;
  value: number;
  condition: string;
}

const YIELD_EVERY = 200;

/**
 * Extract a numeric series for a column from a dataset.
 * Returns null if the column has no usable values.
 *
 * OHLCV columns (open/high/low/close/volume and their aliases) are read
 * directly from `bars`. Non-OHLCV columns (custom indicators like
 * "Smoothed %R", "BB Basis", "Upper BB") are read from
 * `dataset.columnValues[normalizedKey]`, which csvParser populates for
 * every non-time numeric column. If a requested column is absent, that
 * dataset/column pair is skipped; substituting close would fabricate a
 * relationship that the uploaded data never contained.
 */
function extractSeries(dataset: Dataset, column: string): ColumnSeries | null {
  const key = column.toLowerCase();
  const bars = dataset.bars;
  const values: number[] = new Array(bars.length);
  const timestamps = new Array<number>(bars.length);

  // Determine whether this is an OHLCV field, and if not, look up the
  // custom column series from dataset.columnValues.
  const ohlcvAliases = new Set([
    "open",
    "high",
    "low",
    "close",
    "price",
    "last",
    "volume",
    "vol",
    "o",
    "h",
    "l",
    "c",
    "v",
  ]);
  let customSeries: number[] | null = null;
  if (!ohlcvAliases.has(key)) {
    const normKey = normalizeHeader(column);
    const cv = dataset.columnValues;
    if (cv && normKey in cv) {
      customSeries = cv[normKey];
    } else {
      return null;
    }
  }

  let valid = true;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    timestamps[i] = b.timestamp;
    let v: number | undefined;
    if (customSeries) {
      v = customSeries[i];
    } else {
      switch (key) {
        case "open":
          v = b.open;
          break;
        case "high":
          v = b.high;
          break;
        case "low":
          v = b.low;
          break;
        case "close":
        case "price":
        case "last":
          v = b.close;
          break;
        case "volume":
        case "vol":
          v = b.volume;
          break;
        default:
          return null;
      }
    }
    if (v == null || Number.isNaN(v)) {
      valid = false;
      break;
    }
    values[i] = v;
  }
  if (!valid || values.length === 0) return null;

  // Compute mean and std in a single pass.
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let varSum = 0;
  for (const v of values) varSum += (v - mean) * (v - mean);
  const std = Math.sqrt(varSum / Math.max(1, values.length)) || 1;

  return {
    datasetId: dataset.id,
    datasetLabel: dataset.label ?? dataset.name,
    column,
    values,
    mean,
    std,
    timestamps,
    bars,
  };
}

/**
 * Detect threshold-based events on a column series.
 *
 * A "condition" is a moment where the column value crosses a statistically
 * meaningful threshold — e.g. crosses above mean + 1 std, crosses below
 * mean - 1 std, or a candle-structure event (close > open = bullish bar,
 * close < open = bearish bar). These are the coincident events we look for
 * across timeframes.
 */
function detectEvents(
  series: ColumnSeries,
  thresholdMultiplier: number,
): DetectedEvent[] {
  const events: DetectedEvent[] = [];
  const { values, mean, std, bars } = series;
  const upper = mean + std * thresholdMultiplier;
  const lower = mean - std * thresholdMultiplier;
  const col = series.column;

  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    const ts = series.timestamps[i];

    // Cross above upper band.
    if (prev <= upper && cur > upper) {
      events.push({
        datasetId: series.datasetId,
        datasetLabel: series.datasetLabel,
        column: col,
        barIndex: i,
        timestamp: ts,
        value: cur,
        condition: `${col} crossed above ${upper.toFixed(2)}`,
      });
    }
    // Cross below lower band.
    if (prev >= lower && cur < lower) {
      events.push({
        datasetId: series.datasetId,
        datasetLabel: series.datasetLabel,
        column: col,
        barIndex: i,
        timestamp: ts,
        value: cur,
        condition: `${col} crossed below ${lower.toFixed(2)}`,
      });
    }
    // Bullish bar (close > open) — only meaningful for price columns.
    if (col.toLowerCase() === "close" || col.toLowerCase() === "price") {
      if (bars[i].close > bars[i].open) {
        events.push({
          datasetId: series.datasetId,
          datasetLabel: series.datasetLabel,
          column: col,
          barIndex: i,
          timestamp: ts,
          value: cur,
          condition: `${col} bullish bar (close > open)`,
        });
      } else if (bars[i].close < bars[i].open) {
        events.push({
          datasetId: series.datasetId,
          datasetLabel: series.datasetLabel,
          column: col,
          barIndex: i,
          timestamp: ts,
          value: cur,
          condition: `${col} bearish bar (close < open)`,
        });
      }
    }
  }
  return events;
}

/**
 * Group events by dataset and find coincidences across datasets.
 *
 * For each event in the first dataset, look for events in every other
 * dataset whose timestamp falls within `toleranceMs`. When 2+ datasets
 * have an event near the same time, that's a coincidence.
 */
function findCoincidences(
  seriesByDataset: Map<string, ColumnSeries[]>,
  eventsByDataset: Map<string, DetectedEvent[]>,
  toleranceMs: number,
): { timestamp: number; events: DetectedEvent[] }[] {
  const datasetIds = Array.from(seriesByDataset.keys());
  if (datasetIds.length < 2) return [];

  // Use the dataset with the fewest events as the reference driver to
  // minimize the search space.
  let refId = datasetIds[0];
  let refEvents = eventsByDataset.get(refId) ?? [];
  for (const id of datasetIds) {
    const ev = eventsByDataset.get(id) ?? [];
    if (ev.length < refEvents.length) {
      refEvents = ev;
      refId = id;
    }
  }

  const otherIds = datasetIds.filter((id) => id !== refId);
  const coincidences: { timestamp: number; events: DetectedEvent[] }[] = [];

  for (const refEvent of refEvents) {
    const matched: DetectedEvent[] = [refEvent];
    for (const otherId of otherIds) {
      const otherEvents = eventsByDataset.get(otherId) ?? [];
      // Find the nearest event in the other dataset to refEvent.timestamp.
      let nearest: DetectedEvent | null = null;
      let nearestDist = toleranceMs;
      for (const ev of otherEvents) {
        const d = Math.abs(ev.timestamp - refEvent.timestamp);
        if (d <= nearestDist) {
          nearestDist = d;
          nearest = ev;
        }
      }
      if (nearest) matched.push(nearest);
    }
    // A coincidence requires 2+ datasets to have an event.
    if (matched.length >= 2) {
      coincidences.push({ timestamp: refEvent.timestamp, events: matched });
    }
  }

  return coincidences;
}

/**
 * Score correlation strength for a coincidence.
 *
 * Strength is based on how tightly the events cluster in time (tighter =
 * stronger) and how many datasets contribute (more = stronger). We compare
 * the observed clustering against a random-chance baseline.
 *
 * Returns a value in [0, 1].
 */
function scoreCorrelation(
  coincidence: { timestamp: number; events: DetectedEvent[] },
  toleranceMs: number,
  totalDatasets: number,
  totalEventsAcrossDatasets: number,
): number {
  // Tightness: how close the non-reference events are to the reference time.
  const refTs = coincidence.timestamp;
  const distances = coincidence.events
    .map((e) => Math.abs(e.timestamp - refTs))
    .filter((d) => d > 0);
  const avgDist =
    distances.length > 0
      ? distances.reduce((a, b) => a + b, 0) / distances.length
      : 0;
  const tightness = Math.max(0, 1 - avgDist / toleranceMs);

  // Coverage: fraction of datasets contributing.
  const contributingIds = new Set(coincidence.events.map((e) => e.datasetId));
  const coverage = contributingIds.size / totalDatasets;

  // Rarity: how unusual is this many events clustering, vs. random chance.
  // If events are uniformly distributed, the chance of 2+ landing in the
  // same tolerance window scales with event density. We approximate the
  // "lift over random" as the ratio of observed coincidences to expected.
  // For a single coincidence, lift ~ coverage * tightness * (1 / density).
  const density = Math.max(1, totalEventsAcrossDatasets / totalDatasets);
  const rarity = Math.min(1, (coverage * tightness) / Math.sqrt(density / 100));

  // Composite: weight tightness and coverage most, rarity as a tiebreaker.
  return Math.min(1, tightness * 0.45 + coverage * 0.4 + rarity * 0.15);
}

function confidenceBand(strength: number): string {
  if (strength >= 0.66) return "High";
  if (strength >= 0.33) return "Medium";
  return "Low";
}

/**
 * Build a plain-English description for a coincidence.
 */
function describeCoincidence(
  timestamp: number,
  events: DetectedEvent[],
): string {
  const when = new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const parts = events.map(
    (e) => `${e.datasetLabel}: ${e.condition} (${e.value.toFixed(2)})`,
  );
  return `On ${when}, coincident conditions across ${events.length} dataset${events.length === 1 ? "" : "s"} — ${parts.join("; ")}.`;
}

/**
 * Build the contribution list for a coincidence (one entry per dataset).
 *
 * When `reconstructionContext` is provided, each contribution is augmented
 * with `eventOrder` and `reconstructingTimeframe` from intrabar event-order
 * reconstruction: the engine descends through contained lower-TF candles
 * (across all available datasets with smaller timeframes) to determine the
 * chronological order in which the contribution's relevant price levels were
 * touched inside the higher-TF candle.
 */
function buildContributions(
  events: DetectedEvent[],
  reconstructionContext?: {
    higherBar: OHLCVBar;
    higherInterval: number;
    higherTimeframe: Timeframe;
    datasets: Dataset[];
  },
): CrossReferenceContribution[] {
  // Deduplicate by datasetId — keep the first event per dataset.
  const seen = new Set<string>();
  const out: CrossReferenceContribution[] = [];
  for (const e of events) {
    if (seen.has(e.datasetId)) continue;
    seen.add(e.datasetId);
    const contribution: CrossReferenceContribution = {
      datasetId: e.datasetId,
      datasetLabel: e.datasetLabel,
      column: e.column,
      value: e.value,
      condition: e.condition,
    };
    if (reconstructionContext) {
      const levels = levelsFromCondition(e.condition, e.column);
      if (levels.size >= 1) {
        const recon = reconstructEventOrder(
          reconstructionContext.higherBar,
          reconstructionContext.higherInterval,
          reconstructionContext.higherTimeframe,
          levels,
          e.column,
          reconstructionContext.datasets,
        );
        contribution.eventOrder = recon.eventOrder;
        contribution.reconstructingTimeframe = recon.reconstructingTimeframe;
      }
    }
    out.push(contribution);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Intrabar event-order reconstruction.
//
// When a higher-timeframe candle touches multiple relevant price levels
// (thresholds), the order in which those levels were touched inside the
// candle is not knowable from the higher-TF bar alone. We descend into
// lower-timeframe candles that are STRICTLY CONTAINED inside the higher-TF
// candle's exact [open_time, close_time) range and walk them in
// chronological order to determine which level was touched first.
//
// If two or more levels are touched within the SAME candle on the smallest
// available timeframe, we cannot resolve their relative order and record
// "order unknown at available resolution" rather than guessing.
// ---------------------------------------------------------------------------

/** Ordered list of timeframes from largest to smallest (descent order). */
const TIMEFRAME_DESCENT: Timeframe[] = [
  "1w",
  "1d",
  "4h",
  "1h",
  "30m",
  "15m",
  "5m",
  "3m",
  "1m",
];

/**
 * Strict timestamp containment predicate.
 *
 * A lower-TF candle is eligible for intrabar reconstruction of a higher-TF
 * candle ONLY if the lower candle's completed timestamp range
 *   [lower.timestamp, lower.timestamp + lowerInterval)
 * falls ENTIRELY within the higher candle's exact range
 *   [higher.timestamp, higher.timestamp + higherInterval).
 *
 * Candles whose range starts before or ends at/after the higher candle's
 * close_time are excluded — no proximity mixing.
 */
export function isContainedIn(
  lowerBar: OHLCVBar,
  lowerInterval: number,
  higherBar: OHLCVBar,
  higherInterval: number,
): boolean {
  if (lowerInterval <= 0 || higherInterval <= 0) return false;
  const lowerOpen = lowerBar.timestamp;
  const lowerClose = lowerBar.timestamp + lowerInterval; // exclusive
  const higherOpen = higherBar.timestamp;
  const higherClose = higherBar.timestamp + higherInterval; // exclusive
  return lowerOpen >= higherOpen && lowerClose <= higherClose;
}

/**
 * Determine whether a single lower-TF candle touches a given price level.
 *
 * A candle "touches" a level if the level lies within the candle's
 * [low, high] range (i.e. price traded through it during the bar). For
 * non-OHLCV threshold columns we cannot infer intrabar touch from a single
 * value, so we treat the bar's reported value as the touch point and
 * compare against the threshold directly.
 *
 * Returns true if the level is touched within this candle.
 */
function candleTouchesLevel(
  bar: OHLCVBar,
  level: number,
  column: string,
): boolean {
  const key = column.toLowerCase();
  switch (key) {
    case "high":
      return bar.high >= level;
    case "low":
      return bar.low <= level;
    case "open":
      // Touched if the level is within [low, high] (price passed through open).
      return bar.low <= level && level <= bar.high;
    case "close":
    case "price":
    case "last":
      return bar.low <= level && level <= bar.high;
    case "volume":
    case "vol":
      return bar.volume >= level;
    default:
      // For custom indicator columns we don't have intrabar OHLC; treat
      // the bar's close as the touch point and compare to the level.
      return bar.close >= level;
  }
}

/**
 * Result of an intrabar event-order reconstruction attempt.
 */
interface ReconstructionResult {
  /** Resolved order description, or "order unknown at available resolution". */
  eventOrder: string;
  /** Smallest timeframe used to resolve the order, or null if unresolved. */
  reconstructingTimeframe: Timeframe | null;
}

/**
 * Reconstruct the chronological order in which the relevant price levels
 * were touched inside a higher-TF candle, by descending through contained
 * lower-TF candles from all available datasets with smaller timeframes.
 *
 * `levels` is a map from a human-readable level label to the numeric
 * threshold value (e.g. { "upper band": 142.5, "lower band": 137.2 }).
 * `column` is the column the levels refer to (used for touch detection).
 *
 * Descent strategy:
 *  1. Start at the largest timeframe strictly smaller than the higher TF.
 *  2. Walk contained candles in chronological order; record the first
 *     candle that touches each level. If all levels get a distinct
 *     first-touch candle, order them by candle timestamp.
 *  3. If two or more levels share the SAME first-touch candle, descend to
 *     the next smaller timeframe and repeat using only the candles
 *     contained within that shared candle.
 *  4. If we reach the smallest available timeframe and levels still share
 *     a candle, return "order unknown at available resolution".
 *
 * If no contained lower-TF candles are available at all, returns
 * "order unknown at available resolution" with a null timeframe.
 */
function reconstructEventOrder(
  higherBar: OHLCVBar,
  higherInterval: number,
  higherTimeframe: Timeframe,
  levels: Map<string, number>,
  column: string,
  datasets: Dataset[],
): ReconstructionResult {
  const UNKNOWN = "order unknown at available resolution";
  if (levels.size < 2) {
    // Nothing to order — a single level (or none) is trivially "first".
    if (levels.size === 0) {
      return { eventOrder: UNKNOWN, reconstructingTimeframe: null };
    }
    const onlyLabel = Array.from(levels.keys())[0];
    return {
      eventOrder: `${onlyLabel} touched`,
      reconstructingTimeframe: null,
    };
  }

  // Determine the descent chain: only timeframes strictly smaller than the
  // higher timeframe, in descending order (largest eligible first).
  const higherIdx = TIMEFRAME_DESCENT.indexOf(higherTimeframe);
  const descent: Timeframe[] =
    higherIdx >= 0
      ? TIMEFRAME_DESCENT.slice(higherIdx + 1)
      : TIMEFRAME_DESCENT.slice();

  if (descent.length === 0) {
    return { eventOrder: UNKNOWN, reconstructingTimeframe: null };
  }

  // Recursive descent: at each level we have a "current candle" (initially
  // the higher-TF candle) and a set of unresolved levels. We try to assign
  // each level to the first contained candle that touches it.
  function descend(
    currentBar: OHLCVBar,
    currentInterval: number,
    currentTfIndex: number,
    unresolved: Map<string, number>,
  ): ReconstructionResult {
    if (unresolved.size === 0) {
      // Shouldn't happen, but guard anyway.
      return { eventOrder: UNKNOWN, reconstructingTimeframe: null };
    }

    // Find the smallest timeframe at or below currentTfIndex that has
    // contained candles touching at least one unresolved level.
    for (let ti = currentTfIndex; ti < descent.length; ti++) {
      const tf = descent[ti];
      const tfInterval = timeframeMs(tf);
      if (tfInterval <= 0) continue;

      // Gather contained candles across all datasets on this timeframe.
      const contained: {
        bar: OHLCVBar;
        interval: number;
      }[] = [];
      for (const ds of datasets) {
        if (ds.timeframe !== tf) continue;
        for (const b of ds.bars) {
          if (isContainedIn(b, tfInterval, currentBar, currentInterval)) {
            contained.push({ bar: b, interval: tfInterval });
          }
        }
      }
      if (contained.length === 0) continue;
      contained.sort((a, b) => a.bar.timestamp - b.bar.timestamp);

      // Walk candles chronologically; record the first candle that touches
      // each unresolved level.
      const firstTouch: Map<string, OHLCVBar> = new Map();
      for (const { bar } of contained) {
        for (const [label, level] of unresolved) {
          if (firstTouch.has(label)) continue;
          if (candleTouchesLevel(bar, level, column)) {
            firstTouch.set(label, bar);
          }
        }
        if (firstTouch.size === unresolved.size) break;
      }

      if (firstTouch.size === 0) {
        // No level touched at this timeframe; try smaller timeframes.
        continue;
      }

      // Group levels by their first-touch candle (by timestamp identity).
      // Multiple levels touched in the same candle need further descent.
      const byCandleTs = new Map<number, string[]>();
      for (const [label, bar] of firstTouch) {
        const arr = byCandleTs.get(bar.timestamp) ?? [];
        arr.push(label);
        byCandleTs.set(bar.timestamp, arr);
      }

      // Levels not yet touched at all remain unresolved for smaller TFs.
      const stillUnresolved = new Map<string, number>();
      for (const [label, level] of unresolved) {
        if (!firstTouch.has(label)) stillUnresolved.set(label, level);
      }

      // Check for collisions: any candle with 2+ levels touched.
      let collision: { bar: OHLCVBar; labels: string[] } | null = null;
      for (const [, labels] of byCandleTs) {
        if (labels.length >= 2) {
          const firstLabel = labels[0];
          const bar =
            firstLabel === undefined ? undefined : firstTouch.get(firstLabel);
          if (bar !== undefined) {
            collision = { bar, labels };
            break;
          }
        }
      }

      if (collision && ti < descent.length - 1) {
        // Descend into the colliding candle to try to split the levels.
        const subUnresolved = new Map<string, number>();
        for (const label of collision.labels) {
          const columnIndex = unresolved.get(label);
          if (columnIndex !== undefined) {
            subUnresolved.set(label, columnIndex);
          }
        }
        const sub = descend(
          collision.bar,
          timeframeMs(descent[ti]),
          ti + 1,
          subUnresolved,
        );
        if (sub.eventOrder !== UNKNOWN) {
          // Merge sub-result with any non-colliding levels already resolved.
          return mergeOrder(sub, byCandleTs, tf);
        }
        // Sub-descent couldn't resolve the collision; fall through to
        // UNKNOWN below, but first try smaller timeframes for the whole
        // set in case a finer grain resolves everything.
        continue;
      }

      if (collision) {
        // Collision at the smallest available timeframe — unresolved.
        return { eventOrder: UNKNOWN, reconstructingTimeframe: tf };
      }

      // No collision: order levels by their first-touch candle timestamp.
      return orderFromFirstTouch(firstTouch, tf, stillUnresolved, descend);
    }

    // No timeframe could resolve any level.
    return { eventOrder: UNKNOWN, reconstructingTimeframe: null };
  }

  function orderFromFirstTouch(
    firstTouch: Map<string, OHLCVBar>,
    tf: Timeframe,
    stillUnresolved: Map<string, number>,
    descendFn: (
      bar: OHLCVBar,
      interval: number,
      tfIndex: number,
      unresolved: Map<string, number>,
    ) => ReconstructionResult,
  ): ReconstructionResult {
    // Sort resolved levels by first-touch timestamp.
    const resolved = Array.from(firstTouch.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    );
    const resolvedOrder = resolved.map(([label]) => label);

    if (stillUnresolved.size === 0) {
      return {
        eventOrder: `${resolvedOrder.join(" before ")}`,
        reconstructingTimeframe: tf,
      };
    }

    // Some levels weren't touched at this timeframe; try smaller TFs for
    // them. If they resolve, append after the resolved ones (they were
    // touched later or not at all within the higher candle).
    const higherIdxLocal = descent.indexOf(tf);
    if (higherIdxLocal < 0 || higherIdxLocal >= descent.length - 1) {
      // No smaller timeframe to descend into; unresolved levels are
      // "not touched within the higher candle" — order is partial.
      return {
        eventOrder: `${resolvedOrder.join(" before ")} (additional levels not touched)`,
        reconstructingTimeframe: tf,
      };
    }
    // Find a candle to descend from for the unresolved levels — use the
    // higher-TF candle itself (they weren't touched at this TF at all).
    const sub = descendFn(
      higherBar,
      higherInterval,
      higherIdxLocal + 1,
      stillUnresolved,
    );
    if (sub.eventOrder !== UNKNOWN && sub.reconstructingTimeframe) {
      return {
        eventOrder: `${resolvedOrder.join(" before ")} before ${sub.eventOrder}`,
        reconstructingTimeframe: sub.reconstructingTimeframe,
      };
    }
    return {
      eventOrder: `${resolvedOrder.join(" before ")} (additional levels unresolved)`,
      reconstructingTimeframe: tf,
    };
  }

  function mergeOrder(
    sub: ReconstructionResult,
    byCandleTs: Map<number, string[]>,
    tf: Timeframe,
  ): ReconstructionResult {
    // Rebuild the full order: non-colliding levels in timestamp order,
    // with the sub-resolved collision order inserted at the collision point.
    const entries: { ts: number; labels: string[] }[] = Array.from(
      byCandleTs.entries(),
    ).map(([ts, labels]) => ({ ts, labels }));
    entries.sort((a, b) => a.ts - b.ts);
    const parts: string[] = [];
    for (const e of entries) {
      if (e.labels.length === 1) {
        parts.push(e.labels[0]);
      } else {
        // This is the collision group; sub.eventOrder holds its resolution.
        parts.push(`(${sub.eventOrder})`);
      }
    }
    return {
      eventOrder: parts.join(" before "),
      reconstructingTimeframe: sub.reconstructingTimeframe ?? tf,
    };
  }

  return descend(higherBar, higherInterval, 0, new Map(levels));
}

/**
 * Build the relevant price levels for a contribution's condition.
 *
 * Parses the condition string produced by detectEvents to extract the
 * threshold value(s) the event refers to, and labels them for ordering.
 * Returns a map from a human label to the numeric level, keyed for the
 * given column. Returns an empty map if no levels can be extracted.
 */
function levelsFromCondition(
  condition: string,
  column: string,
): Map<string, number> {
  const levels = new Map<string, number>();
  // Match trailing numeric threshold, e.g. "close crossed above 142.50".
  const m = condition.match(/(-?\d+(?:\.\d+)?)/);
  if (m) {
    const val = Number(m[1]);
    if (Number.isFinite(val)) {
      const dir = /crossed above|bullish|>/.test(condition)
        ? "upper"
        : /crossed below|bearish|</.test(condition)
          ? "lower"
          : "level";
      levels.set(`${dir} ${column} threshold (${val.toFixed(2)})`, val);
    }
  }
  return levels;
}

/**
 * Run cross-timeframe pattern correlation across the selected datasets.
 *
 * Algorithm:
 *  1. For each selected dataset + selected column, extract a numeric series.
 *  2. Detect threshold-based events on each series.
 *  3. Align datasets by timestamp: for each event in the reference dataset,
 *     find the nearest event in every other dataset within a tolerance
 *     window (derived from the smallest timeframe interval).
 *  4. Where 2+ datasets have coincident events, record a result.
 *  5. Score correlation strength vs. random chance.
 *
 * The function is async and yields to the main thread every ~200 iterations
 * so the tab stays responsive on large datasets.
 *
 * @param onProgress Called with a 0-1 fraction as the run progresses.
 */
export async function runCrossReference(
  datasets: Dataset[],
  config: CrossReferenceConfig,
  onProgress?: (p: number) => void,
): Promise<CrossReferenceResult[]> {
  if (config.datasetIds.length < 2) return [];

  // Filter to selected datasets.
  const selected = datasets.filter((d) => config.datasetIds.includes(d.id));
  if (selected.length < 2) return [];

  const thresholdMultiplier = config.threshold ?? 1;

  // ---- Step 1: extract series for each (dataset, column) pair ----
  const seriesByDataset = new Map<string, ColumnSeries[]>();
  for (const ds of selected) {
    const seriesList: ColumnSeries[] = [];
    for (const col of config.columns) {
      const s = extractSeries(ds, col);
      if (s) seriesList.push(s);
    }
    if (seriesList.length > 0) seriesByDataset.set(ds.id, seriesList);
  }
  if (seriesByDataset.size < 2) return [];

  // ---- Step 2: detect events on each series ----
  const eventsByDataset = new Map<string, DetectedEvent[]>();
  let totalEvents = 0;
  let processed = 0;
  const totalSeries = Array.from(seriesByDataset.values()).reduce(
    (n, arr) => n + arr.length,
    0,
  );
  for (const [dsId, seriesList] of seriesByDataset) {
    const allEvents: DetectedEvent[] = [];
    for (const s of seriesList) {
      const ev = detectEvents(s, thresholdMultiplier);
      allEvents.push(...ev);
      totalEvents += ev.length;
      processed++;
      onProgress?.(Math.min(0.5, (processed / totalSeries) * 0.5));
      if (processed % YIELD_EVERY === 0) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }
    eventsByDataset.set(dsId, allEvents);
  }

  // ---- Step 3: compute tolerance window from the smallest timeframe ----
  // The tolerance is half the smallest bar interval, so events on different
  // timeframes count as coincident if they fall within the same low-TF bar.
  const intervals = selected.map((d) => timeframeMs(d.timeframe));
  const minInterval = Math.min(...intervals.filter((x) => x > 0));
  const toleranceMs = minInterval > 0 ? minInterval / 2 : 60_000;

  // ---- Step 4: find coincidences ----
  const coincidences = findCoincidences(
    seriesByDataset,
    eventsByDataset,
    toleranceMs,
  );

  // ---- Step 5: score + build results ----
  const totalDatasets = seriesByDataset.size;
  // Pre-index bars by timestamp per dataset for O(1) higher-bar lookup
  // during intrabar reconstruction.
  const barsByDatasetAndTs = new Map<string, Map<number, OHLCVBar>>();
  for (const ds of selected) {
    const m = new Map<number, OHLCVBar>();
    for (const b of ds.bars) m.set(b.timestamp, b);
    barsByDatasetAndTs.set(ds.id, m);
  }
  // Determine the largest timeframe among selected datasets — its candle
  // is the "higher-TF candle" each coincidence is reconstructed inside.
  let higherTimeframe: Timeframe = "unknown";
  let higherInterval = 0;
  for (const ds of selected) {
    const iv = timeframeMs(ds.timeframe);
    if (iv > higherInterval) {
      higherInterval = iv;
      higherTimeframe = ds.timeframe;
    }
  }

  const results: CrossReferenceResult[] = [];
  for (let i = 0; i < coincidences.length; i++) {
    const c = coincidences[i];
    const strength = scoreCorrelation(
      c,
      toleranceMs,
      totalDatasets,
      totalEvents,
    );
    // Only keep results above a minimal floor so the table isn't noise.
    if (strength < 0.1) continue;

    // Find the higher-TF candle that contains this coincidence. Use the
    // reference event's bar if it belongs to the largest-timeframe dataset;
    // otherwise look up the bar on the largest-TF dataset whose timestamp
    // is the largest <= the coincidence timestamp.
    let higherBar: OHLCVBar | null = null;
    const refEvent = c.events[0];
    const refBar =
      barsByDatasetAndTs.get(refEvent.datasetId)?.get(refEvent.timestamp) ??
      null;
    if (
      refBar &&
      timeframeMs(
        selected.find((d) => d.id === refEvent.datasetId)?.timeframe ??
          "unknown",
      ) === higherInterval
    ) {
      higherBar = refBar;
    } else {
      // Find the largest-TF dataset and locate its bar covering this ts.
      const higherDs = selected.find(
        (d) => timeframeMs(d.timeframe) === higherInterval,
      );
      if (higherDs) {
        const bars = higherDs.bars;
        // Binary search for the last bar with timestamp <= coincidence ts.
        let lo = 0;
        let hi = bars.length - 1;
        let candidate = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (bars[mid].timestamp <= c.timestamp) {
            candidate = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        if (candidate >= 0) {
          const bar = bars[candidate];
          // Confirm the coincidence ts falls within [open, close).
          if (
            c.timestamp >= bar.timestamp &&
            c.timestamp < bar.timestamp + higherInterval
          ) {
            higherBar = bar;
          }
        }
      }
    }

    const contributions = buildContributions(
      c.events,
      higherBar && higherInterval > 0
        ? {
            higherBar,
            higherInterval,
            higherTimeframe,
            datasets: selected,
          }
        : undefined,
    );
    results.push({
      id: `xr_${i}`,
      timestamp: c.timestamp,
      contributingDatasets: contributions,
      correlationStrength: strength,
      confidence: confidenceBand(strength),
      description: describeCoincidence(c.timestamp, c.events),
    });
    onProgress?.(0.5 + (i / Math.max(1, coincidences.length)) * 0.5);
    if (i % YIELD_EVERY === 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  // Sort by strength descending.
  results.sort((a, b) => b.correlationStrength - a.correlationStrength);

  onProgress?.(1);
  return results;
}

/** Convert a Timeframe string to its bar interval in milliseconds. */
function timeframeMs(tf: Dataset["timeframe"]): number {
  switch (tf) {
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
      return 0;
  }
}
