import { inferDefinition, resolveDefinition } from "@/lib/definitionRegistry";
import type {
  ColumnSemantic,
  Dataset,
  Feature,
  FeatureMatrix,
  IndicatorDefinition,
  RelationshipPrimitive,
} from "@/types";

const IMPORTED_CATEGORY = "Imported Signals";
const RELATIONSHIP_CATEGORY = "Indicator Relationships";
const DIVERGENCE_CATEGORY = "Divergence";
const SEQUENCE_CATEGORY = "Sequences";
const EPSILON = 1e-12;

function finiteValues(values: number[] | undefined): number[] {
  return (values ?? []).filter(Number.isFinite);
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
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let i = start; i <= index; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    sum += value;
    sumSquares += value * value;
    count++;
  }
  if (count < 10) return undefined;
  const mean = sum / count;
  const variance = Math.max(0, sumSquares / count - mean * mean);
  const sd = Math.sqrt(variance);
  return sd > EPSILON ? (current - mean) / sd : 0;
}

function atrSeries(dataset: Dataset): number[] {
  if (!dataset.hasOHLC) return new Array(dataset.rowCount).fill(Number.NaN);
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
  return inferDefinition(label, values).semantic;
}

function makeFeature(
  definition: IndicatorDefinition,
  id: string,
  name: string,
  description: string,
  type: Feature["type"],
  formula: string,
  primitive: RelationshipPrimitive,
  category = IMPORTED_CATEGORY,
  buckets?: string[],
): Feature {
  return {
    id,
    name,
    category,
    description,
    type,
    enabled: true,
    source: "custom",
    semantic: definition.semantic,
    definitionId: definition.id,
    role: definition.role,
    primitive,
    formula,
    buckets,
  };
}

function eventState(value: number): string {
  if (value > 0) return "Positive / On";
  if (value < 0) return "Negative / On";
  return "Off";
}

function directionSeries(values: number[], lag = 1): (string | undefined)[] {
  return values.map((value, index) => {
    if (
      index < lag ||
      !Number.isFinite(value) ||
      !Number.isFinite(values[index - lag])
    ) {
      return undefined;
    }
    const change = value - values[index - lag];
    const tolerance = Math.max(Math.abs(values[index - lag]) * 1e-10, EPSILON);
    if (change > tolerance) return "Rising";
    if (change < -tolerance) return "Falling";
    return "Flat";
  });
}

function slopeSeries(values: number[], lag = 5): (number | undefined)[] {
  return values.map((value, index) => {
    if (
      index < lag ||
      !Number.isFinite(value) ||
      !Number.isFinite(values[index - lag])
    ) {
      return undefined;
    }
    const scale = Math.max(Math.abs(values[index - lag]), EPSILON);
    return ((value - values[index - lag]) / scale / lag) * 100;
  });
}

function accelerationSeries(
  slopes: (number | undefined)[],
): (number | undefined)[] {
  return slopes.map((value, index) => {
    const previous = index > 0 ? slopes[index - 1] : undefined;
    return value != null && previous != null ? value - previous : undefined;
  });
}

function persistenceSeries(
  directions: (string | undefined)[],
): (number | undefined)[] {
  let last: string | undefined;
  let count = 0;
  return directions.map((direction) => {
    if (!direction || direction === "Flat") {
      last = direction;
      count = direction ? 1 : 0;
      return direction ? count : undefined;
    }
    count = direction === last ? count + 1 : 1;
    last = direction;
    return count;
  });
}

function regimeSeries(
  percentiles: (number | undefined)[],
): (string | undefined)[] {
  return percentiles.map((value, index) => {
    if (value == null) return undefined;
    const regime = value <= 20 ? "Low" : value >= 80 ? "High" : "Middle";
    if (index === 0 || percentiles[index - 1] == null) return "No transition";
    const previous = percentiles[index - 1] as number;
    const previousRegime =
      previous <= 20 ? "Low" : previous >= 80 ? "High" : "Middle";
    return regime === previousRegime
      ? "No transition"
      : `${previousRegime} → ${regime}`;
  });
}

