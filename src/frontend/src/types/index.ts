// Core domain types for the Trading Discovery Engine.
// All computation is client-side; these types are the shared contract
// between the engine libs, the zustand store, and the UI.

export type Timeframe =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1d"
  | "1w"
  | "unknown";

export interface OHLCVBar {
  timestamp: number; // unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DateRange {
  start: number; // unix ms
  end: number; // unix ms
}

export type ColumnType = "time" | "ohlcv" | "numeric" | "unknown";
export type ColumnSemantic =
  | "price-level"
  | "binary-event"
  | "oscillator"
  | "cumulative"
  | "percentage"
  | "generic";

/**
 * A detected column in an uploaded dataset.
 * - `key` is the normalized internal key (lowercase, spaces/special chars → `_`).
 * - `label` is the original header string verbatim (spaces/special chars preserved).
 * - `type` classifies the column for downstream consumers.
 */
export interface ColumnDef {
  key: string;
  label: string;
  type: ColumnType;
  /** Inferred meaning used to transform imported values into stationary features. */
  semantic?: ColumnSemantic;
}

export interface Dataset {
  /** Stable internal id used by the dataset list / active selection. */
  id: string;
  name: string;
  /** User-facing label; defaults to the filename. Editable inline. */
  label?: string;
  /** Raw header names in original order (spaces/special chars preserved). */
  originalColumns: string[];
  /** Detected columns with normalized keys + original labels + types. */
  columns: ColumnDef[];
  bars: OHLCVBar[];
  /**
   * Per-column numeric values keyed by normalized column key, parallel to
   * `bars` by index. Populated for every non-time numeric column (OHLCV and
   * custom indicator columns alike) so downstream consumers — cross-reference,
   * preview — can read custom column values without a richer bar type.
   */
  columnValues?: Record<string, number[]>;
  timeframe: Timeframe;
  /** Median row interval; canonical hierarchy uses this rather than filename guesses. */
  intervalMs: number;
  /** Normalized instrument/source identity inferred from the filename. */
  instrumentKey: string;
  /** True only when open, high, low, and close were actually uploaded. */
  hasOHLC: boolean;
  /** True only when volume was actually uploaded. */
  hasVolume: boolean;
  /** Field whose future movement is evaluated for this dataset. */
  outcomeColumnKey: string;
  outcomeLabel: string;
  dateRange: DateRange;
  rowCount: number;
}

/**
 * Feature category. A free-form string so categories can grow dynamically
 * from generated features (e.g. uploaded-column-derived categories beyond
 * the built-in set). Use `BUILTIN_CATEGORIES` for the 11 built-in names.
 */
export type FeatureCategory = string;

/**
 * The 11 built-in feature categories. Kept as both a literal union (for
 * type-narrowing and exhaustiveness checks) and a readonly array (for
 * default config and UI iteration). Custom/uploaded-column-derived features
 * may introduce categories outside this set.
 */
export const BUILTIN_CATEGORIES = [
  "Candle Structure",
  "Market Structure",
  "Sequences",
  "VWAP",
  "Time",
  "Calendar",
  "Volume",
  "Volatility",
  "Location",
  "Levels & Sessions",
  "Gap",
  "Opening Range",
  "Bollinger",
  "Trend",
  "Imported Signals",
  "Multi-Timeframe",
] as const;

export type BuiltinCategory = (typeof BUILTIN_CATEGORIES)[number];

export type FeatureType = "categorical" | "numeric";

export interface Feature {
  id: string;
  name: string;
  category: FeatureCategory;
  description: string; // plain-English, non-developer friendly
  type: FeatureType;
  enabled: boolean;
  /** For categorical features: the ordered list of bucket labels. */
  buckets?: string[];
  /** For numeric features: optional [min, max] hint for UI sliders. */
  range?: [number, number];
  /** Exact formula string for glossary display (e.g. "RSI(14) > 70"). */
  formula?: string;
  /** Whether this feature is built-in or derived from an uploaded column. */
  source?: "builtin" | "custom";
  /** Meaning of an imported value after semantic inference. */
  semantic?: ColumnSemantic | "derived" | "multi-timeframe";
  /** Dataset/timeframe supplying an aligned context feature. */
  originDatasetId?: string;
  originTimeframe?: Timeframe;
}

