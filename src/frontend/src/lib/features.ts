import { normalizeHeader } from "@/lib/csvParser";
import type {
  Feature,
  FeatureCategory,
  FeatureMatrix,
  OHLCVBar,
} from "@/types";

// ---------------------------------------------------------------------------
// Feature generation engine.
// Computes hundreds of measurable features from OHLCV bars across 11
// built-in categories. Each feature has a plain-English description for
// non-developers and an exact `formula` string for the glossary. Categorical
// features bucket values; numeric features stay continuous.
//
// Custom uploaded columns (from Dataset.columnValues) are emitted as their
// own features with source: "custom", a "Custom Columns" category, and a
// formula referencing the raw column name — so feature categories grow
// dynamically with uploaded data.
// ---------------------------------------------------------------------------

const TIME_BUCKETS = [
  "9:30-10:00",
  "10:00-10:30",
  "10:30-11:00",
  "11:00-11:30",
  "11:30-12:00",
  "12:00-12:30",
  "12:30-13:00",
  "13:00-13:30",
  "13:30-14:00",
  "14:00-14:30",
  "14:30-15:00",
  "15:00-15:30",
  "15:30-16:00",
];

// Session open/close in local wall-clock hours (ET-ish). Kept in sync with
// sampleData.ts so feature buckets align with the generated sessions.
const SESSION_OPEN_HOUR = 9;
const SESSION_OPEN_MIN = 30;

const SESSION_PHASE_BUCKETS = [
  "Open",
  "Morning",
  "Lunch",
  "Afternoon",
  "Close",
];
const WEEKDAY_BUCKETS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MONTH_BUCKETS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const RVOL_BUCKETS = ["Low", "Normal", "High", "Extreme"];
const VOL_SPIKE_BUCKETS = ["None", "Mild", "Strong"];
const GAP_DIR_BUCKETS = ["Up", "Flat", "Down"];
const OR_BREAKOUT_BUCKETS = ["None", "Up", "Down", "Both"];
const TREND_STRENGTH_BUCKETS = ["Choppy", "Weak", "Moderate", "Strong"];
const BB_LOCATION_BUCKETS = [
  "Below Lower",
  "Lower Half",
  "Upper Half",
  "Above Upper",
];
const CONSEC_DIR_BUCKETS = ["Down x3+", "Down", "Neutral", "Up", "Up x3+"];

/** Category used for features derived from uploaded custom columns. */
export const CUSTOM_COLUMNS_CATEGORY = "Imported Signals";

function f(
  id: string,
  name: string,
  category: FeatureCategory,
  description: string,
  type: "categorical" | "numeric",
  formula: string,
  extra: Partial<Feature> = {},
): Feature {
  return {
    id,
    name,
    category,
    description,
    type,
    enabled: true,
    source: "builtin",
    formula,
    ...extra,
  };
}

/**
 * Description of a custom uploaded column, used to emit Feature entries with
 * source: "custom". `label` is the original header (preserved verbatim);
 * `key` is the normalized key matching Dataset.columnValues.
 */
export interface CustomColumn {
  label: string;
  key: string;
}

/**
 * Manual per-feature override for numeric feature bucketing.
 *
 * By default, numeric features use empirical quantile bucketing (the
 * discovery engine derives thresholds from the observed distribution). A manual
 * override lets the user specify custom threshold values or explicit
 * bucket boundaries for a single feature, replacing the auto-quartile
 * candidates for that feature only. Features without an override keep the
 * empirical-quantile default.
 *
 * Overrides apply during feature catalog generation (so the glossary and UI
 * reflect the user's custom boundaries) and during discovery candidate
 * generation (so the tested conditions use the user's boundaries).
 */
export interface FeatureOverride {
  /** Feature id this override applies to. */
  featureId: string;
  /**
   * Custom threshold values for `lt`/`gt` candidate conditions. Each
   * threshold generates both a `lt` and a `gt` candidate. When provided,
   * these replace the empirical thresholds for this feature.
   */
  thresholds?: number[];
  /**
   * Custom bucket boundaries for `between` candidate conditions. Each
   * pair generates a `between` candidate. When provided, these replace
   * the empirical quantile bucketing for this feature.
   */
  ranges?: Array<{ low: number; high: number }>;
  /**
   * Optional custom [min, max] range hint. When provided, overrides the
   * feature's declared range for threshold generation and UI sliders, and
   * is stamped onto the feature catalog so the glossary reflects it.
   */
  range?: [number, number];
}

/**
 * Map of per-feature manual overrides, keyed by feature id. Features not
 * present in this map use empirical quantile bucketing (the default).
 */
export type FeatureOverrides = Record<string, FeatureOverride>;

/**
 * Build the catalog of available features (does not compute values).
 *
 * `customColumns` (optional) lists uploaded non-OHLCV numeric columns; each
 * becomes a numeric Feature with source: "custom", category
 * "Custom Columns", and a formula referencing the raw column name. This
 * makes feature categories grow dynamically with uploaded data.
 *
 * `overrides` (optional) is a map of per-feature manual range/threshold
 * overrides keyed by feature id. For each overridden numeric feature, the
 * feature's declared `range` is replaced with the override's `range` (when
 * provided) so the catalog and UI reflect the user's custom boundaries.
 * Auto-quartile bucketing remains the default for features without an
 * override; the override only affects features the user explicitly edits.
 * The override's `thresholds`/`ranges` are consumed by the discovery
 * engine's candidate generator (see `generateCandidates` in discovery.ts).
 */
