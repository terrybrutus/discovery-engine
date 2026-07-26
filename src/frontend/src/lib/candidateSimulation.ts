import type {
  Condition,
  FeatureMatrix,
  MarketSessionConfig,
  OHLCVBar,
  Pattern,
} from "@/types";

export type SimulationEntryMode =
  | "next-open"
  | "signal-close"
  | "box-boundary-limit";
export type SimulationTargetMode =
  | "fixed-percent"
  | "risk-multiple"
  | "box-midpoint";

export interface CandidateSimulationConfig {
  entryMode: SimulationEntryMode;
  entryExpiryBars: number;
  stopPct: number;
  targetMode: SimulationTargetMode;
  targetPct: number;
  rewardRiskMultiple: number;
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
  result: "target" | "stop" | "time" | "ambiguous";
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
  stopPct: 0.25,
  targetMode: "risk-multiple",
  targetPct: 0.5,
  rewardRiskMultiple: 2,
  maxHoldBars: 12,
  roundTripCostBps: 5,
  startingCapital: 50_000,
  riskPerTradePct: 1,
  nonOverlapping: true,
};

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
  const stopPct = Math.max(0.001, config.stopPct);
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

    const stopPrice = entryPrice * (1 - (direction * stopPct) / 100);
    let targetPrice =
      config.targetMode === "risk-multiple"
        ? entryPrice *
          (1 +
            direction *
              ((stopPct * Math.max(0.1, config.rewardRiskMultiple)) / 100))
        : entryPrice *
          (1 + (direction * Math.max(0.001, config.targetPct)) / 100);
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
