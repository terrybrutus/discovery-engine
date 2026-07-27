import type { Dataset, Feature, FeatureMatrix, Timeframe } from "@/types";

export function datasetIntervalMs(dataset: Dataset): number {
  if (Number.isFinite(dataset.intervalMs) && dataset.intervalMs > 0) {
    return dataset.intervalMs;
  }
  const deltas: number[] = [];
  for (let i = 1; i < Math.min(dataset.bars.length, 200); i++) {
    const delta = dataset.bars[i].timestamp - dataset.bars[i - 1].timestamp;
    if (delta > 0) deltas.push(delta);
  }
  if (deltas.length > 0) {
    deltas.sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)];
  }
  const fallback: Record<Timeframe, number> = {
    "1m": 60_000,
    "3m": 3 * 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "30m": 30 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
    "1w": 7 * 24 * 60 * 60_000,
    unknown: 60_000,
  };
  return fallback[dataset.timeframe];
}

/**
 * Array-compatible, read-only aligned series. Values are resolved through the
 * shared timestamp index only when discovery reads them, so a source feature
 * is never copied into another full target-length array.
 */
function lazyAlignedSeries(
  sourceValues: FeatureMatrix[string],
  alignedIndices: number[],
): FeatureMatrix[string] {
  const target = new Array<number | string | undefined>(alignedIndices.length);
  return new Proxy(target, {
    get(array, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) {
        const targetIndex = Number(property);
        const sourceIndex = alignedIndices[targetIndex] ?? -1;
        return sourceIndex >= 0 ? sourceValues[sourceIndex] : undefined;
      }
      return Reflect.get(array, property, receiver);
    },
    has(array, property) {
      if (typeof property === "string" && /^\d+$/.test(property)) {
        const index = Number(property);
        return index >= 0 && index < alignedIndices.length;
      }
      return Reflect.has(array, property);
    },
    set() {
      return false;
    },
  });
}

function contextPrefix(dataset: Dataset): string {
  return `mtf__${dataset.id.replace(/[^a-zA-Z0-9_]/g, "_")}__`;
}

export function completedSourceIndexByTarget(
  target: Dataset,
  source: Dataset,
): number[] {
  const targetInterval = datasetIntervalMs(target);
  const sourceInterval = datasetIntervalMs(source);
  const indices = new Array<number>(target.bars.length).fill(-1);
  let sourceIndex = -1;
  for (let targetIndex = 0; targetIndex < target.bars.length; targetIndex++) {
    const decisionTime = target.bars[targetIndex].timestamp + targetInterval;
    while (
      sourceIndex + 1 < source.bars.length &&
      source.bars[sourceIndex + 1].timestamp + sourceInterval <= decisionTime
    ) {
      sourceIndex++;
    }
    indices[targetIndex] = sourceIndex;
  }
  return indices;
}