export function generateFeatures(
  _bars: OHLCVBar[],
  customColumns: CustomColumn[] = [],
  overrides: FeatureOverrides = {},
): Feature[] {
  const features: Feature[] = [
    // ---- Candle Structure ----
    f(
      "candle_upper_wick_pct",
      "Upper Wick %",
      "Candle Structure",
      "How much of the bar's range sat above the close, as a percentage of total range.",
      "numeric",
      "Upper Wick % = (high - max(open, close)) / (high - low) * 100",
      { range: [0, 100] },
    ),
    f(
      "candle_lower_wick_pct",
      "Lower Wick %",
      "Candle Structure",
      "How much of the bar's range sat below the close, as a percentage of total range.",
      "numeric",
      "Lower Wick % = (min(open, close) - low) / (high - low) * 100",
      { range: [0, 100] },
    ),
    f(
      "candle_body_pct",
      "Body %",
      "Candle Structure",
      "Absolute body size as a percentage of the bar's total range.",
      "numeric",
      "Body % = |close - open| / (high - low) * 100",
      { range: [0, 100] },
    ),
    f(
      "candle_body_size",
      "Body Size",
      "Candle Structure",
      "Absolute body size (close minus open) in price units.",
      "numeric",
      "Body Size = |close - open|",
    ),
    f(
      "candle_range",
      "Bar Range",
      "Candle Structure",
      "Total high-to-low range of the bar in price units.",
      "numeric",
      "Bar Range = high - low",
    ),
    f(
      "candle_direction",
      "Candle Direction",
      "Candle Structure",
      "Whether the bar closed higher or lower than it opened.",
      "categorical",
      "Candle Direction = 'Up' if close > open, 'Down' if close < open, 'Doji' if |close - open| < 5% of range",
      { buckets: ["Up", "Down", "Doji"] },
    ),

    // ---- Market Structure ----
    f(
      "pivot_event",
      "Confirmed Pivot Event",
      "Market Structure",
      "A causally confirmed swing high or swing low. The event is recorded only after two later bars confirm it.",
      "categorical",
      "Pivot at t-2 is confirmed at t when its high/low exceeds the two bars on either side",
      { buckets: ["None", "Swing High", "Swing Low", "Both"] },
    ),
    f(
      "swing_sequence",
      "Swing Sequence",
      "Market Structure",
      "Whether the latest confirmed swing is a higher high, lower high, higher low, or lower low.",
      "categorical",
      "Latest confirmed swing compared with the previous confirmed swing of the same type",
      { buckets: ["None", "HH", "LH", "HL", "LL"] },
    ),
    f(
      "structure_state",
      "Market Structure State",
      "Market Structure",
      "Persistent structure inferred from the latest confirmed high and low sequence.",
      "categorical",
      "Bullish for HH+HL, Bearish for LH+LL, otherwise Range / Transition",
      { buckets: ["Bullish", "Bearish", "Range / Transition"] },
    ),
    f(
      "break_of_structure",
      "Break of Structure",
      "Market Structure",
      "Whether the close broke the latest confirmed swing high or swing low.",
      "categorical",
      "Bullish BOS when close crosses above last confirmed swing high; Bearish BOS below last confirmed swing low",
      { buckets: ["None", "Bullish BOS", "Bearish BOS"] },
    ),
    f(
      "liquidity_sweep",
      "Liquidity Sweep",
      "Market Structure",
      "Whether price traded through a confirmed swing level but closed back on the original side.",
      "categorical",
      "High sweep when high > prior swing high and close < it; low sweep when low < prior swing low and close > it",
      { buckets: ["None", "Swept High", "Swept Low"] },
    ),

    // ---- VWAP ----
    f(
      "vwap_distance_pct",
      "Distance from VWAP %",
      "VWAP",
      "How far the close is from the session volume-weighted average price, in percent.",
      "numeric",
      "Distance from VWAP % = (close - VWAP) / VWAP * 100, where VWAP = cumulative(typical_price * volume) / cumulative(volume) and typical_price = (high + low + close) / 3",
      { range: [-5, 5] },
    ),
    f(
      "vwap_side",
      "Above/Below VWAP",
      "VWAP",
      "Whether the close is above or below the session VWAP.",
      "categorical",
      "Above/Below VWAP = 'Above' if close >= VWAP else 'Below', where VWAP = cumulative(typical_price * volume) / cumulative(volume)",
      { buckets: ["Above", "Below"] },
    ),

    // ---- Time ----
    f(
      "time_of_day",
      "Time of Day",
      "Time",
      "Which 30-minute window of the trading session the bar falls in.",
      "categorical",
      "Time of Day = 30-minute bucket of the bar timestamp measured from the 9:30 session open (e.g. '9:30-10:00')",
      { buckets: TIME_BUCKETS },
    ),
    f(
      "session_phase",
      "Session Phase",
      "Time",
      "Broad phase of the session: open, morning, lunch, afternoon, or close.",
      "categorical",
      "Session Phase = 'Open' (<10:00), 'Morning' (<11:30), 'Lunch' (<13:00), 'Afternoon' (<15:00), or 'Close' (>=15:00) based on bar timestamp",
      { buckets: SESSION_PHASE_BUCKETS },
    ),

    // ---- Calendar ----
    f(
      "weekday",
      "Day of Week",
      "Calendar",
      "Which weekday the bar falls on (Mon-Fri).",
      "categorical",
      "Day of Week = weekday name (Mon-Fri) of the bar timestamp",
      { buckets: WEEKDAY_BUCKETS },
    ),
    f(
      "month",
      "Month",
      "Calendar",
      "Which calendar month the bar falls in.",
      "categorical",
      "Month = calendar month name (Jan-Dec) of the bar timestamp",
      { buckets: MONTH_BUCKETS },
    ),

    // ---- Volume ----
    f(
      "rvol_bucket",
      "Relative Volume (RVOL)",
      "Volume",
      "Current bar volume vs the recent average, bucketed from Low to Extreme.",
      "categorical",
      "RVOL = bar_volume / SMA(volume, 20); bucketed 'Low' (<0.5), 'Normal' (0.5-1.5), 'High' (1.5-3), 'Extreme' (>3)",
      { buckets: RVOL_BUCKETS },
    ),
    f(
      "volume_spike",
      "Volume Spike",
      "Volume",
      "Whether volume spiked sharply vs the recent average.",
      "categorical",
      "Volume Spike = RVOL bucketed 'None' (<1.5), 'Mild' (1.5-2.5), 'Strong' (>2.5)",
      { buckets: VOL_SPIKE_BUCKETS },
    ),

    // ---- Volatility ----
    f(
      "atr_percentile",
      "ATR Percentile",
      "Volatility",
      "Where the 14-bar average true range sits relative to its own recent history (0-100).",
      "numeric",
      "ATR Percentile = percentile rank of ATR(14) within its own rolling history, where ATR = SMA(True Range, 14) and True Range = max(high-low, |high - prev_close|, |low - prev_close|)",
      { range: [0, 100] },
    ),
    f(
      "range_percentile",
      "Bar Range Percentile",
      "Volatility",
      "Where this bar's range sits relative to recent bar ranges (0-100).",
      "numeric",
      "Bar Range Percentile = percentile rank of (high - low) within the prior 20 bar ranges",
      { range: [0, 100] },
    ),

    // ---- Location ----
    f(
      "prev_day_location",
      "Prev Day Location",
      "Location",
      "Where the close sits within the previous day's high-low range (0 = at low, 100 = at high).",
      "numeric",
      "Prev Day Location = (close - prev_day_low) / (prev_day_high - prev_day_low) * 100",
      { range: [0, 100] },
    ),
    f(
      "prev_hour_location",
      "Prev Hour Location",
      "Location",
      "Where the close sits within the previous hour's high-low range (0-100).",
      "numeric",
      "Prev Hour Location = (close - prior_60m_low) / (prior_60m_high - prior_60m_low) * 100 using timestamps",
      { range: [0, 100] },
    ),

    // ---- Levels & Sessions ----
    f(
      "prev_day_level_state",
      "Previous Day Level State",
      "Levels & Sessions",
      "Whether price is above the prior-day high, inside its range, or below the prior-day low.",
      "categorical",
      "close compared with previous session high and low",
      { buckets: ["Above PDH", "Inside Previous Day", "Below PDL"] },
    ),
    f(
      "prev_day_level_event",
      "Previous Day Level Event",
      "Levels & Sessions",
      "Break, reclaim, rejection, or sweep behavior around previous-day high and low.",
      "categorical",
      "Current OHLC relationship to previous-day high/low and the prior close",
      {
        buckets: [
          "None",
          "Broke PDH",
          "Broke PDL",
          "Reclaimed PDH",
          "Reclaimed PDL",
          "Swept PDH",
          "Swept PDL",
        ],
      },
    ),
    f(
      "distance_to_pdh_atr",
      "Distance to Previous Day High (ATR)",
      "Levels & Sessions",
      "Distance from close to the previous-day high in ATR units.",
      "numeric",
      "(close - previous_day_high) / ATR(14)",
    ),
    f(
      "distance_to_pdl_atr",
      "Distance to Previous Day Low (ATR)",
      "Levels & Sessions",
      "Distance from close to the previous-day low in ATR units.",
      "numeric",
      "(close - previous_day_low) / ATR(14)",
    ),
    f(
      "box_position",
      "Rolling Box Position",
      "Levels & Sessions",
      "Where close sits within the prior 20-bar high-low box.",
      "numeric",
      "(close - prior_20_bar_low) / (prior_20_bar_high - prior_20_bar_low) * 100",
      { range: [0, 100] },
    ),
    f(
      "box_event",
      "Rolling Box Event",
      "Levels & Sessions",
      "Breakout, failed breakout, or inside state relative to the prior 20-bar box.",
      "categorical",
      "Current OHLC and close compared with the prior 20-bar high-low box",
      {
        buckets: [
          "Inside Box",
          "Breakout Up",
          "Breakout Down",
          "Failed Breakout Up",
          "Failed Breakout Down",
        ],
      },
    ),

    // ---- Gap ----
    f(
      "gap_size_pct",
      "Gap Size %",
      "Gap",
      "Overnight gap from previous close to current open, in percent.",
      "numeric",
      "Gap Size % = (open - prev_close) / prev_close * 100",
      { range: [-5, 5] },
    ),
    f(
      "gap_direction",
      "Gap Direction",
      "Gap",
      "Whether the session opened up, down, or flat vs the prior close.",
      "categorical",
      "Gap Direction = 'Up' if Gap Size % > 0.05, 'Down' if < -0.05, else 'Flat'",
      { buckets: GAP_DIR_BUCKETS },
    ),

    // ---- Opening Range ----
    f(
      "or_size_pct",
      "Opening Range Size %",
      "Opening Range",
      "Size of the first 30-minute opening range as a percent of price.",
      "numeric",
      "Opening Range Size % = (OR_high - OR_low) / close * 100, where OR uses the first 30 elapsed minutes of the session",
      { range: [0, 5] },
    ),
    f(
      "or_breakout",
      "Opening Range Breakout",
      "Opening Range",
      "Whether price has broken out of the opening range, and in which direction.",
      "categorical",
      "Opening Range Breakout = 'Up' if high > OR_high, 'Down' if low < OR_low, 'Both' if both, else 'None'",
      { buckets: OR_BREAKOUT_BUCKETS },
    ),

    // ---- Bollinger ----
    f(
      "bb_location",
      "Bollinger Band Location",
      "Bollinger",
      "Where the close sits relative to the 20-period Bollinger Bands.",
      "categorical",
      "Bollinger Band Location = band position of close vs SMA(20) +/- 2*stdev(20): 'Above Upper', 'Upper Half', 'Lower Half', 'Below Lower'",
      { buckets: BB_LOCATION_BUCKETS },
    ),
    f(
      "bb_bandwidth",
      "Bollinger Bandwidth",
      "Bollinger",
      "Width of the Bollinger Bands as a percent of the middle band (volatility expansion).",
      "numeric",
      "Bollinger Bandwidth = (upper_band - lower_band) / SMA(20) * 100, where bands = SMA(20) +/- 2*stdev(close, 20)",
      { range: [0, 20] },
    ),
    f(
      "bb_percent_b",
      "Bollinger %B",
      "Bollinger",
      "Price position inside or outside the bands on a relative scale (0 = lower band, 100 = upper band).",
      "numeric",
      "(close - lower_band) / (upper_band - lower_band) * 100",
    ),
    f(
      "bb_bandwidth_percentile",
      "Bollinger Bandwidth Percentile",
      "Bollinger",
      "Where current bandwidth ranks within its own recent history.",
      "numeric",
      "Rolling percentile of Bollinger Bandwidth over 100 observations",
      { range: [0, 100] },
    ),
    f(
      "bb_regime",
      "Bollinger Regime",
      "Bollinger",
      "Whether the bands are compressed, normal, or expanding relative to recent history.",
      "categorical",
      "Squeeze below bandwidth p20, Expansion above p80, otherwise Normal",
      { buckets: ["Squeeze", "Normal", "Expansion"] },
    ),

    // ---- Trend ----
    f(
      "trend_strength",
      "Trend Strength",
      "Trend",
      "Strength of the recent trend, bucketed from Choppy to Strong.",
      "categorical",
      "Trend Strength = |slope(20)| / ATR(14) bucketed 'Choppy' (<0.05), 'Weak' (<0.12), 'Moderate' (<0.2), 'Strong' (>=0.2)",
      { buckets: TREND_STRENGTH_BUCKETS },
    ),
    f(
      "trend_slope",
      "Trend Slope",
      "Trend",
      "Slope of the 20-period linear regression of closes, in price units per bar.",
      "numeric",
      "Trend Slope = least-squares slope of close over the prior 20 bars (price units per bar)",
    ),
    f(
      "consecutive_direction",
      "Consecutive Direction",
      "Trend",
      "How many bars in a row have closed in the same direction.",
      "categorical",
      "Consecutive Direction = count of consecutive same-direction closes bucketed 'Up'/'Up x3+' (>=3) or 'Down'/'Down x3+' (>=3), 'Neutral' if count == 1",
      { buckets: CONSEC_DIR_BUCKETS },
    ),

    // ---- Sequences ----
    f(
      "structure_event_sequence",
      "Recent Structure Sequence",
      "Sequences",
      "The ordered pair of the two most recent confirmed structural events.",
      "categorical",
      "previous confirmed HH/LH/HL/LL event followed by the latest event",
    ),
    f(
      "sweep_reclaim_sequence",
      "Sweep → Reclaim Sequence",
      "Sequences",
      "A previous-day or swing-level sweep followed by a reclaim within five bars.",
      "categorical",
      "Level sweep event followed by a close back through the swept level within five bars",
      { buckets: ["None", "High Sweep → Reclaim", "Low Sweep → Reclaim"] },
    ),
    f(
      "break_retest_sequence",
      "Break → Retest Sequence",
      "Sequences",
      "A box or structure break followed by a retest within five bars.",
      "categorical",
      "Breakout event followed by a return to the broken level within five bars",
      { buckets: ["None", "Bullish Break → Retest", "Bearish Break → Retest"] },
    ),
  ];

  // ---- Custom uploaded columns ----
  // Each uploaded non-OHLCV numeric column becomes its own numeric feature.
  // The feature id is the normalized column key (matching
  // Dataset.columnValues), the name is the original header (preserved
  // verbatim per user preference), and the formula references the raw
  // column name so the glossary explains it is an uploaded column.
  for (const col of customColumns) {
    const id = `custom_${col.key}`;
    features.push({
      id,
      name: col.label,
      category: CUSTOM_COLUMNS_CATEGORY,
      description: `Uploaded column "${col.label}" — values taken directly from the source file.`,
      type: "numeric",
      enabled: true,
      source: "custom",
      formula: `${col.label} = raw column value from the uploaded dataset`,
    });
  }

  // ---- Per-feature manual overrides ----
  // For each overridden numeric feature, stamp the override's `range` onto
  // the catalog entry so the glossary and UI sliders reflect the user's
  // custom boundaries. Auto-quartile remains the default for features
  // without an override; the override's `thresholds`/`ranges` are consumed
  // later by the discovery engine's candidate generator. Only the `range`
  // hint is applied here — the raw feature values are unaffected (numeric
  // features stay continuous; bucketing happens at candidate generation).
  for (const feat of features) {
    const ov = overrides[feat.id];
    if (!ov || feat.type !== "numeric") continue;
    if (ov.range) {
      feat.range = ov.range;
    }
  }

  return features;
}

