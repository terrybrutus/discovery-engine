import type { Condition, Feature, Timeframe } from "@/types";

export function resolvePatternConfluence(
  conditions: Condition[],
  features: Feature[],
): {
  datasetIds: string[];
  timeframes: Timeframe[];
} {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const conditionFeatures = conditions
    .map((condition) => byId.get(condition.featureId))
    .filter((feature): feature is Feature => Boolean(feature));
  return {
    datasetIds: [
      ...new Set(
        conditionFeatures
          .map((feature) => feature.originDatasetId)
          .filter((id): id is string => Boolean(id)),
      ),
    ],
    timeframes: [
      ...new Set(
        conditionFeatures
          .map((feature) => feature.originTimeframe)
          .filter((timeframe): timeframe is Timeframe => Boolean(timeframe)),
      ),
    ],
  };
}

export function meetsConfluenceRequirement(
  conditions: Condition[],
  features: Feature[],
  minimumSources: number,
): boolean {
  return (
    resolvePatternConfluence(conditions, features).datasetIds.length >=
    minimumSources
  );
}