function priceLevelEvents(
  dataset: Dataset,
  level: number[],
  atr: number[],
): {
  distancePct: (number | undefined)[];
  distanceAtr: (number | undefined)[];
  relation: (string | undefined)[];
  cross: string[];
  touch: string[];
  rejection: string[];
  breakout: string[];
} {
  const distancePct: (number | undefined)[] = [];
  const distanceAtr: (number | undefined)[] = [];
  const relation: (string | undefined)[] = [];
  const cross: string[] = [];
  const touch: string[] = [];
  const rejection: string[] = [];
  const breakout: string[] = [];
  for (let index = 0; index < level.length; index++) {
    const value = level[index];
    const bar = dataset.bars[index];
    const close = bar?.close;
    const scale = atr[index];
    if (!Number.isFinite(value) || !bar || !Number.isFinite(close)) {
      distancePct.push(undefined);
      distanceAtr.push(undefined);
      relation.push(undefined);
      cross.push("No cross");
      touch.push("No touch");
      rejection.push("No rejection");
      breakout.push("No breakout");
      continue;
    }
    const tolerance = Math.max(
      (Number.isFinite(scale) ? scale : 0) * 0.05,
      Math.abs(close) * 1e-5,
    );
    distancePct.push(
      close !== 0 ? ((close - value) / Math.abs(close)) * 100 : undefined,
    );
    distanceAtr.push(
      Number.isFinite(scale) && scale > EPSILON
        ? (close - value) / scale
        : undefined,
    );
    relation.push(
      Math.abs(close - value) <= tolerance
        ? "At level"
        : close > value
          ? "Above level"
          : "Below level",
    );
    const touched =
      bar.low <= value + tolerance && bar.high >= value - tolerance;
    touch.push(touched ? "Touched" : "No touch");
    if (index === 0 || !Number.isFinite(level[index - 1])) {
      cross.push("No cross");
      rejection.push("No rejection");
      breakout.push("No breakout");
      continue;
    }
    const previousClose = dataset.bars[index - 1].close;
    const previousLevel = level[index - 1];
    const crossedAbove = previousClose <= previousLevel && close > value;
    const crossedBelow = previousClose >= previousLevel && close < value;
    cross.push(
      crossedAbove
        ? "Crossed above"
        : crossedBelow
          ? "Crossed below"
          : "No cross",
    );
    const rejectedBelow =
      touched && bar.high > value && close < value && bar.open <= value;
    const rejectedAbove =
      touched && bar.low < value && close > value && bar.open >= value;
    rejection.push(
      rejectedBelow
        ? "Rejected downward"
        : rejectedAbove
          ? "Rejected upward"
          : "No rejection",
    );
    const heldAbove = crossedAbove && close > value + tolerance;
    const heldBelow = crossedBelow && close < value - tolerance;
    const failedAbove =
      previousClose > previousLevel && bar.high > value && close < value;
    const failedBelow =
      previousClose < previousLevel && bar.low < value && close > value;
    breakout.push(
      heldAbove
        ? "Broke above"
        : heldBelow
          ? "Broke below"
          : failedAbove
            ? "Failed above / reclaimed below"
            : failedBelow
              ? "Failed below / reclaimed above"
              : "No breakout",
    );
  }
  return {
    distancePct,
    distanceAtr,
    relation,
    cross,
    touch,
    rejection,
    breakout,
  };
}

interface Pivot {
  index: number;
  value: number;
}

function confirmedPivots(
  values: number[],
  left = 3,
  right = 3,
): {
  lows: Pivot[];
  highs: Pivot[];
  lowByConfirmation: Map<number, Pivot>;
  highByConfirmation: Map<number, Pivot>;
} {
  const lows: Pivot[] = [];
  const highs: Pivot[] = [];
  const lowByConfirmation = new Map<number, Pivot>();
  const highByConfirmation = new Map<number, Pivot>();
  for (
    let pivotIndex = left;
    pivotIndex < values.length - right;
    pivotIndex++
  ) {
    const value = values[pivotIndex];
    if (!Number.isFinite(value)) continue;
    let low = true;
    let high = true;
    for (let i = pivotIndex - left; i <= pivotIndex + right; i++) {
      if (i === pivotIndex || !Number.isFinite(values[i])) continue;
      if (values[i] <= value) low = false;
      if (values[i] >= value) high = false;
    }
    const confirmationIndex = pivotIndex + right;
    if (low) {
      const pivot = { index: pivotIndex, value };
      lows.push(pivot);
      lowByConfirmation.set(confirmationIndex, pivot);
    }
    if (high) {
      const pivot = { index: pivotIndex, value };
      highs.push(pivot);
      highByConfirmation.set(confirmationIndex, pivot);
    }
  }
  return { lows, highs, lowByConfirmation, highByConfirmation };
}

