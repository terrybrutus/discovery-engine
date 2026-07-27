import type {
  Condition,
  Feature,
  FeatureMatrix,
  MarketSessionConfig,
  OHLCVBar,
  Pattern,
} from "@/types";

export type SimulationEntryMode =
  | "next-open"
  | "signal-close"
  | "box-boundary-limit";
export type SimulationStopMode =
  | "fixed-percent"
  | "atr-multiple"
  | "price-level";
export type SimulationTargetMode =
  | "fixed-percent"
  | "risk-multiple"
  | "atr-multiple"
  | "time-only"
  | "box-midpoint"
  | "price-level"
  | "feature-event"
  | "signal-invalidation";
export type SimulationFeatureExitOperator =
  | "eq"
  | "cross-above"
  | "cross-below";

export interface CandidateSimulationConfig {
  entryMode: SimulationEntryMode;
  entryExpiryBars: number;
  stopMode: SimulationStopMode;
  stopPct: number;
  stopAtrMultiple: number;
  /** Execution-only price-level series, frozen at the signal decision time. */
  stopFeatureId?: string;
  stopFeatureLabel?: string;
  targetMode: SimulationTargetMode;
  targetPct: number;
  targetAtrMultiple: number;
  rewardRiskMultiple: number;
  /** Execution-only price-level series, frozen at the signal decision time. */
  targetFeatureId?: string;
  targetFeatureLabel?: string;
  /** Causal post-entry feature event evaluated at each completed bar close. */
  exitFeatureId?: string;
  exitFeatureLabel?: string;
  exitFeatureOperator?: SimulationFeatureExitOperator;
  exitFeatureValue?: string | number;
  maxHoldBars: number;
  roundTripCostBps: number;
  startingCapital: number;
  riskPerTradePct: number;
  nonOverlapping: boolean;
}

export interface SimulatedTrade {
  signalIndex: number;
  entryIndex: number;
  exitIndex: number;
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  exitPrice: number;
  result:
    | "target"
    | "stop"
    | "feature-exit"
    | "invalidation"
    | "time"
    | "ambiguous";
  grossReturnPct: number;
  netReturnPct: number;
  pnl: number;
  rMultiple: number;
  equityAfter: number;
}

export interface CandidateSimulationResult {
  matchingSignals: number;
  skippedUnfilled: number;
  skippedOverlapping: number;
  trades: SimulatedTrade[];
  wins: number;
  losses: number;
  ambiguous: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  expectancy: number;
  expectancyR: number;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxDailyDrawdown: number;
  endingCapital: number;
  netProfit: number;
}

export const DEFAULT_SIMULATION_CONFIG: CandidateSimulationConfig = {
  entryMode: "next-open",
  entryExpiryBars: 3,
  stopMode: "fixed-percent",
  stopPct: 0.25,
  stopAtrMultiple: 1,
  targetMode: "risk-multiple",
  targetPct: 0.5,
  targetAtrMultiple: 2,
  rewardRiskMultiple: 2,
  maxHoldBars: 12,
  roundTripCostBps: 5,
  startingCapital: 50_000,
  riskPerTradePct: 1,
  nonOverlapping: true,
};

export interface ExitLevelCandidate {
  id: string;
  label: string;
  source: "target" | "context";
}

function titleCaseLevelKey(value: string): string {
  return value
    .replace(/^custom_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\bPds\b/g, "PDS")
    .replace(/\bVwap\b/g, "VWAP");
}

/** Lists exact price series available only to execution research. */
export function listExitLevelCandidates(
  matrix: FeatureMatrix,
  features: Feature[] = [],
): ExitLevelCandidate[] {
  const namesByPrefix = new Map<string, string>();
  for (const feature of features) {
    const custom = feature.id.match(
      /^(.*custom_[A-Za-z0-9_]+?)_(?:distance|relation|cross|touch|rejection|breakout)/,
    );
    if (custom) {
      const name = feature.definitionName ?? feature.name;
      namesByPrefix.set(custom[1], name.replace(/^Distance from /, ""));
    }
  }
  return Object.keys(matrix)
    .filter((key) => key.includes("__exit_level__"))
    .map((id) => {
      const [contextPart, raw = id] = id.split("__exit_level__");
      const rawLabel = raw || id;
      const customPrefix = rawLabel.startsWith("custom_")
        ? `${contextPart}custom_${rawLabel.slice("custom_".length)}`
        : "";
      const contextFeature = features.find(
        (feature) =>
          contextPart.length > 0 && feature.id.startsWith(contextPart),
      );
      const context = contextFeature?.name.match(/^\[[^\]]+\]/)?.[0];
      const base =
        namesByPrefix.get(customPrefix) ?? titleCaseLevelKey(rawLabel);
      return {
        id,
        label: context ? `${context} ${base}` : base,
        source: contextPart ? ("context" as const) : ("target" as const),
      };
    })
    .filter(
      (candidate, index, all) =>
        all.findIndex((other) => other.id === candidate.id) === index,
    )
    .sort((left, right) => left.label.localeCompare(right.label));
}

