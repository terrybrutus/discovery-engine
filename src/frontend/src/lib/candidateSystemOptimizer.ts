import {
  type CandidateSimulationConfig,
  type CandidateSimulationResult,
  type SimulationFeatureExitOperator,
  listExitLevelCandidates,
  simulateCandidateSystem,
} from "@/lib/candidateSimulation";
import type {
  Feature,
  FeatureMatrix,
  MarketSessionConfig,
  OHLCVBar,
  Pattern,
} from "@/types";

export interface SystemOptimizerConfig {
  sealedHoldoutPct: number;
  walkForwardFolds: number;
  minDevelopmentTrades: number;
  minHoldoutTrades: number;
  minHoldoutExpectancyR: number;
  minHoldoutProfitFactor: number;
  costStressMultiplier: number;
  maxCandidates: number;
}

export interface WalkForwardSystemAudit {
  folds: number;
  profitableFolds: number;
  foldExpectancyR: number[];
  meanExpectancyR: number;
  worstExpectancyR: number;
  stabilityDeltaR: number;
}

export interface ExecutableSystemRecipe {
  title: string;
  oneSentenceRule: string;
  steps: string[];
  exactParameters: CandidateSimulationConfig;
  signalConditions: string[];
  targetDataset: string;
  targetTimeframe: string;
  machineReadable: {
    schema: "trading-discovery-executable-system";
    version: 1;
    patternId: string;
    direction: Pattern["direction"];
    conditions: Pattern["conditions"];
    config: CandidateSimulationConfig;
  };
}

export interface OptimizedSystemCandidate {
  id: string;
  developmentRank: number;
  config: CandidateSimulationConfig;
  development: CandidateSimulationResult;
  walkForward: WalkForwardSystemAudit;
  sealedHoldout: CandidateSimulationResult;
  costStressHoldout: CandidateSimulationResult;
  scoreBeforeHoldout: number;
  complexityPenalty: number;
  walkForwardPassed: boolean;
  sealedHoldoutPassed: boolean;
  eligible: boolean;
  labels: string[];
  recipe: ExecutableSystemRecipe;
}

export interface CandidateSystemOptimization {
  generatedAt: number;
  patternId: string;
  patternLabel: string;
  candidatesTested: number;
  preHoldoutEndIndex: number;
  sealedHoldoutStartIndex: number;
  sealedHoldoutPct: number;
  walkForwardFolds: number;
  recommendedCandidateId: string | null;
  candidates: OptimizedSystemCandidate[];
  methodology: string[];
  integrityWarning: string;
  exitSearch: {
    priceLevelsAvailable: number;
    indicatorEventsAvailable: number;
    testedFamilies: string[];
  };
}