// ---------------------------------------------------------------------------
// Value computation.
// ---------------------------------------------------------------------------

function percentile(value: number, history: number[]): number {
  if (history.length === 0) return 50;
  let below = 0;
  for (const h of history) if (h < value) below++;
  return (below / history.length) * 100;
}

function sma(values: number[], period: number, idx: number): number | null {
  if (idx < period - 1) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += values[i];
  return sum / period;
}

function stdev(
  values: number[],
  period: number,
  idx: number,
  mean: number,
): number | null {
  if (idx < period - 1) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += (values[i] - mean) ** 2;
  return Math.sqrt(sum / period);
}

function bucketize(value: number, edges: number[], labels: string[]): string {
  for (let i = 0; i < edges.length; i++) {
    if (value <= edges[i]) return labels[i];
  }
  return labels[labels.length - 1];
}

function timeOfDayBucket(ts: number): string {
  const d = new Date(ts);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const sessionStart = SESSION_OPEN_HOUR * 60 + SESSION_OPEN_MIN; // 570
  const offset = minutes - sessionStart;
  if (offset < 0) return TIME_BUCKETS[0];
  const idx = Math.min(TIME_BUCKETS.length - 1, Math.floor(offset / 30));
  return TIME_BUCKETS[idx];
}

function sessionPhaseBucket(ts: number): string {
  const d = new Date(ts);
  const minutes = d.getHours() * 60 + d.getMinutes();
  if (minutes < 10 * 60) return "Open";
  if (minutes < 11 * 60 + 30) return "Morning";
  if (minutes < 13 * 60) return "Lunch";
  if (minutes < 15 * 60) return "Afternoon";
  return "Close";
}