function divergenceSeries(
  price: number[],
  indicator: number[],
): (string | undefined)[] {
  const result: (string | undefined)[] = new Array(price.length).fill("None");
  const pivots = confirmedPivots(price);
  let previousLow: Pivot | undefined;
  let previousHigh: Pivot | undefined;
  for (let confirmation = 0; confirmation < price.length; confirmation++) {
    const low = pivots.lowByConfirmation.get(confirmation);
    if (low) {
      const currentIndicator = indicator[low.index];
      const previousIndicator = previousLow
        ? indicator[previousLow.index]
        : undefined;
      if (
        previousLow &&
        Number.isFinite(currentIndicator) &&
        Number.isFinite(previousIndicator)
      ) {
        if (
          low.value < previousLow.value &&
          currentIndicator > (previousIndicator as number)
        ) {
          result[confirmation] = "Regular bullish divergence";
        } else if (
          low.value > previousLow.value &&
          currentIndicator < (previousIndicator as number)
        ) {
          result[confirmation] = "Hidden bullish divergence";
        } else if (
          low.value < previousLow.value &&
          currentIndicator < (previousIndicator as number)
        ) {
          result[confirmation] = "Bearish downside convergence";
        } else if (
          low.value > previousLow.value &&
          currentIndicator > (previousIndicator as number)
        ) {
          result[confirmation] = "Bullish higher-low convergence";
        }
      }
      previousLow = low;
    }
    const high = pivots.highByConfirmation.get(confirmation);
    if (high) {
      const currentIndicator = indicator[high.index];
      const previousIndicator = previousHigh
        ? indicator[previousHigh.index]
        : undefined;
      if (
        previousHigh &&
        Number.isFinite(currentIndicator) &&
        Number.isFinite(previousIndicator)
      ) {
        if (
          high.value > previousHigh.value &&
          currentIndicator < (previousIndicator as number)
        ) {
          result[confirmation] = "Regular bearish divergence";
        } else if (
          high.value < previousHigh.value &&
          currentIndicator > (previousIndicator as number)
        ) {
          result[confirmation] = "Hidden bearish divergence";
        } else if (
          high.value > previousHigh.value &&
          currentIndicator > (previousIndicator as number)
        ) {
          result[confirmation] = "Bullish upside convergence";
        } else if (
          high.value < previousHigh.value &&
          currentIndicator < (previousIndicator as number)
        ) {
          result[confirmation] = "Bearish lower-high convergence";
        }
      }
      previousHigh = high;
    }
  }
  return result;
}

function addRecentEventFeature(
  definition: IndicatorDefinition,
  sourceFeature: Feature,
  sourceSeries: FeatureMatrix[string],
  features: Feature[],
  matrix: FeatureMatrix,
): void {
  if (sourceFeature.type !== "categorical") return;
  const active = (value: string | number | undefined): boolean =>
    typeof value === "string" && !/^(?:no |none|off|flat|middle)/i.test(value);
  let barsSince = Number.POSITIVE_INFINITY;
  const series = sourceSeries.map((value) => {
    barsSince = active(value) ? 0 : barsSince + 1;
    if (!Number.isFinite(barsSince)) return "Not recent";
    if (barsSince === 0) return "Now";
    if (barsSince <= 3) return "Within 3 bars";
    if (barsSince <= 10) return "Within 10 bars";
    return "Not recent";
  });
  const id = `${sourceFeature.id}_recency`;
  features.push(
    makeFeature(
      definition,
      id,
      `${sourceFeature.name} Recency`,
      `How recently "${sourceFeature.name}" occurred, enabling ordered multi-event sequences without using future data.`,
      "categorical",
      `bars_since(${sourceFeature.id}) bucketed at 0, 3, and 10`,
      "sequence",
      SEQUENCE_CATEGORY,
      ["Now", "Within 3 bars", "Within 10 bars", "Not recent"],
    ),
  );
  matrix[id] = series;
}

