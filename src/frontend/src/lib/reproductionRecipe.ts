import type {
  Condition,
  Feature,
  ReproductionCondition,
  ReproductionRecipe,
} from "@/types";

function formatValue(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "unknown";
  const absolute = Math.abs(value);
  const digits = absolute >= 100 ? 2 : absolute >= 1 ? 3 : 4;
  return Number(value.toFixed(digits)).toString();
}

function conditionExpression(
  condition: Condition,
  featureName: string,
): string {
  if (condition.operator === "eq" && condition.bucketLabel != null) {
    return `${featureName} = ${condition.bucketLabel}`;
  }
  if (condition.operator === "neq" && condition.bucketLabel != null) {
    return `${featureName} ≠ ${condition.bucketLabel}`;
  }
  const value = formatValue(condition.value);
  const highValue = formatValue(condition.highValue);
  switch (condition.operator) {
    case "eq":
      return `${featureName} = ${value}`;
    case "neq":
      return `${featureName} ≠ ${value}`;
    case "gt":
      return `${featureName} > ${value}`;
    case "gte":
      return `${featureName} ≥ ${value}`;
    case "lt":
      return `${featureName} < ${value}`;
    case "lte":
      return `${featureName} ≤ ${value}`;
    case "between":
      return `${featureName} between ${value} and ${highValue}`;
  }
}

export function buildReproductionRecipe(
  conditions: Condition[],
  features: Feature[],
  horizon: number,
): ReproductionRecipe {
  const featuresById = new Map(
    features.map((feature) => [feature.id, feature]),
  );
  const recipeConditions: ReproductionCondition[] = conditions.map(
    (condition) => {
      const feature = featuresById.get(condition.featureId);
      const featureName = feature?.name ?? condition.featureId;
      return {
        featureId: condition.featureId,
        featureName,
        expression: conditionExpression(condition, featureName),
        formula: feature?.formula,
        description: feature?.description,
        source: feature?.source ?? "builtin",
        definitionId: feature?.definitionId,
        definitionName: feature?.definitionName,
        definitionParameters: feature?.definitionParameters
          ? { ...feature.definitionParameters }
          : undefined,
        definitionConfidence: feature?.definitionConfidence,
        definitionReviewed: feature?.definitionReviewed,
        primitive: feature?.primitive,
        originDatasetId: feature?.originDatasetId,
        originTimeframe: feature?.originTimeframe,
      };
    },
  );

  const incomplete = recipeConditions.some((condition) => !condition.formula);
  const missingCustomSettings = recipeConditions.some(
    (condition) =>
      condition.source === "custom" &&
      (!condition.definitionParameters ||
        Object.keys(condition.definitionParameters).length === 0),
  );
  const portability = incomplete
    ? "incomplete"
    : missingCustomSettings
      ? "source-settings-required"
      : "portable";

  return {
    conditions: recipeConditions,
    signalTiming:
      "Evaluate every condition after the target observation closes; no future observation is used to form the signal.",
    researchEntry:
      "The reported return begins at that signal observation's closing value.",
    researchExit: `The reported return ends at the closing value ${horizon} target observations later.`,
    strategyEntryWarning:
      "Entering at the next observation's open is a more executable strategy test, but it is not identical to the reported close-to-close statistic and must be re-tested separately.",
    overlapRule:
      "Every-match statistics count every qualifying observation. The non-overlapping view accepts the first signal, then ignores new signals until the fixed hold ends.",
    portability,
    portabilityNote:
      portability === "portable"
        ? "The stored formulas and definition parameters are sufficient to rebuild this candidate, subject to matching data/session conventions."
        : portability === "source-settings-required"
          ? "The result is exactly reproducible from the uploaded columns, but recreating the underlying indicator in TradingView still requires its source settings or Pine inputs."
          : "One or more feature formulas are missing. Treat this as descriptive until discovery is rerun with complete feature lineage.",
  };
}

export function formatDefinitionParameters(
  parameters: Record<string, string | number | boolean> | undefined,
): string {
  if (!parameters || Object.keys(parameters).length === 0) {
    return "Not stored";
  }
  return Object.entries(parameters)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}