function addDevelopingHigherTimeframeFeatures(
  target: Dataset,
  source: Dataset,
  alignedIndices: number[],
  features: Feature[],
  matrix: FeatureMatrix,
  prefix: string,
): void {
  const targetInterval = datasetIntervalMs(target);
  const sourceInterval = datasetIntervalMs(source);
  if (sourceInterval <= targetInterval) return;

  const progress: (number | undefined)[] = [];
  const bodyPct: (number | undefined)[] = [];
  const rangePct: (number | undefined)[] = [];
  const location: (number | undefined)[] = [];
  const event: (string | undefined)[] = [];
  let formingStart = Number.NaN;
  let open = 0;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let firstHighTouch = -1;
  let firstLowTouch = -1;

  for (let i = 0; i < target.bars.length; i++) {
    const completedIndex = alignedIndices[i];
    const candidate = source.bars[completedIndex + 1];
    const decisionTime = target.bars[i].timestamp + targetInterval;
    if (
      !candidate ||
      candidate.timestamp >= decisionTime ||
      decisionTime > candidate.timestamp + sourceInterval
    ) {
      progress.push(undefined);
      bodyPct.push(undefined);
      rangePct.push(undefined);
      location.push(undefined);
      event.push(undefined);
      continue;
    }

    if (candidate.timestamp !== formingStart) {
      formingStart = candidate.timestamp;
      open = target.bars[i].open;
      high = Number.NEGATIVE_INFINITY;
      low = Number.POSITIVE_INFINITY;
      firstHighTouch = -1;
      firstLowTouch = -1;
    }
    const bar = target.bars[i];
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
    const previous = completedIndex >= 0 ? source.bars[completedIndex] : null;
    if (previous && firstHighTouch < 0 && bar.high > previous.high) {
      firstHighTouch = i;
    }
    if (previous && firstLowTouch < 0 && bar.low < previous.low) {
      firstLowTouch = i;
    }
    const span = high - low;
    progress.push(
      Math.min(100, ((decisionTime - formingStart) / sourceInterval) * 100),
    );
    bodyPct.push(open !== 0 ? ((bar.close - open) / Math.abs(open)) * 100 : 0);
    rangePct.push(open !== 0 ? (span / Math.abs(open)) * 100 : 0);
    location.push(span > 0 ? ((bar.close - low) / span) * 100 : 50);
    event.push(
      firstHighTouch >= 0 && firstLowTouch >= 0
        ? firstHighTouch < firstLowTouch
          ? "Swept prior high before prior low"
          : "Swept prior low before prior high"
        : firstHighTouch >= 0
          ? "Swept prior high"
          : firstLowTouch >= 0
            ? "Swept prior low"
            : "Inside prior range",
    );
  }

  const sourceLabel = source.label ?? source.name;
  const add = (
    suffix: string,
    name: string,
    description: string,
    type: Feature["type"],
    values: FeatureMatrix[string],
    buckets?: string[],
  ) => {
    const id = `${prefix}developing_${suffix}`;
    features.push({
      id,
      name: `[${source.timeframe} · ${sourceLabel}] Developing ${name}`,
      category: "Multi-Timeframe",
      description,
      type,
      enabled: true,
      source: "builtin",
      semantic: "multi-timeframe",
      originDatasetId: source.id,
      originTimeframe: source.timeframe,
      buckets,
      formula: `reconstructed from completed ${target.timeframe} intrabars only`,
    });
    matrix[id] = values;
  };
  add(
    "progress",
    "Candle Progress %",
    `Elapsed portion of the currently forming ${source.timeframe} candle.`,
    "numeric",
    progress,
  );
  add(
    "body_pct",
    "Body %",
    `Developing ${source.timeframe} body reconstructed without future intrabars.`,
    "numeric",
    bodyPct,
  );
  add(
    "range_pct",
    "Range %",
    `Developing ${source.timeframe} range reconstructed without future intrabars.`,
    "numeric",
    rangePct,
  );
  add(
    "location",
    "Close Location",
    `Current close location inside the reconstructed ${source.timeframe} range.`,
    "numeric",
    location,
  );
  add(
    "event_order",
    "Sweep Order",
    `Order in which completed intrabars crossed the prior ${source.timeframe} high and low.`,
    "categorical",
    event,
    [
      "Inside prior range",
      "Swept prior high",
      "Swept prior low",
      "Swept prior high before prior low",
      "Swept prior low before prior high",
    ],
  );
}