/** A single computed value for one bar / one feature. */
export interface FeatureValue {
  barIndex: number;
  featureId: string;
  /** Present for numeric features. */
  value?: number;
  /** Present for categorical features. */
  bucketLabel?: string;
}

/** A feature-value matrix indexed [barIndex][featureId] for fast lookup. */
export type FeatureMatrix = Record<string, (number | string | undefined)[]>;

export type Operator =
  | "eq" // equals (categorical)
  | "neq" // not equals (categorical)
  | "gt" // greater than (numeric)
  | "gte"
  | "lt"
  | "lte"
  | "between"; // numeric range [low, high]

export interface Condition {
  featureId: string;
  operator: Operator;
  /** Numeric comparison value(s). */
  value?: number;
  highValue?: number; // for "between"
  /** Categorical bucket label. */
  bucketLabel?: string;
}

export type Direction = "bullish" | "bearish" | "neutral";

export type Confidence = "low" | "moderate" | "high" | "very high";

export interface Pattern {
  id: string;
  /** Dataset whose future bars supplied this pattern's outcomes. */
  targetDatasetId?: string;
  targetDatasetLabel?: string;
  targetTimeframe?: Timeframe;
  conditions: Condition[];
  /** Human-readable summary, e.g. "When RVOL is High AND time is 9:30-10:00". */
  label: string;
  direction: Direction;
  winRate: number; // 0-100
  /** Unconditional directional win rate for the same hold window. */
  baselineWinRate?: number;
  /** Pattern win rate minus baselineWinRate, in percentage points. */
  liftVsBaseline?: number;
  /** Automatic out-of-sample audit status for top-ranked candidates. */
  validationStatus?: "held" | "degraded" | "not-tested";
  avgMove: number; // average forward return in percent
  avgMAE: number; // average max adverse excursion in percent
  avgMFE: number; // average max favorable excursion in percent
  sampleSize: number;
  confidence: Confidence;
  /** Composite ranking score (higher = stronger). */
  score: number;
  /** Forward horizon in bars used to measure outcome. */
  horizon: number;
  /** MFE:MAE ratio (avgMFE / avgMAE), guarded against zero MAE. */
  mfeMaeRatio?: number;
  /** Full sentence rendering of the conditions, e.g. "When RVOL is High and the time is between 9:30 and 10:00, price tends to move up." */
  plainEnglishSentence?: string;
  /** Coverage analysis across the examined history. */
  coverage?: PatternCoverage;
}

/**
 * Coverage analysis for a pattern: how broadly it is validated across the
 * examined history, plus concentration flags that warn when a pattern is
 * driven by a narrow slice of the data rather than a robust, recurring edge.
 */
export interface PatternCoverage {
  earliestTimestamp: number;
  latestTimestamp: number;
  totalBarsExamined: number;
  totalOccurrences: number;
  /** Occurrence counts keyed by symbol (dataset label). */
  occurrencesPerSymbol: Record<string, number>;
  /** Occurrence counts keyed by timeframe. */
  occurrencesPerTimeframe: Record<string, number>;
  /** Occurrence counts bucketed by period (e.g. year, month). */
  occurrencesByPeriod: { period: string; count: number }[];
  firstOccurrence: number;
  mostRecentOccurrence: number;
  /** 0-100 — share of the examined history that contains at least one occurrence. */
  percentOfHistoryContainingOccurrences: number;
  /** True when performance is stable across the examined span (no regime drift). */
  performanceConsistentAcrossSpan: boolean;
  /**
   * Warnings that the pattern may be narrow rather than broadly validated.
   * Possible values include: "symbol-specific", "timeframe-specific",
   * "session-specific", "concentrated-in-short-period", "few-occurrences".
   */
  concentrationFlags: string[];
  /** True when the pattern is broadly validated across symbols/timeframes/periods. */
  isBroadlyValidated: boolean;
  /** Pooled metrics across all occurrences. */
  pooledResult: { winRate: number; avgMove: number; sampleSize: number };
  /** Equal-weighted per-symbol metrics (each symbol weighted equally regardless of occurrence count). */
  equalSymbolResult: { winRate: number; avgMove: number; sampleSize: number };
}

