import type { ColumnSemantic, Dataset, Feature, FeatureMatrix } from "@/types";

const IMPORTED_CATEGORY = "Imported Signals";

function finiteValues(values: number[] | undefined): number[] {
  return (values ?? []).filter((value) => Number.isFinite(value));
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function rollingPercentile(
  values: number[],
  index: number,
  window = 100,
): number | undefined {
  const current = values[index];
  if (!Number.isFinite(current)) return undefined;
  const start = Math.max(0, index - window + 1);
  let valid = 0;
  let belowOrEqual = 0;
  for (let i = start; i <= index; i++) {
    const candidate = values[i];
    if (!Number.isFinite(candidate)) continue;
    valid++;
    if (candidate <= current) belowOrEqual++;
  }
  return valid >= 10 ? (belowOrEqual / valid) * 100 : undefined;
}

function rollingZScore(
  values: number[],
  index: number,
  window = 50,
): number | undefined {
  const current = values[index];
  if (!Number.isFinite(current)) return undefined;
  const start = Math.max(0, index - window + 1);
  const sample: number[] = [];
  for (let i = start; i <= index; i++) {
    if (Number.isFinite(values[i])) sample.push(values[i]);
  }
  if (sample.length < 10) return undefined;
  const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
  const variance =
    sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sample.length;
  const sd = Math.sqrt(variance);
  return sd > 1e-12 ? (current - mean) / sd : 0;
}

function atrSeries(dataset: Dataset): number[] {
  const trueRanges = dataset.bars.map((bar, index) => {
    if (index === 0) return bar.high - bar.low;
    const previousClose = dataset.bars[index - 1].close;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    );
  });
  return trueRanges.map((_, index) => {
    const start = Math.max(0, index - 13);
    let sum = 0;
    for (let i = start; i <= index; i++) sum += trueRanges[i];
    return sum / (index - start + 1);
  });
}

export function inferColumnSemantic(
  label: string,
  values: number[],
): ColumnSemantic {
  const name = label.toLowerCase().replace(/[_-]+/g, " ");
  const finite = finiteValues(values);
  const unique = new Set(finite.slice(0, 5000));

  if (
    unique.size >= 2 &&
    unique.size <= 3 &&
    [...unique].every((value) => Number.isInteger(value))
  ) {
    return "binary-event";
  }
  if (
    /\b(?:obv|on balance volume|cumulative|cum(?:ulated)?|running total)\b/.test(
      name,
    )
  ) {
    return "cumulative";
  }
  if (
    /\b(?:price|vwap|support|resistance|pivot|level|session high|session low|session open|session close|day high|day low|week high|week low)\b/.test(
      name,
    ) ||
    /^(?:upper|lower|basis|middle|midline|open|high|low|close)$/.test(name) ||
    /\b(?:upper|lower|basis)\s*(?:band|bb)?\b/.test(name)
  ) {
    return "price-level";
  }
  if (
    /\b(?:pct|percent|percentage|return|change %|distance %|bandwidth|ratio)\b/.test(
      name,
    ) ||
    label.includes("%")
  ) {
    return "percentage";
  }
  if (
    /\b(?:rsi|stoch|stochastic|oscillator|williams|cci|mfi|index|score)\b/.test(
      name,
    )
  ) {
    return "oscillator";
  }
  if (finite.length > 10) {
    const low = Math.min(...finite);
    const high = Math.max(...finite);
    if ((low >= 0 && high <= 100) || (low >= -1 && high <= 1)) {
      return "oscillator";
    }
  }
  return "generic";
}

function feature(
  id: string,
  name: string,
  description: string,
  type: Feature["type"],
  semantic: ColumnSemantic,
  formula: string,
  buckets?: string[],
): Feature {
  return {
    id,
    name,
    category: IMPORTED_CATEGORY,
    description,
    type,
    enabled: true,
    source: "custom",
    semantic,
    formula,
    buckets,
  };
}

function eventState(value: number): string {
  if (value > 0) return "Positive / On";
  if (value < 0) return "Negative / On";
  return "Off";
}

/**
 * Converts imported columns into stationary, interpretable research features.
 * Raw price levels and cumulative totals never enter discovery directly.
 */
