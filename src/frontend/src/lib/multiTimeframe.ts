import type { Dataset, Feature, FeatureMatrix, Timeframe } from "@/types";

export function datasetIntervalMs(dataset: Dataset): number {
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
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "1d": 24 * 60 * 60_000,
    unknown: 60_000,
  };
  return fallback[dataset.timeframe];
}

function contextPrefix(dataset: Dataset): string {
  return `mtf__${dataset.id.replace(/[^a-zA-Z0-9_]/g, "_")}__`;
}

function completedSourceIndexByTarget(
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

export interface ResearchSpace {
  features: Feature[];
  matrix: FeatureMatrix;
  contextDatasetIds: string[];
  totalSourceBars: number;
}

/**
 * Builds the actual discovery design matrix. The active dataset supplies the
 * prediction target; every other selected dataset contributes its latest
 * causally completed state at each active-bar decision time.
 */
export function buildMultiTimeframeResearchSpace(
  target: Dataset,
  selectedDatasets: Dataset[],
  featuresByDataset: Record<string, Feature[]>,
  matricesByDataset: Record<string, FeatureMatrix>,
  discoveryTargetId: string = target.id,
): ResearchSpace {
  const targetFeatures = featuresByDataset[target.id] ?? [];
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
      const aligned = alignedIndices.map((sourceIndex) =>
        sourceIndex >= 0 ? sourceValues[sourceIndex] : undefined,
      );
      if (!aligned.some((value) => value != null)) continue;
      features.push({
        ...sourceFeature,
        id,
        name: `[${source.timeframe} · ${sourceLabel}] ${sourceFeature.name}`,
        category: "Multi-Timeframe",
        description: `${sourceFeature.description} Causally aligned from "${sourceLabel}" (${source.timeframe}); only a source bar completed by the target decision time is used.`,
        formula: `latest completed ${source.timeframe} value of (${sourceFeature.formula ?? sourceFeature.name})`,
        semantic: "multi-timeframe",
        originDatasetId: source.id,
        originTimeframe: source.timeframe,
      });
      matrix[id] = aligned;
    }
    addDevelopingHigherTimeframeFeatures(
      target,
      source,
      alignedIndices,
      features,
      matrix,
      prefix,
    );
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
