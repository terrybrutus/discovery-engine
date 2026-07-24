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
