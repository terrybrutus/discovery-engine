import type { DiscoveryConfig, Pattern, TradeOutcomeSummary } from "@/types";

export type EconomicCushion =
  | "substantial cushion"
  | "promising"
  | "potentially usable but sensitive"
  | "fragile"
  | "cost estimate disabled";

export interface CostAdjustedSummary extends TradeOutcomeSummary {
  estimatedCostPct: number;
  avgNetMove: number;
  medianNetMove: number;
  grossCostMultiple: number | null;
  cushion: EconomicCushion;
}

export function selectedExecutionSummary(
  pattern: Pattern,
  view: DiscoveryConfig["executionView"],
): TradeOutcomeSummary | null {
  const comparison = pattern.executionComparison;
  if (!comparison) return null;
  return view === "every-match"
    ? comparison.everyMatch
    : comparison.nonOverlapping;
}

export function adjustForCosts(
  summary: TradeOutcomeSummary,
  roundTripCostBps: number,
): CostAdjustedSummary {
  const safeBps = Math.max(
    0,
    Number.isFinite(roundTripCostBps) ? roundTripCostBps : 0,
  );
  const estimatedCostPct = safeBps / 100;
  const grossCostMultiple =
    estimatedCostPct > 0 ? summary.avgGrossMove / estimatedCostPct : null;
  const cushion: EconomicCushion =
    grossCostMultiple == null
      ? "cost estimate disabled"
      : grossCostMultiple >= 5
        ? "substantial cushion"
        : grossCostMultiple >= 3
          ? "promising"
          : grossCostMultiple >= 2
            ? "potentially usable but sensitive"
            : "fragile";
  return {
    ...summary,
    estimatedCostPct,
    avgNetMove: summary.avgGrossMove - estimatedCostPct,
    medianNetMove: summary.medianGrossMove - estimatedCostPct,
    grossCostMultiple,
    cushion,
  };
}

export function passesEconomicFilter(
  pattern: Pattern,
  config: DiscoveryConfig,
): boolean {
  if (!config.costFilterEnabled) return true;
  const summary = selectedExecutionSummary(
    pattern,
    config.executionView ?? "non-overlapping",
  );
  if (!summary) return false;
  const adjusted = adjustForCosts(summary, config.roundTripCostBps ?? 0);
  const minimumNet = Math.max(0, config.minNetMovePct ?? 0);
  const minimumMultiple = Math.max(0, config.minGrossCostMultiple ?? 0);
  return (
    adjusted.avgNetMove >= minimumNet &&
    (adjusted.grossCostMultiple == null ||
      adjusted.grossCostMultiple >= minimumMultiple)
  );
}