export interface PatternMetrics {
  winRate: number;
  avgMove: number;
  avgMAE: number;
  avgMFE: number;
  sampleSize: number;
  direction: Direction;
}

export interface ConditionBreakdown {
  condition: Condition;
  inSample: PatternMetrics;
  outOfSample: PatternMetrics;
}

export interface ValidationResult {
  patternId: string;
  patternLabel: string;
  inSampleMetrics: PatternMetrics;
  outOfSampleMetrics: PatternMetrics;
  /** True if out-of-sample win rate drops >10pp or OOS sample too small. */
  degraded: boolean;
  degradationNote: string;
  /** Bull vs bear market condition split. */
  byMarketCondition: {
    bull: PatternMetrics;
    bear: PatternMetrics;
  };
  /** Per-year breakdown (year -> metrics). */
  byYear: { year: number; metrics: PatternMetrics }[];
  conditionBreakdowns: ConditionBreakdown[];
  /**
   * MFE/MAE ratio recomputed with direction adjustment so the ratio is
   * meaningful for bearish patterns (where favorable excursion is downward).
   * Populated for every validated pattern. Falls back to the pattern's raw
   * `mfeMaeRatio` when not recomputed. `null` when the ratio cannot be
   * computed (e.g. zero MAE and zero MFE).
   */
  directionAdjustedMfeMaeRatio: number | null;
  /**
   * Fraction of symbols/datasets the pattern remains profitable on
   * (0-1). Populated for every validated pattern; 1.0 when only a single
   * dataset was used. `null` when no datasets were available to evaluate.
   */
  crossSymbolSurvival: number | null;
}

export interface DiscoveryConfig {
  maxDepth: number; // 2-6
  minSampleSize: number;
  minWinRate: number; // 0-100
  enabledCategories: FeatureCategory[];
  /** Forward horizon in bars for outcome measurement. */
  horizon: number;
  /** Cap on total combinations tested. */
  maxCombinations: number;
  /** Forward window length (in bars) used for the MFE/MAE proxy. */
  mfeMaeWindow: number;
  /** Minimum MFE/MAE ratio for a pattern to be considered favorable. */
  minMfeMaeRatio: number;
  /**
   * Legacy boolean toggle for the MFE/MAE ratio filter. Kept for backward
   * compatibility with persisted runs and the simplified backend
   * DiscoveryConfig shape. New code should read `mfeMaeRatioMode` instead;
   * when `mfeMaeRatioMode` is set it takes precedence.
   */
  mfeMaeRatioEnabled: boolean;
  /**
   * MFE/MAE ratio filter mode.
   * - "off"      → no ratio filter (overrides mfeMaeRatioEnabled).
   * - "positive" → keep only patterns whose direction-adjusted MFE/MAE
   *                ratio is greater than `minMfeMaeRatio`.
   * - "auto"     → grid-search the ratio threshold across a viable range
   *                and select the best setting (mirrors the Max Data probe).
   * When omitted, behavior falls back to the legacy mfeMaeRatioEnabled flag
   * (true → "positive"-style threshold, false → "off").
   */
  mfeMaeRatioMode?: "off" | "positive" | "auto";
  /**
   * When true, grid-search the hold-window (outcome horizon) length across a
   * viable range and select the value yielding the best pattern-quality
   * outcome, mirroring the Max Data probe. When false, use the manual
   * `horizon` value.
   */
  holdWindowAutoFind?: boolean;
}

export interface DiscoveryProgress {
  total: number;
  tested: number;
  current: string; // human-readable description of current combination
  isRunning: boolean;
  estimatedRemainingMs: number;
}

