import {
  type CandidateSimulationConfig,
  type CandidateSimulationResult,
  simulateCandidateSystem,
} from "@/lib/candidateSimulation";
import type {
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
}

export const DEFAULT_SYSTEM_OPTIMIZER_CONFIG: SystemOptimizerConfig = {
  sealedHoldoutPct: 20,
  walkForwardFolds: 4,
  minDevelopmentTrades: 50,
  minHoldoutTrades: 20,
  minHoldoutExpectancyR: 0.1,
  minHoldoutProfitFactor: 1.3,
  costStressMultiplier: 2,
  maxCandidates: 240,
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

function buildConstrainedGrid(
  pattern: Pattern,
  base: CandidateSimulationConfig,
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
    Pick<CandidateSimulationConfig, "stopMode" | "stopPct" | "stopAtrMultiple">
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
    Pick<
      CandidateSimulationConfig,
      "targetMode" | "targetPct" | "rewardRiskMultiple" | "targetAtrMultiple"
    >
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
  const grid: CandidateSimulationConfig[] = [];
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
          grid.push({
            ...base,
            ...target,
            ...stop,
            entryMode,
            maxHoldBars: hold,
            entryExpiryBars: Math.max(1, Math.min(8, hold)),
            nonOverlapping: true,
          });
        }
      }
    }
  }
  if (grid.length <= maximum) return grid;
  const selected: CandidateSimulationConfig[] = [];
  const stride = grid.length / maximum;
  for (let index = 0; index < maximum; index++) {
    selected.push(grid[Math.floor(index * stride)]);
  }
  return selected;
}

function complexityPenalty(config: CandidateSimulationConfig): number {
  let penalty = 0;
  if (config.entryMode !== "next-open") penalty += 0.08;
  if (config.targetMode === "box-midpoint") penalty += 0.04;
  if (config.targetMode === "time-only") penalty -= 0.03;
  if ((config.stopMode ?? "fixed-percent") === "atr-multiple") penalty += 0.02;
  if (config.targetMode === "atr-multiple") penalty += 0.02;
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
  return `Take profit at ${config.rewardRiskMultiple}:1 reward compared with the stop.`;
}

function plainStop(config: CandidateSimulationConfig): string {
  return (config.stopMode ?? "fixed-percent") === "atr-multiple"
    ? `Use a ${config.stopAtrMultiple} ATR protective stop.`
    : `Use a ${config.stopPct}% stop.`;
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
  const grid = buildConstrainedGrid(
    input.pattern,
    input.baseConfig,
    Math.max(20, settings.maxCandidates),
  );
  const developmentEvaluations = grid.map((config, index) => {
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
      objective(development, settings.minDevelopmentTrades, complexity) +
      walkForward.meanExpectancyR -
      walkForward.stabilityDeltaR * 0.12;
    return {
      id: `${input.pattern.id}-system-${index + 1}`,
      config,
      complexity,
      development,
      walkForward,
      scoreBeforeHoldout,
    };
  });
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
    candidatesTested: grid.length,
    preHoldoutEndIndex,
    sealedHoldoutStartIndex,
    sealedHoldoutPct: holdoutFraction * 100,
    walkForwardFolds: settings.walkForwardFolds,
    recommendedCandidateId: recommended?.id ?? null,
    candidates,
    methodology: [
      "The parameter grid is deliberately constrained: common and observed-path fixed levels, ATR-scaled exits, time-only exits, normal entries, and bounded hold lengths.",
      "Candidates are ranked before the sealed final segment is opened.",
      "Walk-forward folds must be profitable in at least 75% of chronological test windows.",
      `The final holdout must contain at least ${settings.minHoldoutTrades} trades, at least ${settings.minHoldoutExpectancyR.toFixed(2)}R expectancy, and profit factor of at least ${settings.minHoldoutProfitFactor.toFixed(2)}.`,
      `The final holdout must remain profitable when round-trip costs are multiplied by ${settings.costStressMultiplier}, with at least 5 additional basis points applied.`,
      "The final holdout and cost stress are pass/fail only; they never improve a candidate's development rank.",
      "Simpler execution receives a small advantage over equally performing complicated execution.",
    ],
    integrityWarning:
      "This final segment was sealed from execution-parameter selection, but the underlying pattern may have been discovered using the full uploaded history. Lock this recipe and test it on a later CSV before treating it as truly untouched future evidence.",
  };
}