function addCompletedLowerTimeframePathFeatures(
  target: Dataset,
  source: Dataset,
  features: Feature[],
  matrix: FeatureMatrix,
  prefix: string,
): void {
  const targetInterval = datasetIntervalMs(target);
  const sourceInterval = datasetIntervalMs(source);
  if (
    sourceInterval >= targetInterval ||
    target.instrumentKey !== source.instrumentKey
  ) {
    return;
  }

  const expectedCount = Math.max(
    1,
    Math.round(targetInterval / sourceInterval),
  );
  const coverage: (number | undefined)[] = [];
  const highLowOrder: (string | undefined)[] = [];
  const sweepOrder: (string | undefined)[] = [];
  const efficiency: (number | undefined)[] = [];
  const directionChanges: (number | undefined)[] = [];
  const upExcursion: (number | undefined)[] = [];
  const downExcursion: (number | undefined)[] = [];
  let sourceStartIndex = 0;

  for (let targetIndex = 0; targetIndex < target.bars.length; targetIndex++) {
    const targetBar = target.bars[targetIndex];
    const targetStart = targetBar.timestamp;
    const targetEnd = targetStart + targetInterval;
    while (
      sourceStartIndex < source.bars.length &&
      source.bars[sourceStartIndex].timestamp + sourceInterval <= targetStart
    ) {
      sourceStartIndex++;
    }
    const intrabars: Dataset["bars"] = [];
    for (
      let sourceIndex = sourceStartIndex;
      sourceIndex < source.bars.length;
      sourceIndex++
    ) {
      const sourceBar = source.bars[sourceIndex];
      if (sourceBar.timestamp >= targetEnd) break;
      if (
        sourceBar.timestamp >= targetStart &&
        sourceBar.timestamp + sourceInterval <= targetEnd
      ) {
        intrabars.push(sourceBar);
      }
    }
    if (intrabars.length === 0) {
      coverage.push(undefined);
      highLowOrder.push(undefined);
      sweepOrder.push(undefined);
      efficiency.push(undefined);
      directionChanges.push(undefined);
      upExcursion.push(undefined);
      downExcursion.push(undefined);
      continue;
    }

    coverage.push(Math.min(100, (intrabars.length / expectedCount) * 100));
    let highestIndex = 0;
    let lowestIndex = 0;
    let highest = intrabars[0].high;
    let lowest = intrabars[0].low;
    let pathDistance = Math.abs(intrabars[0].close - intrabars[0].open);
    let changes = 0;
    let previousDirection = Math.sign(intrabars[0].close - intrabars[0].open);
    for (let index = 1; index < intrabars.length; index++) {
      const bar = intrabars[index];
      if (bar.high > highest) {
        highest = bar.high;
        highestIndex = index;
      }
      if (bar.low < lowest) {
        lowest = bar.low;
        lowestIndex = index;
      }
      pathDistance += Math.abs(bar.close - intrabars[index - 1].close);
      const direction = Math.sign(bar.close - intrabars[index - 1].close);
      if (
        direction !== 0 &&
        previousDirection !== 0 &&
        direction !== previousDirection
      ) {
        changes++;
      }
      if (direction !== 0) previousDirection = direction;
    }
    highLowOrder.push(
      highestIndex === lowestIndex
        ? "High and low in same intrabar"
        : highestIndex < lowestIndex
          ? "High before low"
          : "Low before high",
    );

    const previousTarget =
      targetIndex > 0 ? target.bars[targetIndex - 1] : undefined;
    let firstHighSweep = -1;
    let firstLowSweep = -1;
    if (previousTarget) {
      for (let index = 0; index < intrabars.length; index++) {
        if (firstHighSweep < 0 && intrabars[index].high > previousTarget.high) {
          firstHighSweep = index;
        }
        if (firstLowSweep < 0 && intrabars[index].low < previousTarget.low) {
          firstLowSweep = index;
        }
      }
    }
    sweepOrder.push(
      firstHighSweep >= 0 && firstLowSweep >= 0
        ? firstHighSweep === firstLowSweep
          ? "Both swept in same intrabar"
          : firstHighSweep < firstLowSweep
            ? "Prior high swept before prior low"
            : "Prior low swept before prior high"
        : firstHighSweep >= 0
          ? "Prior high swept only"
          : firstLowSweep >= 0
            ? "Prior low swept only"
            : "No prior-range sweep",
    );
    const firstOpen = intrabars[0].open;
    const lastClose = intrabars[intrabars.length - 1].close;
    const scale = Math.max(Math.abs(firstOpen), 1e-9);
    efficiency.push(
      pathDistance > 0
        ? (Math.abs(lastClose - firstOpen) / pathDistance) * 100
        : 0,
    );
    directionChanges.push(changes);
    upExcursion.push(((highest - firstOpen) / scale) * 100);
    downExcursion.push(((firstOpen - lowest) / scale) * 100);
  }

  const sourceLabel = source.label ?? source.name;
  const add = (
    suffix: string,
    name: string,
    description: string,
    type: Feature["type"],
    values: FeatureMatrix[string],
    formula: string,
    buckets?: string[],
  ) => {
    const id = `${prefix}intrabar_${suffix}`;
    features.push({
      id,
      name: `[${source.timeframe} · ${sourceLabel}] Intrabar ${name}`,
      category: "Multi-Timeframe",
      description,
      type,
      enabled: true,
      source: "builtin",
      semantic: "multi-timeframe",
      originDatasetId: source.id,
      originTimeframe: source.timeframe,
      formula,
      buckets,
    });
    matrix[id] = values;
  };
  add(
    "coverage",
    "Coverage %",
    `Share of the expected ${source.timeframe} bars fully contained inside each completed ${target.timeframe} target bar.`,
    "numeric",
    coverage,
    `completed ${source.timeframe} intrabar count / expected count (${expectedCount}) * 100`,
  );
  add(
    "high_low_order",
    "High / Low Order",
    `Whether the final high or low of each ${target.timeframe} bar formed first on ${source.timeframe}.`,
    "categorical",
    highLowOrder,
    `timestamp order of max(high) and min(low) across contained ${source.timeframe} bars`,
    ["High before low", "Low before high", "High and low in same intrabar"],
  );
  add(
    "prior_range_sweep_order",
    "Prior Range Sweep Order",
    `Chronological order in which contained ${source.timeframe} bars swept the previous ${target.timeframe} high and low.`,
    "categorical",
    sweepOrder,
    `first contained ${source.timeframe} high > previous ${target.timeframe} high compared with first low < previous low`,
    [
      "No prior-range sweep",
      "Prior high swept only",
      "Prior low swept only",
      "Prior high swept before prior low",
      "Prior low swept before prior high",
      "Both swept in same intrabar",
    ],
  );
  add(
    "path_efficiency",
    "Path Efficiency %",
    "Net movement divided by total intrabar close-to-close travel; high values are directional and low values are choppy.",
    "numeric",
    efficiency,
    `abs(last ${source.timeframe} close - first open) / sum(abs(intrabar close changes)) * 100`,
  );
  add(
    "direction_changes",
    "Direction Changes",
    `Number of direction reversals inside the completed ${target.timeframe} bar at ${source.timeframe} resolution.`,
    "numeric",
    directionChanges,
    `count(sign change of consecutive ${source.timeframe} close changes)`,
  );
  add(
    "up_excursion_pct",
    "Up Excursion %",
    `Maximum upward excursion from the first contained ${source.timeframe} open.`,
    "numeric",
    upExcursion,
    "(max contained high - first open) / abs(first open) * 100",
  );
  add(
    "down_excursion_pct",
    "Down Excursion %",
    `Maximum downward excursion from the first contained ${source.timeframe} open.`,
    "numeric",
    downExcursion,
    "(first open - min contained low) / abs(first open) * 100",
  );
}