function bandGroup(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/\b(?:upper|lower|basis|middle|midline|band)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "default"
  );
}

function addBandRelationships(
  dataset: Dataset,
  definitions: Map<string, IndicatorDefinition>,
  atr: number[],
  features: Feature[],
  matrix: FeatureMatrix,
): void {
  const columns = dataset.columns.filter((column) => {
    const role = definitions.get(column.key)?.role;
    return role === "upper-band" || role === "lower-band" || role === "basis";
  });
  const uppers = columns.filter(
    (column) => definitions.get(column.key)?.role === "upper-band",
  );
  const lowers = columns.filter(
    (column) => definitions.get(column.key)?.role === "lower-band",
  );
  let pairs = 0;
  for (const upper of uppers) {
    const lower =
      lowers.find(
        (candidate) => bandGroup(candidate.label) === bandGroup(upper.label),
      ) ?? (uppers.length === 1 && lowers.length === 1 ? lowers[0] : undefined);
    if (!lower || pairs >= 8) continue;
    const upperValues = dataset.columnValues?.[upper.key];
    const lowerValues = dataset.columnValues?.[lower.key];
    if (!upperValues || !lowerValues) continue;
    pairs++;
    const idBase = `bands_${upper.key}_${lower.key}`;
    const widthPct = upperValues.map((value, index) => {
      const lowerValue = lowerValues[index];
      const close = dataset.bars[index]?.close;
      return Number.isFinite(value) && Number.isFinite(lowerValue) && close
        ? ((value - lowerValue) / Math.abs(close)) * 100
        : undefined;
    });
    const widthAtr = upperValues.map((value, index) => {
      const lowerValue = lowerValues[index];
      return Number.isFinite(value) &&
        Number.isFinite(lowerValue) &&
        atr[index] > EPSILON
        ? (value - lowerValue) / atr[index]
        : undefined;
    });
    const widthDirection = directionSeries(
      widthPct.map((value) => value ?? Number.NaN),
      3,
    );
    const definition = definitions.get(upper.key) as IndicatorDefinition;
    const add = (feature: Feature, series: FeatureMatrix[string]) => {
      features.push(feature);
      matrix[feature.id] = series;
    };
    add(
      makeFeature(
        definition,
        `${idBase}_width_pct`,
        `${upper.label} / ${lower.label} Width %`,
        "Scale-independent envelope width.",
        "numeric",
        `(${upper.label} - ${lower.label}) / abs(close) * 100`,
        "normalized-value",
        RELATIONSHIP_CATEGORY,
      ),
      widthPct,
    );
    add(
      makeFeature(
        definition,
        `${idBase}_width_atr`,
        `${upper.label} / ${lower.label} Width (ATR)`,
        "Envelope width normalized by current volatility.",
        "numeric",
        `(${upper.label} - ${lower.label}) / ATR(14)`,
        "normalized-value",
        RELATIONSHIP_CATEGORY,
      ),
      widthAtr,
    );
    add(
      makeFeature(
        definition,
        `${idBase}_expansion`,
        `${upper.label} / ${lower.label} Expansion State`,
        "Whether this envelope is expanding or compressing over three observations.",
        "categorical",
        `direction(width(${upper.label}, ${lower.label}), 3)`,
        "expansion",
        RELATIONSHIP_CATEGORY,
        ["Falling", "Flat", "Rising"],
      ),
      widthDirection.map((value) =>
        value === "Rising"
          ? "Expanding"
          : value === "Falling"
            ? "Compressing"
            : value,
      ),
    );
  }

  // Compare envelope widths to expose nesting and relative expansion across
  // multiple Bollinger/Keltner configurations without literal price levels.
  const widthFeatures = features.filter(
    (feature) =>
      feature.id.startsWith("bands_") && feature.id.endsWith("_width_pct"),
  );
  for (let left = 0; left < widthFeatures.length && left < 4; left++) {
    for (
      let right = left + 1;
      right < widthFeatures.length && right < 4;
      right++
    ) {
      const a = widthFeatures[left];
      const b = widthFeatures[right];
      const aValues = matrix[a.id] as (number | undefined)[];
      const bValues = matrix[b.id] as (number | undefined)[];
      const id = `band_width_ratio_${left}_${right}`;
      features.push(
        makeFeature(
          definitions.values().next().value as IndicatorDefinition,
          id,
          `${a.name} Relative to ${b.name}`,
          "Relative nesting/width of two uploaded envelopes.",
          "numeric",
          `${a.id} / ${b.id}`,
          "normalized-value",
          RELATIONSHIP_CATEGORY,
        ),
      );
      matrix[id] = aValues.map((value, index) => {
        const denominator = bValues[index];
        return value != null &&
          denominator != null &&
          Math.abs(denominator) > EPSILON
          ? value / denominator
          : undefined;
      });
    }
  }
}