export function deriveSemanticColumnFeatures(dataset: Dataset): {
  features: Feature[];
  matrix: FeatureMatrix;
  semantics: Record<string, ColumnSemantic>;
} {
  const features: Feature[] = [];
  const matrix: FeatureMatrix = {};
  const semantics: Record<string, ColumnSemantic> = {};
  const atr = atrSeries(dataset);

  for (const column of dataset.columns) {
    if (column.type !== "numeric") continue;
    const values = dataset.columnValues?.[column.key];
    if (!values) continue;
    const semantic = inferColumnSemantic(column.label, values);
    semantics[column.key] = semantic;
    const base = `custom_${column.key}`;
    const label = column.label;
    const add = (candidate: Feature, series: FeatureMatrix[string]) => {
      features.push(candidate);
      matrix[candidate.id] = series;
    };

    if (semantic === "binary-event") {
      add(
        feature(
          `${base}_state`,
          `${label} State`,
          `Whether imported signal "${label}" is off, positive/on, or negative/on.`,
          "categorical",
          semantic,
          `${label} mapped by sign: zero = Off, positive = Positive / On, negative = Negative / On`,
          ["Off", "Positive / On", "Negative / On"],
        ),
        values.map((value) =>
          Number.isFinite(value) ? eventState(value) : undefined,
        ),
      );
      continue;
    }

    if (semantic === "price-level") {
      const distancePct = values.map((value, index) => {
        const close = dataset.bars[index]?.close;
        return Number.isFinite(value) && close
          ? ((close - value) / Math.abs(close)) * 100
          : undefined;
      });
      const distanceAtr = values.map((value, index) => {
        const close = dataset.bars[index]?.close;
        const scale = atr[index];
        return Number.isFinite(value) && close != null && scale > 1e-12
          ? (close - value) / scale
          : undefined;
      });
      const relation = values.map((value, index) => {
        const close = dataset.bars[index]?.close;
        const tolerance = Math.max(
          atr[index] * 0.05,
          Math.abs(close ?? 0) * 1e-5,
        );
        if (!Number.isFinite(value) || close == null) return undefined;
        if (Math.abs(close - value) <= tolerance) return "At level";
        return close > value ? "Above level" : "Below level";
      });
      const crossing = values.map((value, index) => {
        if (index === 0 || !Number.isFinite(value)) return "No cross";
        const previousValue = values[index - 1];
        if (!Number.isFinite(previousValue)) return "No cross";
        const previousClose = dataset.bars[index - 1].close;
        const close = dataset.bars[index].close;
        if (previousClose <= previousValue && close > value)
          return "Crossed above";
        if (previousClose >= previousValue && close < value)
          return "Crossed below";
        return "No cross";
      });
      add(
        feature(
          `${base}_distance_pct`,
          `Distance from ${label} %`,
          `Close relative to "${label}" as a percentage of price, rather than its literal level.`,
          "numeric",
          semantic,
          `(close - ${label}) / abs(close) * 100`,
        ),
        distancePct,
      );
      add(
        feature(
          `${base}_distance_atr`,
          `Distance from ${label} (ATR)`,
          `Close relative to "${label}" in current ATR units.`,
          "numeric",
          semantic,
          `(close - ${label}) / ATR(14)`,
        ),
        distanceAtr,
      );
      add(
        feature(
          `${base}_relation`,
          `${label} Relationship`,
          `Whether price is above, below, or touching "${label}".`,
          "categorical",
          semantic,
          `close compared with ${label}, using a small ATR-aware touch tolerance`,
          ["Below level", "At level", "Above level"],
        ),
        relation,
      );
      add(
        feature(
          `${base}_cross`,
          `${label} Cross`,
          `Whether price crossed above or below "${label}" on this bar.`,
          "categorical",
          semantic,
          `previous close/value relationship compared with current close/${label}`,
          ["No cross", "Crossed above", "Crossed below"],
        ),
        crossing,
      );
      continue;
    }

    const percentileSeries = values.map((_, index) =>
      rollingPercentile(values, index),
    );
    const directionSeries = values.map((value, index) => {
      if (index === 0 || !Number.isFinite(value)) return undefined;
      const previous = values[index - 1];
      if (!Number.isFinite(previous)) return undefined;
      if (value > previous) return "Rising";
      if (value < previous) return "Falling";
      return "Flat";
    });

    if (semantic === "cumulative" || semantic === "generic") {
      const change = values.map((value, index) =>
        index > 0 &&
        Number.isFinite(value) &&
        Number.isFinite(values[index - 1])
          ? value - values[index - 1]
          : Number.NaN,
      );
      add(
        feature(
          `${base}_change_z`,
          `${label} Change Z-Score`,
          `Standardized change in "${label}" versus its own recent history.`,
          "numeric",
          semantic,
          `zscore(change(${label}), 50)`,
        ),
        change.map((_, index) => rollingZScore(change, index)),
      );
    } else {
      add(
        feature(
          `${base}_value`,
          label,
          `Contextual value of imported ${semantic} "${label}".`,
          "numeric",
          semantic,
          `${label} raw value; eligible because it is already a stationary ${semantic}`,
        ),
        values.map((value) => (Number.isFinite(value) ? value : undefined)),
      );
    }

    add(
      feature(
        `${base}_percentile`,
        `${label} Rolling Percentile`,
        `Where "${label}" ranks within its most recent 100 observations.`,
        "numeric",
        semantic,
        `rolling_percentile(${label}, 100)`,
      ),
      percentileSeries,
    );
    add(
      feature(
        `${base}_direction`,
        `${label} Direction`,
        `Whether "${label}" is rising, falling, or flat.`,
        "categorical",
        semantic,
        `${label}[t] compared with ${label}[t-1]`,
        ["Falling", "Flat", "Rising"],
      ),
      directionSeries,
    );

    if (semantic === "oscillator") {
      const finite = finiteValues(values);
      const lower = quantile(finite, 0.2);
      const upper = quantile(finite, 0.8);
      add(
        feature(
          `${base}_zone`,
          `${label} Zone`,
          `Low, middle, or high regime for "${label}" using its observed 20th and 80th percentiles.`,
          "categorical",
          semantic,
          `${label} <= p20 = Low, >= p80 = High, otherwise Middle`,
          ["Low", "Middle", "High"],
        ),
        values.map((value) => {
          if (!Number.isFinite(value)) return undefined;
          if (value <= lower) return "Low";
          if (value >= upper) return "High";
          return "Middle";
        }),
      );
    }
  }

  return { features, matrix, semantics };
}