export interface ResearchSpace {
  features: Feature[];
  matrix: FeatureMatrix;
  contextDatasetIds: string[];
  totalSourceBars: number;
}

/**
 * Builds one bounded pass through the unified research universe. `target`
 * supplies that pass's outcome timeline; every other selected dataset
 * contributes its latest causally completed state at each decision time.
 */
export function buildMultiTimeframeResearchSpace(
  target: Dataset,
  selectedDatasets: Dataset[],
  featuresByDataset: Record<string, Feature[]>,
  matricesByDataset: Record<string, FeatureMatrix>,
  discoveryTargetId: string = target.id,
): ResearchSpace {
  const targetFeatures = (featuresByDataset[target.id] ?? []).map(
    (feature) => ({
      ...feature,
      originDatasetId: target.id,
      originTimeframe: target.timeframe,
    }),
  );
  const targetMatrix = matricesByDataset[target.id] ?? {};
  const features: Feature[] = [...targetFeatures];
  const matrix: FeatureMatrix = { ...targetMatrix };
  const contextDatasetIds: string[] = [];

  for (const source of selectedDatasets) {
    if (source.id === target.id && source.id === discoveryTargetId) continue;
    const sourceFeatures = featuresByDataset[source.id];
    const sourceMatrix = matricesByDataset[source.id];
    if (!sourceFeatures || !sourceMatrix || source.bars.length === 0) continue;

    const alignedIndices = completedSourceIndexByTarget(target, source);
    if (!alignedIndices.some((index) => index >= 0)) continue;
    contextDatasetIds.push(source.id);
    const prefix = contextPrefix(source);
    const sourceLabel = source.label ?? source.name;

    for (const sourceFeature of sourceFeatures) {
      const sourceValues = sourceMatrix[sourceFeature.id];
      if (!sourceValues) continue;
      const id = `${prefix}${sourceFeature.id}`;
      const aligned = lazyAlignedSeries(sourceValues, alignedIndices);
      features.push({
        ...sourceFeature,
        id,
        name: `[${source.timeframe} · ${sourceLabel}] ${sourceFeature.name}`,
        // Keep the source measurement's category so the user's research-lens
        // choices apply equally to target and context timelines. The
        // multi-timeframe nature is already represented by `semantic`,
        // `originDatasetId`, and `originTimeframe`; overwriting the category
        // here caused every higher-timeframe feature to bypass its original
        // category toggle whenever the required Multi-Timeframe lens was on.
        category: sourceFeature.category,
        description: `${sourceFeature.description} Causally aligned from "${sourceLabel}" (${source.timeframe}); only a source bar completed by the target decision time is used.`,
        formula: `latest completed ${source.timeframe} value of (${sourceFeature.formula ?? sourceFeature.name})`,
        semantic: "multi-timeframe",
        originDatasetId: source.id,
        originTimeframe: source.timeframe,
      });
      matrix[id] = aligned;
    }
    if (target.instrumentKey === source.instrumentKey) {
      // Execution-only price levels have no Feature record because absolute
      // levels must never become discovery thresholds. Only same-instrument
      // levels are meaningful as executable prices; excluding other symbols
      // also prevents a large cross-universe memory expansion.
      for (const [sourceKey, sourceValues] of Object.entries(sourceMatrix)) {
        if (!sourceKey.startsWith("__exit_level__")) continue;
        matrix[`${prefix}${sourceKey}`] = lazyAlignedSeries(
          sourceValues,
          alignedIndices,
        );
      }
      addDevelopingHigherTimeframeFeatures(
        target,
        source,
        alignedIndices,
        features,
        matrix,
        prefix,
      );
      addCompletedLowerTimeframePathFeatures(
        target,
        source,
        features,
        matrix,
        prefix,
      );
    }
  }

  return {
    features,
    matrix,
    contextDatasetIds,
    totalSourceBars: selectedDatasets.reduce(
      (sum, dataset) => sum + dataset.bars.length,
      0,
    ),
  };
}