function conditionMatches(
  condition: Condition,
  value: number | string | undefined,
): boolean {
  if (value == null) return false;
  if (condition.operator === "eq")
    return typeof value === "string"
      ? value === condition.bucketLabel
      : value === condition.value;
  if (condition.operator === "neq")
    return typeof value === "string"
      ? value !== condition.bucketLabel
      : value !== condition.value;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return false;
  if (condition.operator === "gt") return numeric > (condition.value ?? 0);
  if (condition.operator === "gte") return numeric >= (condition.value ?? 0);
  if (condition.operator === "lt") return numeric < (condition.value ?? 0);
  if (condition.operator === "lte") return numeric <= (condition.value ?? 0);
  return (
    numeric >= (condition.value ?? 0) && numeric <= (condition.highValue ?? 0)
  );
}

function matchesPattern(
  pattern: Pattern,
  matrix: FeatureMatrix,
  index: number,
): boolean {
  return pattern.conditions.every((condition) =>
    conditionMatches(condition, matrix[condition.featureId]?.[index]),
  );
}

function numericAt(
  matrix: FeatureMatrix,
  key: string,
  index: number,
): number | null {
  const value = matrix[key]?.[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function featureExitMatches(
  config: CandidateSimulationConfig,
  matrix: FeatureMatrix,
  index: number,
): boolean {
  const featureId = config.exitFeatureId;
  const operator = config.exitFeatureOperator;
  const expected = config.exitFeatureValue;
  if (!featureId || !operator || expected == null) return false;
  const current = matrix[featureId]?.[index];
  if (current == null) return false;
  if (operator === "eq") {
    const previous = matrix[featureId]?.[index - 1];
    return typeof current === "number"
      ? current === Number(expected) && previous !== Number(expected)
      : current === String(expected) && previous !== String(expected);
  }
  const previous = matrix[featureId]?.[index - 1];
  const currentNumber = typeof current === "number" ? current : Number(current);
  const previousNumber =
    typeof previous === "number" ? previous : Number(previous);
  const threshold = Number(expected);
  if (
    !Number.isFinite(currentNumber) ||
    !Number.isFinite(previousNumber) ||
    !Number.isFinite(threshold)
  ) {
    return false;
  }
  return operator === "cross-above"
    ? previousNumber <= threshold && currentNumber > threshold
    : previousNumber >= threshold && currentNumber < threshold;
}

function marketDateKey(
  timestamp: number,
  session: MarketSessionConfig,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: session.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

const ATR_CACHE = new WeakMap<OHLCVBar[], number[]>();

function atrSeries(bars: OHLCVBar[], length = 14): number[] {
  const cached = ATR_CACHE.get(bars);
  if (cached) return cached;
  const result = new Array<number>(bars.length).fill(Number.NaN);
  if (bars.length === 0) return result;
  let running = 0;
  for (let index = 0; index < bars.length; index++) {
    const previousClose = index > 0 ? bars[index - 1].close : bars[index].close;
    const trueRange = Math.max(
      bars[index].high - bars[index].low,
      Math.abs(bars[index].high - previousClose),
      Math.abs(bars[index].low - previousClose),
    );
    if (index < length) {
      running += trueRange;
      if (index === length - 1) result[index] = running / length;
    } else {
      result[index] =
        ((result[index - 1] || trueRange) * (length - 1) + trueRange) / length;
    }
  }
  ATR_CACHE.set(bars, result);
  return result;
}

export function simulateCandidateSystem(input: {
  pattern: Pattern;
  bars: OHLCVBar[];
  matrix: FeatureMatrix;
  config: CandidateSimulationConfig;
  session: MarketSessionConfig;
  signalStartIndex?: number;
  signalEndIndex?: number;
}): CandidateSimulationResult {
  const { pattern, bars, matrix, config, session } = input;
  const direction = pattern.direction === "bearish" ? -1 : 1;
  const costPct = Math.max(0, config.roundTripCostBps) / 100;
  const atr = atrSeries(bars);
  const trades: SimulatedTrade[] = [];
  let matchingSignals = 0;
  let skippedUnfilled = 0;
  let skippedOverlapping = 0;
  let blockedThrough = -1;
  let equity = Math.max(1, config.startingCapital);
  let equityPeak = equity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  const dailyStart = new Map<string, number>();
  const dailyLow = new Map<string, number>();

  const signalStartIndex = Math.max(0, input.signalStartIndex ?? 0);
  const signalEndIndex = Math.min(
    bars.length - 2,
    input.signalEndIndex ?? bars.length - 2,
  );
  for (
    let signalIndex = signalStartIndex;
    signalIndex <= signalEndIndex;
    signalIndex++
  ) {
    if (!matchesPattern(pattern, matrix, signalIndex)) continue;
    matchingSignals++;
    if (config.nonOverlapping && signalIndex <= blockedThrough) {
      skippedOverlapping++;
      continue;
    }

    let entryIndex =
      config.entryMode === "signal-close" ? signalIndex : signalIndex + 1;
    let entryPrice =
      config.entryMode === "signal-close"
        ? bars[signalIndex].close
        : bars[entryIndex]?.open;
    if (config.entryMode === "box-boundary-limit") {
      const levelKey =
        direction > 0 ? "__adjusted_pds_low" : "__adjusted_pds_high";
      const limit = numericAt(matrix, levelKey, signalIndex);
      if (limit == null) {
        skippedUnfilled++;
        continue;
      }
      entryPrice = limit;
      entryIndex = -1;
      const expiry = Math.min(
        signalEndIndex,
        signalIndex + Math.max(1, config.entryExpiryBars),
      );
      for (let index = signalIndex + 1; index <= expiry; index++) {
        if (bars[index].low <= limit && bars[index].high >= limit) {
          entryIndex = index;
          break;
        }
      }
      if (entryIndex < 0) {
        skippedUnfilled++;
        continue;
      }
    }
    if (!Number.isFinite(entryPrice) || entryIndex >= bars.length) continue;

    const entryAtr = Number.isFinite(atr[entryIndex])
      ? atr[entryIndex]
      : Math.abs(entryPrice) * (Math.max(0.001, config.stopPct) / 100);
    const stopMode = config.stopMode ?? "fixed-percent";
    let stopPct =
      stopMode === "atr-multiple"
        ? (entryAtr * Math.max(0.1, config.stopAtrMultiple ?? 1) * 100) /
          Math.abs(entryPrice)
        : Math.max(0.001, config.stopPct);
    let stopPrice = entryPrice * (1 - (direction * stopPct) / 100);
    if (stopMode === "price-level") {
      const level = config.stopFeatureId
        ? numericAt(matrix, config.stopFeatureId, signalIndex)
        : null;
      if (
        level == null ||
        (direction > 0 && level >= entryPrice) ||
        (direction < 0 && level <= entryPrice)
      ) {
        skippedUnfilled++;
        continue;
      }
      stopPrice = level;
      stopPct = (Math.abs(entryPrice - stopPrice) / Math.abs(entryPrice)) * 100;
      if (stopPct < 0.001) {
        skippedUnfilled++;
        continue;
      }
    }
    let targetPrice =
      config.targetMode === "risk-multiple"
        ? entryPrice *
          (1 +
            direction *
              ((stopPct * Math.max(0.1, config.rewardRiskMultiple)) / 100))
        : entryPrice *
          (1 + (direction * Math.max(0.001, config.targetPct)) / 100);
    if (config.targetMode === "atr-multiple") {
      targetPrice =
        entryPrice +
        direction * entryAtr * Math.max(0.1, config.targetAtrMultiple ?? 2);
    } else if (config.targetMode === "time-only") {
      targetPrice =
        direction > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    } else if (
      config.targetMode === "feature-event" ||
      config.targetMode === "signal-invalidation"
    ) {
      targetPrice =
        direction > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    } else if (config.targetMode === "price-level") {
      const level = config.targetFeatureId
        ? numericAt(matrix, config.targetFeatureId, signalIndex)
        : null;
      if (
        level == null ||
        (direction > 0 && level <= entryPrice) ||
        (direction < 0 && level >= entryPrice)
      ) {
        skippedUnfilled++;
        continue;
      }
      targetPrice = level;
    }
    if (config.targetMode === "box-midpoint") {
      const midpoint = numericAt(matrix, "__adjusted_pds_mid", signalIndex);
      if (
        midpoint == null ||
        (direction > 0 && midpoint <= entryPrice) ||
        (direction < 0 && midpoint >= entryPrice)
      ) {
        skippedUnfilled++;
        continue;
      }
      targetPrice = midpoint;
    }

    const finalIndex = Math.min(
      signalEndIndex,
      entryIndex + Math.max(1, config.maxHoldBars),
    );
    let exitIndex = finalIndex;
    let exitPrice = bars[finalIndex].close;
    let result: SimulatedTrade["result"] = "time";
    // A signal-close entry becomes executable only after that bar has closed;
    // do not reuse its already-observed high/low as post-entry movement.
    const firstExecutionIndex =
      config.entryMode === "signal-close" ? entryIndex + 1 : entryIndex;
    for (let index = firstExecutionIndex; index <= finalIndex; index++) {
      const targetTouched =
        direction > 0
          ? bars[index].high >= targetPrice
          : bars[index].low <= targetPrice;
      const stopTouched =
        direction > 0
          ? bars[index].low <= stopPrice
          : bars[index].high >= stopPrice;
      if (targetTouched && stopTouched) {
        result = "ambiguous";
        exitIndex = index;
        // Conservative ordering: charge the stop when the uploaded timeframe
        // cannot reveal which level traded first.
        exitPrice = stopPrice;
        break;
      }
      if (stopTouched || targetTouched) {
        result = stopTouched ? "stop" : "target";
        exitIndex = index;
        exitPrice = stopTouched ? stopPrice : targetPrice;
        break;
      }
      if (
        config.targetMode === "feature-event" &&
        featureExitMatches(config, matrix, index)
      ) {
        result = "feature-exit";
        exitIndex = index;
        exitPrice = bars[index].close;
        break;
      }
      if (
        config.targetMode === "signal-invalidation" &&
        !matchesPattern(pattern, matrix, index)
      ) {
        result = "invalidation";
        exitIndex = index;
        exitPrice = bars[index].close;
        break;
      }
    }

    const grossReturnPct =
      direction * ((exitPrice - entryPrice) / Math.abs(entryPrice)) * 100;
    const netReturnPct = grossReturnPct - costPct;
    const riskDollars = equity * (Math.max(0.01, config.riskPerTradePct) / 100);
    const rMultiple = netReturnPct / stopPct;
    const pnl = riskDollars * rMultiple;
    equity += pnl;
    equityPeak = Math.max(equityPeak, equity);
    const drawdown = equityPeak - equity;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    maxDrawdownPct = Math.max(
      maxDrawdownPct,
      equityPeak > 0 ? (drawdown / equityPeak) * 100 : 0,
    );
    const day = marketDateKey(bars[exitIndex].timestamp, session);
    if (!dailyStart.has(day)) dailyStart.set(day, equity - pnl);
    dailyLow.set(day, Math.min(dailyLow.get(day) ?? equity, equity));

    trades.push({
      signalIndex,
      entryIndex,
      exitIndex,
      entryTimestamp: bars[entryIndex].timestamp,
      exitTimestamp: bars[exitIndex].timestamp,
      entryPrice,
      exitPrice,
      result,
      grossReturnPct,
      netReturnPct,
      pnl,
      rMultiple,
      equityAfter: equity,
    });
    if (config.nonOverlapping) blockedThrough = exitIndex;
  }

  const winners = trades.filter((trade) => trade.pnl > 0);
  const losers = trades.filter((trade) => trade.pnl <= 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + trade.pnl, 0));
  let maxDailyDrawdown = 0;
  for (const [day, start] of dailyStart) {
    maxDailyDrawdown = Math.max(
      maxDailyDrawdown,
      start - (dailyLow.get(day) ?? start),
    );
  }
  const average = (values: number[]) =>
    values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  return {
    matchingSignals,
    skippedUnfilled,
    skippedOverlapping,
    trades,
    wins: winners.length,
    losses: losers.length,
    ambiguous: trades.filter((trade) => trade.result === "ambiguous").length,
    winRate: trades.length > 0 ? (winners.length / trades.length) * 100 : 0,
    averageWin: average(winners.map((trade) => trade.pnl)),
    averageLoss: average(losers.map((trade) => trade.pnl)),
    expectancy: average(trades.map((trade) => trade.pnl)),
    expectancyR: average(trades.map((trade) => trade.rMultiple)),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdown,
    maxDrawdownPct,
    maxDailyDrawdown,
    endingCapital: equity,
    netProfit: equity - config.startingCapital,
  };
}