function weekdayBucket(ts: number): string {
  const d = new Date(ts).getDay(); // 0=Sun
  return WEEKDAY_BUCKETS[Math.max(0, d - 1)] ?? "Mon";
}

function monthBucket(ts: number): string {
  return MONTH_BUCKETS[new Date(ts).getMonth()];
}

/**
 * Compute the feature-value matrix: an object keyed by featureId, each
 * containing an array indexed by barIndex. Categorical features store
 * bucket labels (strings); numeric features store numbers. Bars where a
 * feature cannot yet be computed (e.g. needs 20 bars of history) store
 * undefined.
 *
 * Custom-column features (source: "custom") are populated directly from the
 * provided `customColumnValues` map (keyed by normalized column key), so
 * uploaded columns flow into the matrix alongside the built-in features.
 */
export function computeFeatureValues(
  bars: OHLCVBar[],
  features: Feature[],
  customColumnValues: Record<string, number[]> = {},
): FeatureMatrix {
  const matrix: FeatureMatrix = {};
  for (const feat of features) matrix[feat.id] = new Array(bars.length);

  // Pre-compute per-day aggregates for prev-day location & gap.
  const dayIndex = buildDayIndex(bars);
  const dayCloseByBar = new Array<number | null>(bars.length).fill(null);
  const dayHighByBar = new Array<number | null>(bars.length).fill(null);
  const dayLowByBar = new Array<number | null>(bars.length).fill(null);
  for (const day of dayIndex) {
    for (let i = day.start; i <= day.end; i++) {
      dayCloseByBar[i] = day.close;
      dayHighByBar[i] = day.high;
      dayLowByBar[i] = day.low;
    }
  }

  // Rolling volume baseline (20-bar SMA of volume).
  const volBaseline: number[] = new Array(bars.length).fill(0);
  // Rolling ATR (14).
  const tr: number[] = new Array(bars.length).fill(0);
  // Rolling closes for SMA/stdev (Bollinger, trend).
  const closes = bars.map((b) => b.close);

  // Opening range per day, measured by elapsed time rather than a fixed
  // number of bars so 1m/5m/15m/60m files do not describe different periods.
  const OPENING_RANGE_MS = 30 * 60 * 1000;
  const orHighByBar = new Array<number | null>(bars.length).fill(null);
  const orLowByBar = new Array<number | null>(bars.length).fill(null);
  const orSizeByBar = new Array<number | null>(bars.length).fill(null);
  for (const day of dayIndex) {
    const cutoff = bars[day.start].timestamp + OPENING_RANGE_MS;
    let orEnd = day.start;
    while (orEnd + 1 <= day.end && bars[orEnd + 1].timestamp < cutoff) {
      orEnd++;
    }
    let hi = Number.NEGATIVE_INFINITY;
    let lo = Number.POSITIVE_INFINITY;
    for (let i = day.start; i <= orEnd; i++) {
      hi = Math.max(hi, bars[i].high);
      lo = Math.min(lo, bars[i].low);
    }
    for (let i = orEnd + 1; i <= day.end; i++) {
      orHighByBar[i] = hi;
      orLowByBar[i] = lo;
      orSizeByBar[i] = hi - lo;
    }
  }

  // VWAP per day (cumulative within session).
  const vwapByBar = new Array<number | null>(bars.length).fill(null);
  for (const day of dayIndex) {
    let cumPV = 0;
    let cumVol = 0;
    for (let i = day.start; i <= day.end; i++) {
      const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
      cumPV += tp * bars[i].volume;
      cumVol += bars[i].volume;
      vwapByBar[i] = cumVol > 0 ? cumPV / cumVol : tp;
    }
  }

  const HOUR_MS = 60 * 60 * 1000;
  const bandwidthHistory: number[] = [];
  let lastSwingHigh: number | null = null;
  let previousSwingHigh: number | null = null;
  let lastSwingLow: number | null = null;
  let previousSwingLow: number | null = null;
  let lastHighKind: "HH" | "LH" | null = null;
  let lastLowKind: "HL" | "LL" | null = null;
  const structureEvents: string[] = [];
  let recentHighSweep = -100;
  let recentLowSweep = -100;
  let recentBullBreak = -100;
  let recentBearBreak = -100;
  let recentBullBreakLevel: number | null = null;
  let recentBearBreakLevel: number | null = null;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    // ---- Candle Structure ----
    const range = bar.high - bar.low || 1e-9;
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const body = Math.abs(bar.close - bar.open);
    matrix.candle_upper_wick_pct[i] = (upperWick / range) * 100;
    matrix.candle_lower_wick_pct[i] = (lowerWick / range) * 100;
    matrix.candle_body_pct[i] = (body / range) * 100;
    matrix.candle_body_size[i] = body;
    matrix.candle_range[i] = range;
    matrix.candle_direction[i] =
      body < range * 0.05 ? "Doji" : bar.close >= bar.open ? "Up" : "Down";

    // ---- Market Structure (causal pivot confirmation) ----
    matrix.pivot_event[i] = "None";
    matrix.swing_sequence[i] = "None";
    matrix.break_of_structure[i] = "None";
    matrix.liquidity_sweep[i] = "None";
    if (i >= 4) {
      const pivotIndex = i - 2;
      const pivot = bars[pivotIndex];
      const isSwingHigh =
        pivot.high > bars[pivotIndex - 1].high &&
        pivot.high >= bars[pivotIndex - 2].high &&
        pivot.high > bars[pivotIndex + 1].high &&
        pivot.high >= bars[pivotIndex + 2].high;
      const isSwingLow =
        pivot.low < bars[pivotIndex - 1].low &&
        pivot.low <= bars[pivotIndex - 2].low &&
        pivot.low < bars[pivotIndex + 1].low &&
        pivot.low <= bars[pivotIndex + 2].low;
      if (isSwingHigh) {
        previousSwingHigh = lastSwingHigh;
        lastSwingHigh = pivot.high;
        lastHighKind =
          previousSwingHigh == null || pivot.high > previousSwingHigh
            ? "HH"
            : "LH";
        matrix.swing_sequence[i] = lastHighKind;
        structureEvents.push(lastHighKind);
      }
      if (isSwingLow) {
        previousSwingLow = lastSwingLow;
        lastSwingLow = pivot.low;
        lastLowKind =
          previousSwingLow == null || pivot.low > previousSwingLow
            ? "HL"
            : "LL";
        matrix.swing_sequence[i] = lastLowKind;
        structureEvents.push(lastLowKind);
      }
      matrix.pivot_event[i] =
        isSwingHigh && isSwingLow
          ? "Both"
          : isSwingHigh
            ? "Swing High"
            : isSwingLow
              ? "Swing Low"
              : "None";
    }
    matrix.structure_state[i] =
      lastHighKind === "HH" && lastLowKind === "HL"
        ? "Bullish"
        : lastHighKind === "LH" && lastLowKind === "LL"
          ? "Bearish"
          : "Range / Transition";
    if (i > 0 && lastSwingHigh != null) {
      if (bars[i - 1].close <= lastSwingHigh && bar.close > lastSwingHigh) {
        matrix.break_of_structure[i] = "Bullish BOS";
        recentBullBreak = i;
        recentBullBreakLevel = lastSwingHigh;
      } else if (bar.high > lastSwingHigh && bar.close < lastSwingHigh) {
        matrix.liquidity_sweep[i] = "Swept High";
        recentHighSweep = i;
      }
    }
    if (i > 0 && lastSwingLow != null) {
      if (bars[i - 1].close >= lastSwingLow && bar.close < lastSwingLow) {
        matrix.break_of_structure[i] = "Bearish BOS";
        recentBearBreak = i;
        recentBearBreakLevel = lastSwingLow;
      } else if (bar.low < lastSwingLow && bar.close > lastSwingLow) {
        matrix.liquidity_sweep[i] = "Swept Low";
        recentLowSweep = i;
      }
    }
    matrix.structure_event_sequence[i] =
      structureEvents.length >= 2
        ? structureEvents.slice(-2).join(" → ")
        : "None";

    // ---- VWAP ----
    const vwap = vwapByBar[i];
    if (vwap != null) {
      matrix.vwap_distance_pct[i] = ((bar.close - vwap) / vwap) * 100;
      matrix.vwap_side[i] = bar.close >= vwap ? "Above" : "Below";
    }

    // ---- Time ----
    matrix.time_of_day[i] = timeOfDayBucket(bar.timestamp);
    matrix.session_phase[i] = sessionPhaseBucket(bar.timestamp);

    // ---- Calendar ----
    matrix.weekday[i] = weekdayBucket(bar.timestamp);
    matrix.month[i] = monthBucket(bar.timestamp);

    // ---- Volume ----
    if (i >= 20) {
      let vsum = 0;
      for (let k = i - 20; k < i; k++) vsum += bars[k].volume;
      volBaseline[i] = vsum / 20;
    }
    const baseV = volBaseline[i] || bar.volume;
    const rvol = baseV > 0 ? bar.volume / baseV : 1;
    matrix.rvol_bucket[i] = bucketize(rvol, [0.5, 1.5, 3], RVOL_BUCKETS);
    matrix.volume_spike[i] = bucketize(rvol, [1.5, 2.5], VOL_SPIKE_BUCKETS);

    // ---- Volatility ----
    tr[i] =
      i === 0
        ? range
        : Math.max(
            range,
            Math.abs(bar.high - bars[i - 1].close),
            Math.abs(bar.low - bars[i - 1].close),
          );
    let currentAtr = tr[i];
    if (i >= 14) {
      let atrSum = 0;
      for (let k = i - 13; k <= i; k++) atrSum += tr[k];
      const atr = atrSum / 14;
      currentAtr = atr;
      const atrHistory: number[] = [];
      for (let k = 14; k <= i; k++) {
        let s = 0;
        for (let m = k - 13; m <= k; m++) s += tr[m];
        atrHistory.push(s / 14);
      }
      matrix.atr_percentile[i] = percentile(atr, atrHistory);
    }
    if (i >= 20) {
      const rangeHistory: number[] = [];
      for (let k = i - 19; k <= i; k++)
        rangeHistory.push(bars[k].high - bars[k].low);
      matrix.range_percentile[i] = percentile(range, rangeHistory);
    }

    // ---- Location ----
    // Previous day high/low/close: find the day before this bar's day.
    const myDay = findDay(dayIndex, i);
    if (myDay && myDay.dayIdx > 0) {
      const prev = dayIndex[myDay.dayIdx - 1];
      const prevRange = prev.high - prev.low || 1e-9;
      matrix.prev_day_location[i] = ((bar.close - prev.low) / prevRange) * 100;
      matrix.prev_day_level_state[i] =
        bar.close > prev.high
          ? "Above PDH"
          : bar.close < prev.low
            ? "Below PDL"
            : "Inside Previous Day";
      matrix.distance_to_pdh_atr[i] =
        currentAtr > 1e-12 ? (bar.close - prev.high) / currentAtr : undefined;
      matrix.distance_to_pdl_atr[i] =
        currentAtr > 1e-12 ? (bar.close - prev.low) / currentAtr : undefined;
      matrix.prev_day_level_event[i] = "None";
      if (bar.high > prev.high && bar.close < prev.high) {
        matrix.prev_day_level_event[i] = "Swept PDH";
        recentHighSweep = i;
      } else if (bar.low < prev.low && bar.close > prev.low) {
        matrix.prev_day_level_event[i] = "Swept PDL";
        recentLowSweep = i;
      } else if (
        i > 0 &&
        bars[i - 1].close <= prev.high &&
        bar.close > prev.high
      ) {
        matrix.prev_day_level_event[i] = "Broke PDH";
        recentBullBreak = i;
        recentBullBreakLevel = prev.high;
      } else if (
        i > 0 &&
        bars[i - 1].close >= prev.low &&
        bar.close < prev.low
      ) {
        matrix.prev_day_level_event[i] = "Broke PDL";
        recentBearBreak = i;
        recentBearBreakLevel = prev.low;
      } else if (
        i > 0 &&
        bars[i - 1].close > prev.high &&
        bar.close <= prev.high
      ) {
        matrix.prev_day_level_event[i] = "Reclaimed PDH";
      } else if (
        i > 0 &&
        bars[i - 1].close < prev.low &&
        bar.close >= prev.low
      ) {
        matrix.prev_day_level_event[i] = "Reclaimed PDL";
      }
    }
    if (i > 0) {
      const windowStart = bar.timestamp - HOUR_MS;
      let ph = Number.NEGATIVE_INFINITY;
      let pl = Number.POSITIVE_INFINITY;
      let observations = 0;
      for (let k = i - 1; k >= 0 && bars[k].timestamp >= windowStart; k--) {
        ph = Math.max(ph, bars[k].high);
        pl = Math.min(pl, bars[k].low);
        observations++;
      }
      if (observations > 0) {
        const pr = ph - pl || 1e-9;
        matrix.prev_hour_location[i] = ((bar.close - pl) / pr) * 100;
      }
    }

    // ---- Rolling price box ----
    if (i >= 20) {
      let boxHigh = Number.NEGATIVE_INFINITY;
      let boxLow = Number.POSITIVE_INFINITY;
      for (let k = i - 20; k < i; k++) {
        boxHigh = Math.max(boxHigh, bars[k].high);
        boxLow = Math.min(boxLow, bars[k].low);
      }
      const boxRange = boxHigh - boxLow || 1e-9;
      matrix.box_position[i] = ((bar.close - boxLow) / boxRange) * 100;
      matrix.box_event[i] =
        bar.high > boxHigh && bar.close <= boxHigh
          ? "Failed Breakout Up"
          : bar.low < boxLow && bar.close >= boxLow
            ? "Failed Breakout Down"
            : bar.close > boxHigh
              ? "Breakout Up"
              : bar.close < boxLow
                ? "Breakout Down"
                : "Inside Box";
      if (matrix.box_event[i] === "Breakout Up") {
        recentBullBreak = i;
        recentBullBreakLevel = boxHigh;
      } else if (matrix.box_event[i] === "Breakout Down") {
        recentBearBreak = i;
        recentBearBreakLevel = boxLow;
      }
    }

    // ---- Gap ----
    if (myDay && myDay.dayIdx > 0) {
      const prev = dayIndex[myDay.dayIdx - 1];
      const gapPct =
        prev.close > 0 ? ((bar.open - prev.close) / prev.close) * 100 : 0;
      matrix.gap_size_pct[i] = gapPct;
      matrix.gap_direction[i] =
        Math.abs(gapPct) < 0.05 ? "Flat" : gapPct > 0 ? "Up" : "Down";
    }

    // ---- Opening Range ----
    const orHi = orHighByBar[i];
    const orLo = orLowByBar[i];
    const orSize = orSizeByBar[i];
    if (orHi != null && orLo != null) {
      matrix.or_size_pct[i] =
        orSize != null && bar.close > 0 ? (orSize / bar.close) * 100 : 0;
      const brokeUp = bar.high > orHi;
      const brokeDown = bar.low < orLo;
      matrix.or_breakout[i] =
        brokeUp && brokeDown
          ? "Both"
          : brokeUp
            ? "Up"
            : brokeDown
              ? "Down"
              : "None";
    }

    // ---- Bollinger ----
    const sma20 = sma(closes, 20, i);
    if (sma20 != null) {
      const sd = stdev(closes, 20, i, sma20);
      if (sd != null) {
        const upper = sma20 + 2 * sd;
        const lower = sma20 - 2 * sd;
        if (bar.close >= upper) matrix.bb_location[i] = "Above Upper";
        else if (bar.close >= sma20) matrix.bb_location[i] = "Upper Half";
        else if (bar.close >= lower) matrix.bb_location[i] = "Lower Half";
        else matrix.bb_location[i] = "Below Lower";
        matrix.bb_bandwidth[i] =
          sma20 > 0 ? ((upper - lower) / sma20) * 100 : 0;
        matrix.bb_percent_b[i] =
          upper !== lower ? ((bar.close - lower) / (upper - lower)) * 100 : 50;
        const bandwidth = matrix.bb_bandwidth[i];
        if (typeof bandwidth === "number") {
          bandwidthHistory.push(bandwidth);
          const recentBandwidth = bandwidthHistory.slice(-100);
          matrix.bb_bandwidth_percentile[i] = percentile(
            bandwidth,
            recentBandwidth,
          );
          const bandwidthPct = matrix.bb_bandwidth_percentile[i];
          matrix.bb_regime[i] =
            typeof bandwidthPct === "number" && bandwidthPct <= 20
              ? "Squeeze"
              : typeof bandwidthPct === "number" && bandwidthPct >= 80
                ? "Expansion"
                : "Normal";
        }
      }
    }

    // ---- Trend ----
    // Trend slope: 20-period linear regression slope.
    if (i >= 20) {
      const n = 20;
      let sx = 0;
      let sy = 0;
      let sxy = 0;
      let sxx = 0;
      for (let k = 0; k < n; k++) {
        const x = k;
        const y = closes[i - n + 1 + k];
        sx += x;
        sy += y;
        sxy += x * y;
        sxx += x * x;
      }
      const denom = n * sxx - sx * sx;
      matrix.trend_slope[i] = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
    }
    // Trend strength via R²-ish proxy: |slope| / ATR.
    const slopeRaw = matrix.trend_slope[i];
    if (typeof slopeRaw === "number" && i >= 14) {
      let atrSum = 0;
      for (let k = i - 13; k <= i; k++) atrSum += tr[k];
      const atr = atrSum / 14;
      const ratio = atr > 0 ? Math.abs(slopeRaw) / atr : 0;
      matrix.trend_strength[i] = bucketize(
        ratio,
        [0.05, 0.12, 0.2],
        TREND_STRENGTH_BUCKETS,
      );
    }
    // Consecutive direction.
    if (i >= 1) {
      let count = 1;
      const dir = closes[i] >= closes[i - 1] ? 1 : -1;
      for (let k = i - 1; k > 0; k--) {
        const d = closes[k] >= closes[k - 1] ? 1 : -1;
        if (d === dir) count++;
        else break;
      }
      if (dir > 0) {
        matrix.consecutive_direction[i] = count >= 3 ? "Up x3+" : "Up";
      } else {
        matrix.consecutive_direction[i] = count >= 3 ? "Down x3+" : "Down";
      }
      if (count === 1) matrix.consecutive_direction[i] = "Neutral";
    }

    // ---- Ordered event sequences ----
    matrix.sweep_reclaim_sequence[i] = "None";
    if (
      i - recentHighSweep > 0 &&
      i - recentHighSweep <= 5 &&
      (matrix.prev_day_level_event[i] === "Reclaimed PDH" ||
        (lastSwingHigh != null && bar.close > lastSwingHigh))
    ) {
      matrix.sweep_reclaim_sequence[i] = "High Sweep → Reclaim";
    } else if (
      i - recentLowSweep > 0 &&
      i - recentLowSweep <= 5 &&
      (matrix.prev_day_level_event[i] === "Reclaimed PDL" ||
        (lastSwingLow != null && bar.close > lastSwingLow))
    ) {
      matrix.sweep_reclaim_sequence[i] = "Low Sweep → Reclaim";
    }

    matrix.break_retest_sequence[i] = "None";
    if (
      i - recentBullBreak > 0 &&
      i - recentBullBreak <= 5 &&
      recentBullBreakLevel != null &&
      bar.low <= recentBullBreakLevel &&
      bar.close >= recentBullBreakLevel
    ) {
      matrix.break_retest_sequence[i] = "Bullish Break → Retest";
    } else if (
      i - recentBearBreak > 0 &&
      i - recentBearBreak <= 5 &&
      recentBearBreakLevel != null &&
      bar.high >= recentBearBreakLevel &&
      bar.close <= recentBearBreakLevel
    ) {
      matrix.break_retest_sequence[i] = "Bearish Break → Retest";
    }
  }

  // ---- Custom uploaded columns ----
  // Populate custom-column features directly from the provided values map.
  // The feature id is `custom_<normalizedKey>`; the values array is parallel
  // to `bars` by index. Missing columns leave the matrix entry undefined,
  // which the discovery engine treats as "feature not defined for this bar".
  for (const feat of features) {
    if (feat.source !== "custom") continue;
    // Recover the normalized key from the feature id (prefix `custom_`).
    const key = feat.id.startsWith("custom_")
      ? feat.id.slice("custom_".length)
      : normalizeHeader(feat.name);
    const vals = customColumnValues[key];
    if (!vals) continue;
    const arr = matrix[feat.id];
    if (!arr) continue;
    const len = Math.min(vals.length, bars.length);
    for (let i = 0; i < len; i++) {
      const v = vals[i];
      arr[i] = typeof v === "number" && !Number.isNaN(v) ? v : undefined;
    }
  }

  return matrix;
}