function addSeriesRelationships(
  dataset: Dataset,
  definitions: Map<string, IndicatorDefinition>,
  features: Feature[],
  matrix: FeatureMatrix,
): void {
  const eligible = dataset.columns.filter((column) => {
    if (column.type !== "numeric" || !dataset.columnValues?.[column.key]) {
      return false;
    }
    const role = definitions.get(column.key)?.role;
    return ![
      "price-level",
      "upper-band",
      "lower-band",
      "basis",
      "binary-event",
    ].includes(role ?? "");
  });
  let pairCount = 0;
  for (let left = 0; left < eligible.length && pairCount < 12; left++) {
    for (
      let right = left + 1;
      right < eligible.length && pairCount < 12;
      right++
    ) {
      const a = eligible[left];
      const b = eligible[right];
      const aValues = dataset.columnValues?.[a.key];
      const bValues = dataset.columnValues?.[b.key];
      const definition = definitions.get(a.key);
      if (!aValues || !bValues || !definition) continue;
      pairCount++;
      const base = `pair_${a.key}_${b.key}`;
      const spread = aValues.map((value, index) =>
        Number.isFinite(value) && Number.isFinite(bValues[index])
          ? value - bValues[index]
          : Number.NaN,
      );
      const relationship = spread.map((value) =>
        !Number.isFinite(value)
          ? undefined
          : Math.abs(value) <= EPSILON
            ? "Equal"
            : value > 0
              ? `${a.label} above ${b.label}`
              : `${a.label} below ${b.label}`,
      );
      const crossing = spread.map((value, index) => {
        if (
          index === 0 ||
          !Number.isFinite(value) ||
          !Number.isFinite(spread[index - 1])
        ) {
          return "No cross";
        }
        if (spread[index - 1] <= 0 && value > 0) {
          return `${a.label} crossed above ${b.label}`;
        }
        if (spread[index - 1] >= 0 && value < 0) {
          return `${a.label} crossed below ${b.label}`;
        }
        return "No cross";
      });
      const relationFeature = makeFeature(
        definition,
        `${base}_relationship`,
        `${a.label} / ${b.label} Relationship`,
        `Relative ordering of "${a.label}" and "${b.label}".`,
        "categorical",
        `${a.label} compared with ${b.label}`,
        "normalized-value",
        RELATIONSHIP_CATEGORY,
      );
      const crossFeature = makeFeature(
        definition,
        `${base}_cross`,
        `${a.label} / ${b.label} Cross`,
        `Crossover events between "${a.label}" and "${b.label}".`,
        "categorical",
        `cross(${a.label}, ${b.label})`,
        "cross",
        RELATIONSHIP_CATEGORY,
      );
      const spreadFeature = makeFeature(
        definition,
        `${base}_spread_z`,
        `${a.label} / ${b.label} Spread Z-Score`,
        `Standardized separation between "${a.label}" and "${b.label}", avoiding literal scale assumptions.`,
        "numeric",
        `zscore(${a.label} - ${b.label}, 50)`,
        "zscore",
        RELATIONSHIP_CATEGORY,
      );
      features.push(relationFeature, crossFeature, spreadFeature);
      matrix[relationFeature.id] = relationship;
      matrix[crossFeature.id] = crossing;
      matrix[spreadFeature.id] = spread.map((_, index) =>
        rollingZScore(spread, index),
      );
      addRecentEventFeature(
        definition,
        crossFeature,
        crossing,
        features,
        matrix,
      );
    }
  }
}