export const DEFAULT_SYSTEM_OPTIMIZER_CONFIG: SystemOptimizerConfig = {
  sealedHoldoutPct: 20,
  walkForwardFolds: 4,
  minDevelopmentTrades: 50,
  minHoldoutTrades: 20,
  minHoldoutExpectancyR: 0.1,
  minHoldoutProfitFactor: 1.3,
  costStressMultiplier: 2,
  maxCandidates: 720,
};

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function patternSupportsBoxExecution(pattern: Pattern): boolean {
  const recipeText = [
    pattern.label,
    pattern.plainEnglishSentence,
    ...(pattern.reproductionRecipe?.conditions.map((condition) =>
      [
        condition.featureId,
        condition.featureName,
        condition.formula,
        condition.description,
      ].join(" "),
    ) ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    recipeText.includes("pds") ||
    recipeText.includes("previous session") ||
    recipeText.includes("session box") ||
    recipeText.includes("adjusted box")
  );
}

export interface ExitFeatureRule {
  featureId: string;
  featureLabel: string;
  operator: SimulationFeatureExitOperator;
  value: string | number;
}

function quantile(values: number[], percentile: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Builds causal indicator/relationship exit rules using development history
 * only. Categorical event states become close-based exits; stationary or
 * normalized numeric series become threshold-cross exits. The sealed holdout
 * never contributes values or thresholds.
 */
export function discoverExitFeatureRules(
  features: Feature[],
  matrix: FeatureMatrix,
  developmentEndIndex: number,
  maximum = 48,
): ExitFeatureRule[] {
  const rules: ExitFeatureRule[] = [];
  const end = Math.max(0, developmentEndIndex);
  const eventPrimitives = new Set([
    "cross",
    "touch",
    "rejection",
    "breakout",
    "failed-breakout",
    "regime-transition",
    "divergence",
    "convergence",
    "sequence",
    "direction",
  ]);
  const orderedFeatures = [...features].sort((left, right) => {
    const leftPriority =
      (left.source === "custom" ? 4 : 0) +
      (left.primitive === "cross" ||
      left.primitive === "rejection" ||
      left.primitive === "divergence"
        ? 2
        : 0);
    const rightPriority =
      (right.source === "custom" ? 4 : 0) +
      (right.primitive === "cross" ||
      right.primitive === "rejection" ||
      right.primitive === "divergence"
        ? 2
        : 0);
    return rightPriority - leftPriority;
  });
  for (const feature of orderedFeatures) {
    if (
      !feature.enabled ||
      feature.category === "Time" ||
      feature.category === "Calendar"
    ) {
      continue;
    }
    const series = matrix[feature.id];
    if (!series) continue;
    if (
      feature.type === "categorical" &&
      (eventPrimitives.has(feature.primitive ?? "") ||
        feature.source === "custom")
    ) {
      const counts = new Map<string, number>();
      let present = 0;
      for (let index = 0; index <= end; index++) {
        const value = series[index];
        if (typeof value !== "string") continue;
        present++;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      for (const [value, count] of counts) {
        if (
          count < 3 ||
          count > present * 0.45 ||
          /^(none|no |off|flat|inside|middle|unchanged)/i.test(value)
        ) {
          continue;
        }
        rules.push({
          featureId: feature.id,
          featureLabel: feature.name,
          operator: "eq",
          value,
        });
      }
      continue;
    }
    const numericExitCandidate =
      feature.type === "numeric" &&
      (feature.source === "custom" ||
        feature.role === "oscillator" ||
        feature.role === "percentage" ||
        feature.primitive === "percentile" ||
        feature.primitive === "normalized-value");
    if (!numericExitCandidate) continue;
    const values: number[] = [];
    for (let index = 0; index <= end; index++) {
      const value = series[index];
      if (typeof value === "number" && Number.isFinite(value)) {
        values.push(value);
      }
    }
    if (values.length < 30) continue;
    const thresholds = uniqueNumbers(
      [0.2, 0.5, 0.8]
        .map((percentile) => quantile(values, percentile))
        .filter(Number.isFinite)
        .map((value) => Number(value.toPrecision(8))),
    );
    for (const value of thresholds) {
      rules.push({
        featureId: feature.id,
        featureLabel: feature.name,
        operator: "cross-above",
        value,
      });
      rules.push({
        featureId: feature.id,
        featureLabel: feature.name,
        operator: "cross-below",
        value,
      });
    }
  }
  return rules
    .filter(
      (rule, index, all) =>
        all.findIndex(
          (other) =>
            other.featureId === rule.featureId &&
            other.operator === rule.operator &&
            other.value === rule.value,
        ) === index,
    )
    .slice(0, Math.max(0, maximum));
}

function buildConstrainedGrid(
  pattern: Pattern,
  base: CandidateSimulationConfig,
  matrix: FeatureMatrix,
  features: Feature[],
  developmentEndIndex: number,
  maximum: number,
): CandidateSimulationConfig[] {
  const box = patternSupportsBoxExecution(pattern);
  const entries: CandidateSimulationConfig["entryMode"][] = [
    "next-open",
    "signal-close",
    ...(box ? (["box-boundary-limit"] as const) : []),
  ];
  const pathStop = pattern.outcomeProfile?.medianMAE;
  const pathTarget = pattern.outcomeProfile?.medianMFE;
  const fixedStops = uniqueNumbers([
    0.1,
    0.25,
    0.5,
    1,
    ...(pathStop != null && pathStop >= 0.02 && pathStop <= 5
      ? [Number(pathStop.toFixed(3))]
      : []),
  ]);
  const stops: Array<
    Pick<
      CandidateSimulationConfig,
      "stopMode" | "stopPct" | "stopAtrMultiple"
    > &
      Partial<
        Pick<CandidateSimulationConfig, "stopFeatureId" | "stopFeatureLabel">
      >
  > = [
    ...fixedStops.map((stopPct) => ({
      stopMode: "fixed-percent" as const,
      stopPct,
      stopAtrMultiple: base.stopAtrMultiple ?? 1,
    })),
    ...[0.5, 1, 1.5, 2].map((stopAtrMultiple) => ({
      stopMode: "atr-multiple" as const,
      stopPct: base.stopPct,
      stopAtrMultiple,
    })),
  ];
  const exitLevels = listExitLevelCandidates(matrix, features).slice(0, 24);
  stops.push(
    ...exitLevels.map((level) => ({
      stopMode: "price-level" as const,
      stopPct: base.stopPct,
      stopAtrMultiple: base.stopAtrMultiple ?? 1,
      stopFeatureId: level.id,
      stopFeatureLabel: level.label,
    })),
  );
  const holds = uniqueNumbers([
    1,
    2,
    3,
    5,
    8,
    12,
    21,
    34,
    pattern.horizon,
    pattern.horizonAnalysis?.recommendedHorizon ?? pattern.horizon,
  ]).filter((hold) => hold > 0 && hold <= 100);
  const targets: Array<
    Pick<CandidateSimulationConfig, "targetMode"> &
      Partial<CandidateSimulationConfig>
  > = [
    ...[1, 1.5, 2, 3].map((rewardRiskMultiple) => ({
      targetMode: "risk-multiple" as const,
      targetPct: base.targetPct,
      rewardRiskMultiple,
      targetAtrMultiple: base.targetAtrMultiple ?? 2,
    })),
    ...uniqueNumbers([
      0.1,
      0.25,
      0.5,
      1,
      ...(pathTarget != null && pathTarget >= 0.02 && pathTarget <= 10
        ? [Number(pathTarget.toFixed(3))]
        : []),
    ]).map((targetPct) => ({
      targetMode: "fixed-percent" as const,
      targetPct,
      rewardRiskMultiple: base.rewardRiskMultiple,
      targetAtrMultiple: base.targetAtrMultiple ?? 2,
    })),
    ...[0.5, 1, 1.5, 2, 3].map((targetAtrMultiple) => ({
      targetMode: "atr-multiple" as const,
      targetPct: base.targetPct,
      rewardRiskMultiple: base.rewardRiskMultiple,
      targetAtrMultiple,
    })),
    {
      targetMode: "time-only" as const,
      targetPct: base.targetPct,
      rewardRiskMultiple: base.rewardRiskMultiple,
      targetAtrMultiple: base.targetAtrMultiple ?? 2,
    },
    ...(box
      ? [
          {
            targetMode: "box-midpoint" as const,
            targetPct: base.targetPct,
            rewardRiskMultiple: base.rewardRiskMultiple,
            targetAtrMultiple: base.targetAtrMultiple ?? 2,
          },
        ]
      : []),
  ];
  targets.push(
    ...exitLevels.map((level) => ({
      targetMode: "price-level" as const,
      targetPct: base.targetPct,
      rewardRiskMultiple: base.rewardRiskMultiple,
      targetAtrMultiple: base.targetAtrMultiple ?? 2,
      targetFeatureId: level.id,
      targetFeatureLabel: level.label,
    })),
  );
  const exitFeatureRules = discoverExitFeatureRules(
    features,
    matrix,
    developmentEndIndex,
  );
  targets.push(
    ...exitFeatureRules.map((rule) => ({
      targetMode: "feature-event" as const,
      targetPct: base.targetPct,
      rewardRiskMultiple: base.rewardRiskMultiple,
      targetAtrMultiple: base.targetAtrMultiple ?? 2,
      exitFeatureId: rule.featureId,
      exitFeatureLabel: rule.featureLabel,
      exitFeatureOperator: rule.operator,
      exitFeatureValue: rule.value,
    })),
    {
      targetMode: "signal-invalidation" as const,
      targetPct: base.targetPct,
      rewardRiskMultiple: base.rewardRiskMultiple,
      targetAtrMultiple: base.targetAtrMultiple ?? 2,
    },
  );
  const groups = new Map<string, CandidateSimulationConfig[]>();
  const addToGroup = (name: string, config: CandidateSimulationConfig) => {
    groups.set(name, [...(groups.get(name) ?? []), config]);
  };
  for (const hold of holds) {
    for (const stop of stops) {
      for (const target of targets) {
        for (const entryMode of entries) {
          if (
            (entryMode === "box-boundary-limit") !==
            (target.targetMode === "box-midpoint")
          ) {
            continue;
          }
          if (
            stop.stopMode === "price-level" &&
            target.targetMode === "price-level" &&
            stop.stopFeatureId === target.targetFeatureId
          ) {
            continue;
          }
          const config = {
            ...base,
            ...target,
            ...stop,
            entryMode,
            maxHoldBars: hold,
            entryExpiryBars: Math.max(1, Math.min(8, hold)),
            nonOverlapping: true,
          } as CandidateSimulationConfig;
          const family =
            target.targetMode === "price-level"
              ? "price-target"
              : stop.stopMode === "price-level"
                ? "price-stop"
                : target.targetMode === "feature-event" ||
                    target.targetMode === "signal-invalidation"
                  ? "feature-exit"
                  : "standard";
          addToGroup(family, config);
        }
      }
    }
  }
  const grid = [...groups.values()].flat();
  if (grid.length <= maximum) return grid;
  const selected: CandidateSimulationConfig[] = [];
  const nonEmptyGroups = [...groups.values()].filter(
    (group) => group.length > 0,
  );
  const quota = Math.max(1, Math.floor(maximum / nonEmptyGroups.length));
  for (const group of nonEmptyGroups) {
    const count = Math.min(quota, group.length);
    const stride = group.length / count;
    for (let index = 0; index < count; index++) {
      selected.push(group[Math.floor(index * stride)]);
    }
  }
  if (selected.length < maximum) {
    const chosen = new Set(selected);
    const remaining = grid.filter((candidate) => !chosen.has(candidate));
    const count = Math.min(maximum - selected.length, remaining.length);
    const stride = remaining.length / Math.max(1, count);
    for (let index = 0; index < count; index++) {
      selected.push(remaining[Math.floor(index * stride)]);
    }
  }
  return selected.slice(0, maximum);
}

function configKey(config: CandidateSimulationConfig): string {
  return [
    config.entryMode,
    config.entryExpiryBars,
    config.stopMode,
    config.stopPct,
    config.stopAtrMultiple,
    config.stopFeatureId ?? "",
    config.targetMode,
    config.targetPct,
    config.rewardRiskMultiple,
    config.targetAtrMultiple,
    config.targetFeatureId ?? "",
    config.exitFeatureId ?? "",
    config.exitFeatureOperator ?? "",
    String(config.exitFeatureValue ?? ""),
    config.maxHoldBars,
    config.roundTripCostBps,
  ].join("|");
}

/**
 * Refines the strongest coarse configurations one dimension at a time. This
 * spends the browser's bounded simulation budget near promising entry/exit
 * recipes instead of selecting a few evenly spaced points from a grid that can
 * contain hundreds of thousands of combinations.
 */
function buildRefinementGrid(
  pattern: Pattern,
  seeds: CandidateSimulationConfig[],
  maximum: number,
  excluded: Set<string>,
): CandidateSimulationConfig[] {
  if (maximum <= 0 || seeds.length === 0) return [];
  const holds = uniqueNumbers([
    1,
    2,
    3,
    5,
    8,
    12,
    21,
    34,
    pattern.horizon,
    pattern.horizonAnalysis?.recommendedHorizon ?? pattern.horizon,
  ]).filter((hold) => hold > 0 && hold <= 100);
  const fixedStops = uniqueNumbers([
    0.05,
    0.1,
    0.15,
    0.25,
    0.35,
    0.5,
    0.75,
    1,
    ...(pattern.avgMAE >= 0.02 && pattern.avgMAE <= 5
      ? [Number(pattern.avgMAE.toFixed(3))]
      : []),
  ]);
  const fixedTargets = uniqueNumbers([
    0.05,
    0.1,
    0.15,
    0.25,
    0.35,
    0.5,
    0.75,
    1,
    ...(pattern.avgMFE >= 0.02 && pattern.avgMFE <= 10
      ? [Number(pattern.avgMFE.toFixed(3))]
      : []),
  ]);
  const atrMultiples = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  const rewardRiskMultiples = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  const entries: CandidateSimulationConfig["entryMode"][] =
    patternSupportsBoxExecution(pattern)
      ? ["next-open", "signal-close", "box-boundary-limit"]
      : ["next-open", "signal-close"];
  const refinements: CandidateSimulationConfig[] = [];
  const add = (config: CandidateSimulationConfig) => {
    if (refinements.length >= maximum) return;
    const key = configKey(config);
    if (excluded.has(key)) return;
    excluded.add(key);
    refinements.push(config);
  };
  for (const seed of seeds) {
    for (const entryMode of entries) {
      if (
        (entryMode === "box-boundary-limit") !==
        (seed.targetMode === "box-midpoint")
      ) {
        continue;
      }
      add({ ...seed, entryMode });
    }
    for (const maxHoldBars of holds) {
      add({
        ...seed,
        maxHoldBars,
        entryExpiryBars: Math.max(1, Math.min(8, maxHoldBars)),
      });
    }
    if (seed.stopMode === "fixed-percent") {
      for (const stopPct of fixedStops) add({ ...seed, stopPct });
    } else if (seed.stopMode === "atr-multiple") {
      for (const stopAtrMultiple of atrMultiples) {
        add({ ...seed, stopAtrMultiple });
      }
    }
    if (seed.targetMode === "fixed-percent") {
      for (const targetPct of fixedTargets) add({ ...seed, targetPct });
    } else if (seed.targetMode === "atr-multiple") {
      for (const targetAtrMultiple of atrMultiples) {
        add({ ...seed, targetAtrMultiple });
      }
    } else if (seed.targetMode === "risk-multiple") {
      for (const rewardRiskMultiple of rewardRiskMultiples) {
        add({ ...seed, rewardRiskMultiple });
      }
    }
    if (refinements.length >= maximum) break;
  }
  return refinements;
}

function complexityPenalty(config: CandidateSimulationConfig): number {
  let penalty = 0;
  if (config.entryMode !== "next-open") penalty += 0.08;
  if (config.targetMode === "box-midpoint") penalty += 0.04;
  if (config.targetMode === "time-only") penalty -= 0.03;
  if ((config.stopMode ?? "fixed-percent") === "atr-multiple") penalty += 0.02;
  if ((config.stopMode ?? "fixed-percent") === "price-level") penalty += 0.03;
  if (config.targetMode === "atr-multiple") penalty += 0.02;
  if (config.targetMode === "price-level") penalty += 0.03;
  if (config.targetMode === "feature-event") penalty += 0.05;
  if (config.targetMode === "signal-invalidation") penalty += 0.02;
  if (config.maxHoldBars > 21) penalty += 0.04;
  return penalty;
}

function objective(
  result: CandidateSimulationResult,
  minimumTrades: number,
  penalty: number,
): number {
  if (result.trades.length < minimumTrades) return Number.NEGATIVE_INFINITY;
  const profitFactor = Math.min(4, result.profitFactor ?? 4);
  const evidence = Math.min(1.5, Math.log10(result.trades.length + 1) / 1.5);
  return (
    result.expectancyR * 2.4 +
    (profitFactor - 1) * 0.25 +
    evidence * 0.25 -
    result.maxDrawdownPct * 0.035 -
    penalty
  );
}

function walkForwardAudit(
  pattern: Pattern,
  bars: OHLCVBar[],
  matrix: FeatureMatrix,
  session: MarketSessionConfig,
  config: CandidateSimulationConfig,
  preHoldoutEndIndex: number,
  foldCount: number,
): WalkForwardSystemAudit {
  const folds = Math.max(2, Math.min(8, foldCount));
  const firstTestIndex = Math.floor(preHoldoutEndIndex * 0.4);
  const testSpan = Math.max(
    1,
    Math.floor((preHoldoutEndIndex - firstTestIndex + 1) / folds),
  );
  const foldExpectancyR: number[] = [];
  for (let fold = 0; fold < folds; fold++) {
    const start = firstTestIndex + fold * testSpan;
    const end =
      fold === folds - 1
        ? preHoldoutEndIndex
        : Math.min(preHoldoutEndIndex, start + testSpan - 1);
    const result = simulateCandidateSystem({
      pattern,
      bars,
      matrix,
      config,
      session,
      signalStartIndex: start,
      signalEndIndex: end,
    });
    foldExpectancyR.push(result.expectancyR);
  }
  const profitableFolds = foldExpectancyR.filter((value) => value > 0).length;
  const meanExpectancyR =
    foldExpectancyR.reduce((sum, value) => sum + value, 0) /
    foldExpectancyR.length;
  return {
    folds,
    profitableFolds,
    foldExpectancyR,
    meanExpectancyR,
    worstExpectancyR: Math.min(...foldExpectancyR),
    stabilityDeltaR:
      Math.max(...foldExpectancyR) - Math.min(...foldExpectancyR),
  };
}

function operatorText(pattern: Pattern): string[] {
  if (pattern.reproductionRecipe?.conditions.length) {
    return pattern.reproductionRecipe.conditions.map(
      (condition) => condition.expression,
    );
  }
  return pattern.conditions.map((condition) => {
    const value = condition.bucketLabel ?? condition.value ?? "?";
    return `${condition.featureId} ${condition.operator} ${value}`;
  });
}

function plainEntry(config: CandidateSimulationConfig): string {
  if (config.entryMode === "signal-close")
    return "Enter when the signal candle closes.";
  if (config.entryMode === "box-boundary-limit")
    return "Place a limit order at the adjusted previous-session box boundary.";
  return "Enter at the opening price of the next candle.";
}

function plainExit(config: CandidateSimulationConfig): string {
  if (config.targetMode === "box-midpoint")
    return "Take profit at the middle of the adjusted previous-session box.";
  if (config.targetMode === "fixed-percent")
    return `Take profit after price moves ${config.targetPct}% in your favor.`;
  if (config.targetMode === "atr-multiple")
    return `Take profit ${config.targetAtrMultiple} ATR from entry.`;
  if (config.targetMode === "time-only")
    return "Do not use a fixed profit target; exit when the maximum hold ends.";
  if (config.targetMode === "price-level")
    return `Take profit at the signal candle's confirmed ${config.targetFeatureLabel ?? config.targetFeatureId ?? "selected causal price level"} value.`;
  if (config.targetMode === "feature-event") {
    const operator =
      config.exitFeatureOperator === "cross-above"
        ? "crosses above"
        : config.exitFeatureOperator === "cross-below"
          ? "crosses below"
          : "is";
    return `Exit when ${config.exitFeatureLabel ?? config.exitFeatureId ?? "the selected indicator"} ${operator} ${String(config.exitFeatureValue ?? "its trigger")}, using that candle's close.`;
  }
  if (config.targetMode === "signal-invalidation")
    return "Exit at the candle close when the entry pattern is no longer true.";
  return `Take profit at ${config.rewardRiskMultiple}:1 reward compared with the stop.`;
}

function plainStop(config: CandidateSimulationConfig): string {
  if ((config.stopMode ?? "fixed-percent") === "atr-multiple") {
    return `Use a ${config.stopAtrMultiple} ATR protective stop.`;
  }
  if ((config.stopMode ?? "fixed-percent") === "price-level") {
    return `Place the protective stop at the signal candle's confirmed ${config.stopFeatureLabel ?? config.stopFeatureId ?? "selected causal price level"} value.`;
  }
  return `Use a ${config.stopPct}% stop.`;
}

function buildRecipe(
  pattern: Pattern,
  config: CandidateSimulationConfig,
): ExecutableSystemRecipe {
  const direction = pattern.direction === "bearish" ? "sell" : "buy";
  const conditions = operatorText(pattern);
  const entry = plainEntry(config);
  const exit = plainExit(config);
  const stop = plainStop(config);
  return {
    title: `${pattern.targetDatasetLabel ?? "Market"} ${pattern.direction} candidate`,
    oneSentenceRule: `When all ${conditions.length} signal checks are true, ${direction}. ${entry} ${stop} ${exit} Otherwise close after ${config.maxHoldBars} candles.`,
    steps: [
      `Wait until every signal check is true: ${conditions.join("; ")}.`,
      entry,
      stop,
      exit,
      `Close the trade after ${config.maxHoldBars} candles if neither target nor stop was reached.`,
      "Do not open another trade while this one is active.",
    ],
    exactParameters: config,
    signalConditions: conditions,
    targetDataset: pattern.targetDatasetLabel ?? "Current target",
    targetTimeframe: pattern.targetTimeframe ?? "unknown",
    machineReadable: {
      schema: "trading-discovery-executable-system",
      version: 1,
      patternId: pattern.id,
      direction: pattern.direction,
      conditions: pattern.conditions,
      config,
    },
  };
}

function candidateLabels(
  evaluations: Array<{
    id: string;
    development: CandidateSimulationResult;
    complexity: number;
  }>,
): Map<string, string[]> {
  const labels = new Map<string, string[]>();
  const add = (id: string, label: string) =>
    labels.set(id, [...(labels.get(id) ?? []), label]);
  const by = (
    compare: (
      a: (typeof evaluations)[number],
      b: (typeof evaluations)[number],
    ) => number,
    label: string,
  ) => {
    const winner = [...evaluations].sort(compare)[0];
    if (winner) add(winner.id, label);
  };
  by(
    (a, b) => b.development.expectancyR - a.development.expectancyR,
    "Highest development expectancy",
  );
  by(
    (a, b) => a.development.maxDrawdownPct - b.development.maxDrawdownPct,
    "Lowest development drawdown",
  );
  by(
    (a, b) => b.development.trades.length - a.development.trades.length,
    "Most frequent",
  );
  by((a, b) => a.complexity - b.complexity, "Simplest");
  return labels;
}

export function optimizeCandidateSystem(input: {
  pattern: Pattern;
  bars: OHLCVBar[];
  matrix: FeatureMatrix;
  features?: Feature[];
  session: MarketSessionConfig;
  baseConfig: CandidateSimulationConfig;
  optimizerConfig?: Partial<SystemOptimizerConfig>;
}): CandidateSystemOptimization {
  const settings = {
    ...DEFAULT_SYSTEM_OPTIMIZER_CONFIG,
    ...input.optimizerConfig,
  };
  const holdoutFraction = Math.max(
    0.1,
    Math.min(0.35, settings.sealedHoldoutPct / 100),
  );
  const sealedHoldoutStartIndex = Math.max(
    2,
    Math.floor(input.bars.length * (1 - holdoutFraction)),
  );
  const preHoldoutEndIndex = sealedHoldoutStartIndex - 1;
  const availableIndependentSignals =
    input.pattern.executionComparison?.nonOverlapping.sampleSize ??
    input.pattern.sampleSize;
  const minimumDevelopmentTrades = Math.min(
    settings.minDevelopmentTrades,
    Math.max(20, Math.floor(availableIndependentSignals * 0.6)),
  );
  const maximumCandidates = Math.max(20, settings.maxCandidates);
  const coarseGrid = buildConstrainedGrid(
    input.pattern,
    input.baseConfig,
    input.matrix,
    input.features ?? [],
    preHoldoutEndIndex,
    Math.min(240, maximumCandidates),
  );
  const evaluateGrid = (configs: CandidateSimulationConfig[], offset: number) =>
    configs.map((config, index) => {
      const complexity = complexityPenalty(config);
      const development = simulateCandidateSystem({
        pattern: input.pattern,
        bars: input.bars,
        matrix: input.matrix,
        config,
        session: input.session,
        signalStartIndex: 0,
        signalEndIndex: preHoldoutEndIndex,
      });
      const walkForward = walkForwardAudit(
        input.pattern,
        input.bars,
        input.matrix,
        input.session,
        config,
        preHoldoutEndIndex,
        settings.walkForwardFolds,
      );
      const scoreBeforeHoldout =
        objective(development, minimumDevelopmentTrades, complexity) +
        walkForward.meanExpectancyR -
        walkForward.stabilityDeltaR * 0.12;
      return {
        id: `${input.pattern.id}-system-${offset + index + 1}`,
        config,
        complexity,
        development,
        walkForward,
        scoreBeforeHoldout,
      };
    });
  const coarseEvaluations = evaluateGrid(coarseGrid, 0);
  const refinementSeeds = coarseEvaluations
    .filter((candidate) => Number.isFinite(candidate.scoreBeforeHoldout))
    .sort((left, right) => right.scoreBeforeHoldout - left.scoreBeforeHoldout)
    .slice(0, 16)
    .map((candidate) => candidate.config);
  const excluded = new Set(coarseGrid.map(configKey));
  const refinementGrid = buildRefinementGrid(
    input.pattern,
    refinementSeeds,
    maximumCandidates - coarseGrid.length,
    excluded,
  );
  const developmentEvaluations = [
    ...coarseEvaluations,
    ...evaluateGrid(refinementGrid, coarseGrid.length),
  ];
  const finite = developmentEvaluations
    .filter((candidate) => Number.isFinite(candidate.scoreBeforeHoldout))
    .sort((a, b) => b.scoreBeforeHoldout - a.scoreBeforeHoldout);
  const labels = candidateLabels(finite);
  const shortlistIds = new Set<string>();
  for (const candidate of finite.slice(0, 8)) shortlistIds.add(candidate.id);
  for (const id of labels.keys()) shortlistIds.add(id);
  const candidates = finite
    .filter((candidate) => shortlistIds.has(candidate.id))
    .slice(0, 12)
    .map((candidate, index): OptimizedSystemCandidate => {
      const sealedHoldout = simulateCandidateSystem({
        pattern: input.pattern,
        bars: input.bars,
        matrix: input.matrix,
        config: candidate.config,
        session: input.session,
        signalStartIndex: sealedHoldoutStartIndex,
        signalEndIndex: input.bars.length - 2,
      });
      const costStressHoldout = simulateCandidateSystem({
        pattern: input.pattern,
        bars: input.bars,
        matrix: input.matrix,
        config: {
          ...candidate.config,
          roundTripCostBps: Math.max(
            candidate.config.roundTripCostBps *
              Math.max(1, settings.costStressMultiplier),
            candidate.config.roundTripCostBps + 5,
          ),
        },
        session: input.session,
        signalStartIndex: sealedHoldoutStartIndex,
        signalEndIndex: input.bars.length - 2,
      });
      const walkForwardPassed =
        candidate.walkForward.profitableFolds >=
          Math.ceil(candidate.walkForward.folds * 0.75) &&
        candidate.walkForward.meanExpectancyR > 0;
      const sealedHoldoutPassed =
        sealedHoldout.trades.length >= settings.minHoldoutTrades &&
        sealedHoldout.expectancyR >= settings.minHoldoutExpectancyR &&
        (sealedHoldout.profitFactor ?? Number.POSITIVE_INFINITY) >=
          settings.minHoldoutProfitFactor &&
        costStressHoldout.expectancyR > 0 &&
        (costStressHoldout.profitFactor ?? Number.POSITIVE_INFINITY) > 1;
      return {
        id: candidate.id,
        developmentRank: index + 1,
        config: candidate.config,
        development: candidate.development,
        walkForward: candidate.walkForward,
        sealedHoldout,
        costStressHoldout,
        scoreBeforeHoldout: candidate.scoreBeforeHoldout,
        complexityPenalty: candidate.complexity,
        walkForwardPassed,
        sealedHoldoutPassed,
        eligible: walkForwardPassed && sealedHoldoutPassed,
        labels: labels.get(candidate.id) ?? [],
        recipe: buildRecipe(input.pattern, candidate.config),
      };
    });
  const recommended =
    candidates.find((candidate) => candidate.eligible) ?? null;
  return {
    generatedAt: Date.now(),
    patternId: input.pattern.id,
    patternLabel: input.pattern.label,
    candidatesTested: developmentEvaluations.length,
    preHoldoutEndIndex,
    sealedHoldoutStartIndex,
    sealedHoldoutPct: holdoutFraction * 100,
    walkForwardFolds: settings.walkForwardFolds,
    recommendedCandidateId: recommended?.id ?? null,
    candidates,
    methodology: [
      "The parameter search first samples every execution family, then refines entry, stop, target, and hold values around the strongest development-only recipes.",
      "Indicator thresholds and eligible event states are derived only from development history; the sealed final segment cannot define an exit.",
      "Absolute indicator prices are never mined as entry conditions. They are retained separately only so a discovered entry can test an exact executable stop or target.",
      "Candidates are ranked before the sealed final segment is opened.",
      `A recipe needs at least ${minimumDevelopmentTrades} independent development trades before it can be ranked; this threshold scales down only when the validated pattern itself has fewer independent occurrences.`,
      "Walk-forward folds must be profitable in at least 75% of chronological test windows.",
      `The final holdout must contain at least ${settings.minHoldoutTrades} trades, at least ${settings.minHoldoutExpectancyR.toFixed(2)}R expectancy, and profit factor of at least ${settings.minHoldoutProfitFactor.toFixed(2)}.`,
      `The final holdout must remain profitable when round-trip costs are multiplied by ${settings.costStressMultiplier}, with at least 5 additional basis points applied.`,
      "The final holdout and cost stress are pass/fail only; they never improve a candidate's development rank.",
      "Simpler execution receives a small advantage over equally performing complicated execution.",
    ],
    integrityWarning:
      "This final segment was sealed from execution-parameter selection, but the underlying pattern may have been discovered using the full uploaded history. Lock this recipe and test it on a later CSV before treating it as truly untouched future evidence.",
    exitSearch: {
      priceLevelsAvailable: listExitLevelCandidates(
        input.matrix,
        input.features ?? [],
      ).length,
      indicatorEventsAvailable: discoverExitFeatureRules(
        input.features ?? [],
        input.matrix,
        preHoldoutEndIndex,
      ).length,
      testedFamilies: [
        "fixed percentage",
        "ATR",
        "reward:risk",
        "time",
        "causal price level",
        "indicator/relationship event",
        "signal invalidation",
        ...(patternSupportsBoxExecution(input.pattern)
          ? ["adjusted session box"]
          : []),
      ],
    },
  };
}