interface DayBucket {
  start: number;
  end: number;
  high: number;
  low: number;
  close: number;
  dayIdx: number;
}

function buildDayIndex(bars: OHLCVBar[]): DayBucket[] {
  const days: DayBucket[] = [];
  let cur: DayBucket | null = null;
  let lastDay = -1;
  for (let i = 0; i < bars.length; i++) {
    // UTC-safe day bucketing: days since the Unix epoch in UTC. This is
    // independent of the host timezone, so uploaded CSVs land in the correct
    // day bucket regardless of where the user's browser runs. (The previous
    // new Date(ts).getDate() used the local calendar day, which split or
    // merged sessions incorrectly across timezones.)
    const d = Math.floor(bars[i].timestamp / 86400000);
    if (d !== lastDay) {
      if (cur) {
        cur.end = i - 1;
        days.push(cur);
      }
      cur = {
        start: i,
        end: i,
        high: bars[i].high,
        low: bars[i].low,
        close: bars[i].close,
        dayIdx: days.length,
      };
      lastDay = d;
    } else if (cur) {
      cur.high = Math.max(cur.high, bars[i].high);
      cur.low = Math.min(cur.low, bars[i].low);
      cur.close = bars[i].close;
    }
  }
  if (cur) {
    cur.end = bars.length - 1;
    days.push(cur);
  }
  return days;
}

function findDay(days: DayBucket[], barIdx: number): DayBucket | null {
  // Binary search.
  let lo = 0;
  let hi = days.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = days[mid];
    if (barIdx < d.start) hi = mid - 1;
    else if (barIdx > d.end) lo = mid + 1;
    else return d;
  }
  return null;
}