/**
 * Converts every imported column through a versioned definition, then emits
 * scale-independent relationships and causal event primitives. Raw price
 * levels and cumulative totals never enter discovery directly.
 */
export function deriveSemanticColumnFeatures(dataset: Dataset): {
  features: Feature[];
  matrix: FeatureMatrix;
  semantics: Record<string, ColumnSemantic>;
  definitions: Record<string, IndicatorDefinition>;
} {
  const features: Feature[] = [];
  const matrix: FeatureMatrix = {};
  const semantics: Record<string, ColumnSemantic> = {};
  const definitions: Record<string, IndicatorDefinition> = {};
  const definitionMap = new Map<string, IndicatorDefinition>();
  const atr = atrSeries(dataset);
  const closeValues = dataset.bars.map((bar) => bar.close);

  for (const column of dataset.columns) {
    if (column.type !== "numeric") continue;
    const values = dataset.columnValues?.[column.key];
    if (!values) continue;
    const definition = resolveDefinition(
      column.definitionId,
      column.label,
      values,
    );
    column.definitionId = definition.id;
    column.semantic = definition.semantic;
    semantics[column.key] = definition.semantic;
    definitions[column.key] = definition;
    definitionMap.set(column.key, definition);
    const base = `custom_${column.key}`;
    const label = column.label;
    const add = (candidate: Feature, series: FeatureMatrix[string]) => {
      features.push(candidate);
      matrix[candidate.id] = series;
    };

    if (definition.role === "binary-event") {
      const state = makeFeature(
        definition,
        `${base}_state`,
        `${label} State`,
        `Whether imported event "${label}" is off, positive/on, or negative/on.`,
        "categorical",
        `${label} mapped by sign`,
        "persistence",
        IMPORTED_CATEGORY,
        ["Off", "Positive / On", "Negative / On"],
      );
      add(
        state,
        values.map((value) =>
          Number.isFinite(value) ? eventState(value) : undefined,
        ),
      );
      addRecentEventFeature(
        definition,
        state,
        matrix[state.id],
        features,
        matrix,
      );
      continue;
    }

    if (
      ["price-level", "upper-band", "lower-band", "basis"].includes(
        definition.role,
      ) &&
      dataset.hasOHLC
    ) {
      const events = priceLevelEvents(dataset, values, atr);
      const candidates: Array<[Feature, FeatureMatrix[string]]> = [
        [
          makeFeature(
            definition,
            `${base}_distance_pct`,
            `Distance from ${label} %`,
            `Close relative to "${label}" as a percentage of price.`,
            "numeric",
            `(close - ${label}) / abs(close) * 100`,
            "normalized-value",
            RELATIONSHIP_CATEGORY,
          ),
          events.distancePct,
        ],
        [
          makeFeature(
            definition,
            `${base}_distance_atr`,
            `Distance from ${label} (ATR)`,
            `Close relative to "${label}" in current ATR units.`,
            "numeric",
            `(close - ${label}) / ATR(14)`,
            "normalized-value",
            RELATIONSHIP_CATEGORY,
          ),
          events.distanceAtr,
        ],
        [
          makeFeature(
            definition,
            `${base}_relation`,
            `${label} Relationship`,
            `Whether price is above, below, or touching "${label}".`,
            "categorical",
            `close compared with ${label}`,
            "touch",
            RELATIONSHIP_CATEGORY,
            ["Below level", "At level", "Above level"],
          ),
          events.relation,
        ],
        [
          makeFeature(
            definition,
            `${base}_cross`,
            `${label} Cross`,
            `Whether price crossed "${label}".`,
            "categorical",
            `cross(close, ${label})`,
            "cross",
            RELATIONSHIP_CATEGORY,
            ["No cross", "Crossed above", "Crossed below"],
          ),
          events.cross,
        ],
        [
          makeFeature(
            definition,
            `${base}_touch`,
            `${label} Touch`,
            `Whether the candle range touched "${label}".`,
            "categorical",
            `low <= ${label} <= high with ATR tolerance`,
            "touch",
            RELATIONSHIP_CATEGORY,
            ["No touch", "Touched"],
          ),
          events.touch,
        ],
        [
          makeFeature(
            definition,
            `${base}_rejection`,
            `${label} Rejection`,
            `Whether price touched and closed back away from "${label}".`,
            "categorical",
            `touch(${label}) and close returns to origin side`,
            "rejection",
            RELATIONSHIP_CATEGORY,
            ["No rejection", "Rejected upward", "Rejected downward"],
          ),
          events.rejection,
        ],
        [
          makeFeature(
            definition,
            `${base}_breakout`,
            `${label} Breakout / Failure`,
            `Breakout, failed breakout, and reclaim state around "${label}".`,
            "categorical",
            `cross and hold/reclaim around ${label}`,
            "failed-breakout",
            RELATIONSHIP_CATEGORY,
            [
              "No breakout",
              "Broke above",
              "Broke below",
              "Failed above / reclaimed below",
              "Failed below / reclaimed above",
            ],
          ),
          events.breakout,
        ],
      ];
      for (const [candidate, series] of candidates) add(candidate, series);
      for (const [candidate, series] of candidates.slice(3)) {
        addRecentEventFeature(definition, candidate, series, features, matrix);
      }
      continue;
    }

    const numericValues = values.map((value) =>
      Number.isFinite(value) ? value : Number.NaN,
    );
    const changes = numericValues.map((value, index) =>
      index > 0 &&
      Number.isFinite(value) &&
      Number.isFinite(numericValues[index - 1])
        ? value - numericValues[index - 1]
        : Number.NaN,
    );
    const percentiles = numericValues.map((_, index) =>
      rollingPercentile(numericValues, index),
    );
    const directions = directionSeries(numericValues);
    const slopes = slopeSeries(numericValues);
    const accelerations = accelerationSeries(slopes);
    const persistence = persistenceSeries(directions);

    // Only explicitly stationary definitions retain a raw-value feature.
    if (definition.stationary) {
      add(
        makeFeature(
          definition,
          `${base}_value`,
          label,
          `Contextual value of imported "${label}".`,
          "numeric",
          `${label} raw value (definition marks it stationary)`,
          "normalized-value",
        ),
        values.map((value) => (Number.isFinite(value) ? value : undefined)),
      );
    } else {
      add(
        makeFeature(
          definition,
          `${base}_change_z`,
          `${label} Change Z-Score`,
          `Standardized change in "${label}" versus its recent history.`,
          "numeric",
          `zscore(change(${label}), 50)`,
          "zscore",
        ),
        changes.map((_, index) => rollingZScore(changes, index)),
      );
    }
    add(
      makeFeature(
        definition,
        `${base}_percentile`,
        `${label} Rolling Percentile`,
        `Where "${label}" ranks within its most recent 100 observations.`,
        "numeric",
        `rolling_percentile(${label}, 100)`,
        "percentile",
      ),
      percentiles,
    );
    add(
      makeFeature(
        definition,
        `${base}_direction`,
        `${label} Direction`,
        `Whether "${label}" is rising, falling, or flat.`,
        "categorical",
        `${label}[t] compared with ${label}[t-1]`,
        "direction",
        IMPORTED_CATEGORY,
        ["Falling", "Flat", "Rising"],
      ),
      directions,
    );
    add(
      makeFeature(
        definition,
        `${base}_slope`,
        `${label} Normalized Slope`,
        `Five-observation rate of change in "${label}", normalized to its own scale.`,
        "numeric",
        `percent_change(${label}, 5) / 5`,
        "slope",
      ),
      slopes,
    );
    add(
      makeFeature(
        definition,
        `${base}_acceleration`,
        `${label} Acceleration`,
        `Change in the normalized slope of "${label}".`,
        "numeric",
        `change(normalized_slope(${label}, 5))`,
        "acceleration",
      ),
      accelerations,
    );
    add(
      makeFeature(
        definition,
        `${base}_persistence`,
        `${label} Direction Persistence`,
        `Number of consecutive observations "${label}" has maintained its current direction.`,
        "numeric",
        `consecutive_count(direction(${label}))`,
        "persistence",
      ),
      persistence,
    );
    add(
      makeFeature(
        definition,
        `${base}_regime_transition`,
        `${label} Regime Transition`,
        "Transition between low, middle, and high rolling-percentile regimes.",
        "categorical",
        `transition(percentile_zone(${label}))`,
        "regime-transition",
        IMPORTED_CATEGORY,
      ),
      regimeSeries(percentiles),
    );

    if (definition.role === "oscillator") {
      const finite = finiteValues(values);
      const lower = definition.expectedRange?.[0] ?? quantile(finite, 0.2);
      const upper = definition.expectedRange?.[1] ?? quantile(finite, 0.8);
      const lowThreshold = definition.expectedRange
        ? lower + (upper - lower) * 0.2
        : lower;
      const highThreshold = definition.expectedRange
        ? lower + (upper - lower) * 0.8
        : upper;
      add(
        makeFeature(
          definition,
          `${base}_zone`,
          `${label} Zone`,
          `Low, middle, or high state for "${label}" using its definition or observed distribution.`,
          "categorical",
          `${label} <= low threshold, >= high threshold, otherwise Middle`,
          "regime-transition",
          IMPORTED_CATEGORY,
          ["Low", "Middle", "High"],
        ),
        values.map((value) =>
          !Number.isFinite(value)
            ? undefined
            : value <= lowThreshold
              ? "Low"
              : value >= highThreshold
                ? "High"
                : "Middle",
        ),
      );
    }

    if (
      dataset.hasOHLC &&
      definition.supportedRelationships.includes("divergence")
    ) {
      const divergence = makeFeature(
        definition,
        `${base}_price_divergence`,
        `Price / ${label} Divergence`,
        `Causally confirmed regular or hidden divergence between price pivots and "${label}". The event appears only after the pivot is confirmed.`,
        "categorical",
        `compare consecutive confirmed price pivots with ${label} at those pivot timestamps`,
        "divergence",
        DIVERGENCE_CATEGORY,
        [
          "None",
          "Regular bullish divergence",
          "Hidden bullish divergence",
          "Regular bearish divergence",
          "Hidden bearish divergence",
          "Bearish downside convergence",
          "Bullish higher-low convergence",
          "Bullish upside convergence",
          "Bearish lower-high convergence",
        ],
      );
      const series = divergenceSeries(closeValues, numericValues);
      add(divergence, series);
      addRecentEventFeature(definition, divergence, series, features, matrix);
    }
  }

  if (dataset.hasOHLC) {
    addBandRelationships(dataset, definitionMap, atr, features, matrix);
  }
  addSeriesRelationships(dataset, definitionMap, features, matrix);

  // Width acceleration is useful for expansion timing and stays bounded in
  // count by the number of uploaded envelope pairs.
  for (const feature of [...features]) {
    if (!feature.id.startsWith("bands_") || !feature.id.endsWith("_width_pct"))
      continue;
    const values = (matrix[feature.id] as (number | undefined)[]).map(
      (value) => value ?? Number.NaN,
    );
    const widthSlope = slopeSeries(values, 3);
    const id = `${feature.id}_acceleration`;
    features.push({
      ...feature,
      id,
      name: `${feature.name} Expansion Acceleration`,
      description: `Whether expansion or compression in "${feature.name}" is speeding up or slowing down.`,
      formula: `change(normalized_slope(${feature.id}, 3))`,
      primitive: "acceleration",
    });
    matrix[id] = accelerationSeries(widthSlope);
  }

  return { features, matrix, semantics, definitions };
}