export type TabId =
  | "features"
  | "discovery"
  | "validation"
  | "crossReference"
  | "report"
  | "savedRuns";

// ---- Cross-reference (multi-timeframe correlation) types ----

/**
 * One dataset's contribution to a single cross-reference coincidence.
 * `column` is the original header name (spaces/special chars preserved).
 *
 * Intrabar event-order reconstruction fields (`eventOrder` and
 * `reconstructingTimeframe`) are populated when the engine descends into
 * lower-timeframe candles contained inside the higher-TF candle to resolve
 * the chronological order in which the relevant price levels were touched.
 * They are `undefined` when intrabar reconstruction is not applicable
 * (e.g. no smaller synchronized timeframe is available).
 */
export interface CrossReferenceContribution {
  datasetId: string;
  datasetLabel: string;
  /** Original column name (preserved verbatim). */
  column: string;
  /** The column value at the aligned timestamp. */
  value: number;
  /** Plain-English description of the detected condition. */
  condition: string;
  /**
   * Resolved chronological order of the price levels touched within the
   * higher-TF candle, as determined by descending through contained
   * lower-timeframe candles. Examples:
   *   - "upper band touched before lower band"
   *   - "low before high before close"
   * Set to the literal string "order unknown at available resolution" when
   * two or more relevant levels are touched within the same candle on the
   * smallest available timeframe and their relative order cannot be
   * determined. Undefined when intrabar reconstruction was not performed.
   */
  eventOrder?: string;
  /**
   * Label of the smallest Timeframe used to resolve `eventOrder`
   * (e.g. "5m", "1m"). Null/undefined when not applicable.
   */
  reconstructingTimeframe?: Timeframe | null;
}

/**
 * A single coincident condition across two or more datasets, aligned by
 * timestamp. The engine surfaces moments where threshold-based events on
 * different timeframes line up.
 */
export interface CrossReferenceResult {
  id: string;
  /** Aligned reference timestamp (unix ms). */
  timestamp: number;
  /** One entry per contributing dataset at this timestamp. */
  contributingDatasets: CrossReferenceContribution[];
  /** 0-1 — how much more often than chance these conditions co-occur. */
  correlationStrength: number;
  /** "High" | "Medium" | "Low" — banded from correlationStrength. */
  confidence: string;
  /** Plain-English summary of the coincidence. */
  description: string;
}

/** Configuration for a cross-reference run. */
export interface CrossReferenceConfig {
  /** Ids of datasets to cross-reference (2+). */
  datasetIds: string[];
  /** Original column names to analyze (intersection across selected datasets). */
  columns: string[];
  /**
   * Optional threshold multiplier for what counts as a "coincident" event.
   * Defaults to 1 standard deviation if omitted.
   */
  threshold?: number;
}

export type CompletedStep =
  | "dataLoaded"
  | "featuresGenerated"
  | "discoveryComplete"
  | "validationComplete"
  | "crossReferenceComplete"
  | "reportReady";

export type CompletedSteps = Set<CompletedStep>;

// ---- Report types ----

export interface ReportSection {
  id: string;
  title: string;
  /** Plain-English paragraphs. */
  paragraphs: string[];
  /** Optional structured rows (e.g. top discoveries table). */
  rows?: {
    label: string;
    columns: string[];
  }[];
}

export interface Report {
  generatedAt: number;
  sections: ReportSection[];
  summary: string;
  datasetName: string;
  topDiscoveries: {
    rank: number;
    label: string;
    direction: Direction;
    winRate: number;
    avgMove: number;
    sampleSize: number;
    confidence: Confidence;
    degraded: boolean;
  }[];
}

export interface SavedRunSummary {
  id: number;
  name: string;
  savedAtNs: number;
  datasetName: string;
  patternCount: number;
  configSummary: string;
}

export interface SavedRun {
  id: number;
  name: string;
  savedAtNs: number;
  config: DiscoveryConfig;
  datasets: Dataset[];
  patterns: Pattern[];
  validation: ValidationResult[];
  report: Report | null;
}
