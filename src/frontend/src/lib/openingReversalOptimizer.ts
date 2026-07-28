import type { MarketSessionConfig, OHLCVBar } from "@/types";

export type OpeningReversalEntryMode = "confirmation-close" | "next-open";

export interface OpeningReversalParameters {
  openingRangeMinutes: 15;
  dailyAtrLength: 14;
  manipulationAtrPct: number;
  minimumRejectionWickPct: number;
  maximumBodyPct: number;
  closeLocationPct: number;
  requireCloseBackInside: boolean;
  entryMode: OpeningReversalEntryMode;
  target: "opening-range-midpoint";
  stop: "known-session-extreme";
}

export interface OpeningReversalTrade {
  sessionDate: string;
  signalTimestamp: number;
  entryTimestamp: number;
  direction: "long" | "short";
  openingRangeAtrPct: number;
  rejectionWickPct: number;
  bodyPct: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  exitPrice: number;
  exitTimestamp: number;
  result: "target" | "stop" | "session-close" | "ambiguous";
  grossR: number;
  netR: number;
}

export interface OpeningReversalMetrics {
  trades: number;
  wins: number;
  losses: number;
  ambiguous: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number | null;
  netR: number;
  maximumDrawdownR: number;
}

export interface OpeningReversalCandidate {
  rank: number;
  parameters: OpeningReversalParameters;
  development: OpeningReversalMetrics;
  walkForward: {
    folds: number;
    profitableFolds: number;
    foldExpectancyR: number[];
  };
  sealedHoldout: OpeningReversalMetrics;
  costStressHoldout: OpeningReversalMetrics;
  stableNeighbors: number;
  eligible: boolean;
  trades: OpeningReversalTrade[];
}

export interface OpeningReversalOptimization {
  generatedAt: number;
  instrumentKey: string;
  executionTimeframe: string;
  sessionsExamined: number;
  candidatesTested: number;
  sealedHoldoutPct: number;
  roundTripCostBps: number;
  recommended: OpeningReversalCandidate | null;
  finalists: OpeningReversalCandidate[];
  failureSummary: string;
  methodology: string[];
}

interface OptimizationInput {
  instrumentKey: string;
  executionTimeframe: string;
  executionBars: OHLCVBar[];
  intrabarBars?: OHLCVBar[];
  dailyBars: OHLCVBar[];
  session: MarketSessionConfig;
  roundTripCostBps: number;
  sealedHoldoutPct?: number;
  walkForwardFolds?: number;
  minDevelopmentTrades?: number;
  minHoldoutTrades?: number;
}

interface SessionSlice {
  date: string;
  bars: OHLCVBar[];
  intrabars: OHLCVBar[];
  priorAtr: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dateParts(timestamp: number, timeZone: string) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function trueRanges(bars: OHLCVBar[]): number[] {
  return bars.map((bar, index) => {
    const previousClose = index > 0 ? bars[index - 1].close : bar.close;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose),
    );
  });
}

function dailyAtrByTimestamp(bars: OHLCVBar[], length: number) {
  const sorted = [...bars].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  const ranges = trueRanges(sorted);
  return sorted.map((bar, index) => {
    if (index + 1 < length)
      return { timestamp: bar.timestamp, value: Number.NaN };
    let total = 0;
    for (let cursor = index - length + 1; cursor <= index; cursor++) {
      total += ranges[cursor];
    }
    return { timestamp: bar.timestamp, value: total / length };
  });
}

function buildSessions(
  executionBars: OHLCVBar[],
  intrabarBars: OHLCVBar[],
  dailyBars: OHLCVBar[],
  session: MarketSessionConfig,
): SessionSlice[] {
  const atr = dailyAtrByTimestamp(dailyBars, 14);
  const grouped = new Map<string, OHLCVBar[]>();
  const intrabarGrouped = new Map<string, OHLCVBar[]>();
  for (const bar of executionBars) {
    const parts = dateParts(bar.timestamp, session.timeZone);
    if (
      parts.minutes < session.regularOpenMinutes ||
      parts.minutes >= session.regularCloseMinutes
    ) {
      continue;
    }
    const values = grouped.get(parts.date) ?? [];
    values.push(bar);
    grouped.set(parts.date, values);
  }
  for (const bar of intrabarBars) {
    const parts = dateParts(bar.timestamp, session.timeZone);
    if (
      parts.minutes < session.regularOpenMinutes ||
      parts.minutes >= session.regularCloseMinutes
    ) {
      continue;
    }
    const values = intrabarGrouped.get(parts.date) ?? [];
    values.push(bar);
    intrabarGrouped.set(parts.date, values);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, bars]) => {
      bars.sort((left, right) => left.timestamp - right.timestamp);
      const sessionOpen = bars[0]?.timestamp ?? 0;
      let priorAtr = Number.NaN;
      for (const point of atr) {
        if (point.timestamp >= sessionOpen) break;
        if (Number.isFinite(point.value)) priorAtr = point.value;
      }
      const intrabars = intrabarGrouped.get(date) ?? [];
      intrabars.sort((left, right) => left.timestamp - right.timestamp);
      return { date, bars, intrabars, priorAtr };
    })
    .filter((item) => item.bars.length >= 6 && Number.isFinite(item.priorAtr));
}

function evaluateSession(
  slice: SessionSlice,
  parameters: OpeningReversalParameters,
  roundTripCostBps: number,
): OpeningReversalTrade | null {
  const openingBars = slice.bars.slice(0, 3);
  if (openingBars.length < 3) return null;
  const openingOpen = openingBars[0].open;
  const openingClose = openingBars[2].close;
  const openingHigh = Math.max(...openingBars.map((bar) => bar.high));
  const openingLow = Math.min(...openingBars.map((bar) => bar.low));
  const openingMidpoint = (openingHigh + openingLow) / 2;
  const openingRangeAtrPct =
    ((openingHigh - openingLow) / slice.priorAtr) * 100;
  if (openingRangeAtrPct < parameters.manipulationAtrPct) return null;
  const seekLong = openingClose < openingOpen;
  const seekShort = openingClose > openingOpen;
  if (!seekLong && !seekShort) return null;

  let knownHigh = openingHigh;
  let knownLow = openingLow;
  for (let index = 3; index < slice.bars.length; index++) {
    const bar = slice.bars[index];
    knownHigh = Math.max(knownHigh, bar.high);
    knownLow = Math.min(knownLow, bar.low);
    const range = bar.high - bar.low;
    if (!(range > 0)) continue;
    const bodyPct = (Math.abs(bar.close - bar.open) / range) * 100;
    const upperWickPct =
      ((bar.high - Math.max(bar.open, bar.close)) / range) * 100;
    const lowerWickPct =
      ((Math.min(bar.open, bar.close) - bar.low) / range) * 100;
    const closeLocationPct = ((bar.close - bar.low) / range) * 100;
    const bullish =
      seekLong &&
      bar.close > bar.open &&
      bar.low <= openingLow &&
      lowerWickPct >= parameters.minimumRejectionWickPct &&
      bodyPct <= parameters.maximumBodyPct &&
      closeLocationPct >= 100 - parameters.closeLocationPct &&
      (!parameters.requireCloseBackInside || bar.close >= openingLow);
    const bearish =
      seekShort &&
      bar.close < bar.open &&
      bar.high >= openingHigh &&
      upperWickPct >= parameters.minimumRejectionWickPct &&
      bodyPct <= parameters.maximumBodyPct &&
      closeLocationPct <= parameters.closeLocationPct &&
      (!parameters.requireCloseBackInside || bar.close <= openingHigh);
    if (!bullish && !bearish) continue;
    const entryIndex = parameters.entryMode === "next-open" ? index + 1 : index;
    const entryBar = slice.bars[entryIndex];
    if (!entryBar) return null;
    const direction = bullish ? "long" : "short";
    const entryPrice =
      parameters.entryMode === "next-open" ? entryBar.open : bar.close;
    const stopPrice = direction === "long" ? knownLow : knownHigh;
    const targetPrice = openingMidpoint;
    const risk =
      direction === "long" ? entryPrice - stopPrice : stopPrice - entryPrice;
    const reward =
      direction === "long"
        ? targetPrice - entryPrice
        : entryPrice - targetPrice;
    if (!(risk > 0) || !(reward > 0)) return null;

    let exitPrice = slice.bars.at(-1)?.close ?? entryPrice;
    let exitTimestamp = slice.bars.at(-1)?.timestamp ?? entryBar.timestamp;
    let result: OpeningReversalTrade["result"] = "session-close";
    for (let cursor = entryIndex; cursor < slice.bars.length; cursor++) {
      const pathBar = slice.bars[cursor];
      const targetTouched =
        direction === "long"
          ? pathBar.high >= targetPrice
          : pathBar.low <= targetPrice;
      const stopTouched =
        direction === "long"
          ? pathBar.low <= stopPrice
          : pathBar.high >= stopPrice;
      if (targetTouched && stopTouched) {
        const nextTimestamp =
          slice.bars[cursor + 1]?.timestamp ?? pathBar.timestamp + 5 * 60_000;
        const contained = slice.intrabars.filter(
          (intrabar) =>
            intrabar.timestamp >= pathBar.timestamp &&
            intrabar.timestamp < nextTimestamp,
        );
        let resolved: "target" | "stop" | "ambiguous" = "ambiguous";
        for (const intrabar of contained) {
          const intrabarTarget =
            direction === "long"
              ? intrabar.high >= targetPrice
              : intrabar.low <= targetPrice;
          const intrabarStop =
            direction === "long"
              ? intrabar.low <= stopPrice
              : intrabar.high >= stopPrice;
          if (intrabarTarget && intrabarStop) break;
          if (intrabarStop) {
            resolved = "stop";
            break;
          }
          if (intrabarTarget) {
            resolved = "target";
            break;
          }
        }
        result = resolved;
        exitPrice = resolved === "target" ? targetPrice : stopPrice;
        exitTimestamp = pathBar.timestamp;
        break;
      }
      if (stopTouched) {
        result = "stop";
        exitPrice = stopPrice;
        exitTimestamp = pathBar.timestamp;
        break;
      }
      if (targetTouched) {
        result = "target";
        exitPrice = targetPrice;
        exitTimestamp = pathBar.timestamp;
        break;
      }
    }
    const grossMove =
      direction === "long" ? exitPrice - entryPrice : entryPrice - exitPrice;
    const grossR = grossMove / risk;
    const costR = (entryPrice * (roundTripCostBps / 10_000)) / risk;
    return {
      sessionDate: slice.date,
      signalTimestamp: bar.timestamp,
      entryTimestamp: entryBar.timestamp,
      direction,
      openingRangeAtrPct,
      rejectionWickPct: bullish ? lowerWickPct : upperWickPct,
      bodyPct,
      entryPrice,
      stopPrice,
      targetPrice,
      exitPrice,
      exitTimestamp,
      result,
      grossR,
      netR: grossR - costR,
    };
  }
  return null;
}

function metrics(
  trades: OpeningReversalTrade[],
  costMultiplier = 1,
): OpeningReversalMetrics {
  const adjusted = trades.map((trade) => {
    const baseCost = trade.grossR - trade.netR;
    return trade.grossR - baseCost * costMultiplier;
  });
  const wins = adjusted.filter((value) => value > 0).length;
  const losses = adjusted.filter((value) => value <= 0).length;
  const positive = adjusted
    .filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0);
  const negative = Math.abs(
    adjusted
      .filter((value) => value < 0)
      .reduce((sum, value) => sum + value, 0),
  );
  let equity = 0;
  let peak = 0;
  let maximumDrawdownR = 0;
  for (const value of adjusted) {
    equity += value;
    peak = Math.max(peak, equity);
    maximumDrawdownR = Math.max(maximumDrawdownR, peak - equity);
  }
  return {
    trades: trades.length,
    wins,
    losses,
    ambiguous: trades.filter((trade) => trade.result === "ambiguous").length,
    winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    expectancyR:
      adjusted.length > 0
        ? adjusted.reduce((sum, value) => sum + value, 0) / adjusted.length
        : 0,
    profitFactor: negative > 0 ? positive / negative : positive > 0 ? null : 0,
    netR: adjusted.reduce((sum, value) => sum + value, 0),
    maximumDrawdownR,
  };
}

function parameterGrid(): OpeningReversalParameters[] {
  const output: OpeningReversalParameters[] = [];
  for (const manipulationAtrPct of [20, 25, 30, 35, 40, 45, 50]) {
    for (const minimumRejectionWickPct of [30, 40, 50, 60, 70]) {
      for (const maximumBodyPct of [30, 40, 50, 60]) {
        for (const closeLocationPct of [25, 35, 45]) {
          for (const requireCloseBackInside of [false, true]) {
            for (const entryMode of [
              "confirmation-close",
              "next-open",
            ] as const) {
              output.push({
                openingRangeMinutes: 15,
                dailyAtrLength: 14,
                manipulationAtrPct,
                minimumRejectionWickPct,
                maximumBodyPct,
                closeLocationPct,
                requireCloseBackInside,
                entryMode,
                target: "opening-range-midpoint",
                stop: "known-session-extreme",
              });
            }
          }
        }
      }
    }
  }
  return output;
}

function profitable(metricsValue: OpeningReversalMetrics): boolean {
  return (
    metricsValue.trades > 0 &&
    metricsValue.expectancyR > 0 &&
    (metricsValue.profitFactor == null || metricsValue.profitFactor > 1)
  );
}

export function optimizeOpeningReversal(
  input: OptimizationInput,
): OpeningReversalOptimization {
  const sealedHoldoutPct = input.sealedHoldoutPct ?? 20;
  const folds = input.walkForwardFolds ?? 4;
  const minDevelopmentTrades = input.minDevelopmentTrades ?? 30;
  const minHoldoutTrades = input.minHoldoutTrades ?? 8;
  const sessions = buildSessions(
    input.executionBars,
    input.intrabarBars ?? [],
    input.dailyBars,
    input.session,
  );
  const holdoutStart = Math.max(
    1,
    Math.floor(sessions.length * (1 - sealedHoldoutPct / 100)),
  );
  const developmentSessions = sessions.slice(0, holdoutStart);
  const holdoutSessions = sessions.slice(holdoutStart);
  const evaluated = parameterGrid().map((parameters) => {
    const developmentTrades = developmentSessions
      .map((slice) =>
        evaluateSession(slice, parameters, input.roundTripCostBps),
      )
      .filter((trade): trade is OpeningReversalTrade => trade != null);
    const foldExpectancyR: number[] = [];
    for (let fold = 0; fold < folds; fold++) {
      const start = Math.floor((developmentSessions.length * fold) / folds);
      const end = Math.floor((developmentSessions.length * (fold + 1)) / folds);
      const foldDates = new Set(
        developmentSessions.slice(start, end).map((slice) => slice.date),
      );
      foldExpectancyR.push(
        metrics(
          developmentTrades.filter((trade) => foldDates.has(trade.sessionDate)),
        ).expectancyR,
      );
    }
    const development = metrics(developmentTrades);
    const profitableFolds = foldExpectancyR.filter((value) => value > 0).length;
    const score =
      development.expectancyR * Math.sqrt(Math.max(1, development.trades)) +
      profitableFolds * 0.2 -
      development.maximumDrawdownR * 0.03;
    return {
      parameters,
      developmentTrades,
      development,
      foldExpectancyR,
      profitableFolds,
      score,
    };
  });
  const viable = evaluated
    .filter(
      (item) =>
        item.development.trades >= minDevelopmentTrades &&
        item.profitableFolds >= Math.max(2, folds - 1) &&
        profitable(item.development),
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, 24);

  const finalists: OpeningReversalCandidate[] = viable.map((item, index) => {
    const holdoutTrades = holdoutSessions
      .map((slice) =>
        evaluateSession(slice, item.parameters, input.roundTripCostBps),
      )
      .filter((trade): trade is OpeningReversalTrade => trade != null);
    const sealedHoldout = metrics(holdoutTrades);
    const costStressHoldout = metrics(holdoutTrades, 2);
    const stableNeighbors = evaluated.filter((other) => {
      const nearThreshold =
        Math.abs(
          other.parameters.manipulationAtrPct -
            item.parameters.manipulationAtrPct,
        ) <= 5;
      const nearWick =
        Math.abs(
          other.parameters.minimumRejectionWickPct -
            item.parameters.minimumRejectionWickPct,
        ) <= 10;
      const nearBody =
        Math.abs(
          other.parameters.maximumBodyPct - item.parameters.maximumBodyPct,
        ) <= 10;
      return (
        nearThreshold &&
        nearWick &&
        nearBody &&
        other.development.trades >= minDevelopmentTrades &&
        profitable(other.development)
      );
    }).length;
    const eligible =
      sealedHoldout.trades >= minHoldoutTrades &&
      profitable(sealedHoldout) &&
      profitable(costStressHoldout) &&
      stableNeighbors >= 3;
    return {
      rank: index + 1,
      parameters: item.parameters,
      development: item.development,
      walkForward: {
        folds,
        profitableFolds: item.profitableFolds,
        foldExpectancyR: item.foldExpectancyR,
      },
      sealedHoldout,
      costStressHoldout,
      stableNeighbors,
      eligible,
      trades: [...item.developmentTrades, ...holdoutTrades],
    };
  });
  // The sealed segment is a single pass/fail gate for the best candidate
  // selected before it was opened. Falling through to a lower-ranked
  // candidate after seeing final outcomes would tune on the holdout.
  const recommended = finalists[0]?.eligible === true ? finalists[0] : null;
  return {
    generatedAt: Date.now(),
    instrumentKey: input.instrumentKey,
    executionTimeframe: input.executionTimeframe,
    sessionsExamined: sessions.length,
    candidatesTested: parameterGrid().length,
    sealedHoldoutPct,
    roundTripCostBps: input.roundTripCostBps,
    recommended,
    finalists,
    failureSummary:
      sessions.length < 60
        ? `Only ${sessions.length} complete sessions were available. Use at least 6-12 months of 5-minute history before treating a result as dependable.`
        : viable.length === 0
          ? "No parameter family produced enough development trades with stable positive walk-forward performance."
          : recommended == null
            ? "Development candidates existed, but none survived the sealed holdout, doubled-cost stress, minimum-trade, and parameter-neighborhood safeguards."
            : "",
    methodology: [
      "The first three completed 5-minute bars form the fixed 15-minute opening range.",
      "The opening range is normalized by ATR(14) calculated only from completed daily bars.",
      "The search varies the ATR threshold from 20%-50%, rejection wick/body/close rules, close-back-inside confirmation, and entry timing.",
      "The stop is the session extreme known when the signal closes; the target is the opening-range midpoint.",
      "Parameters are ranked on development history and chronological folds. The final 20% is sealed and used only as pass/fail.",
      "One trade per session prevents repeated bars in the same move from inflating the sample.",
      input.intrabarBars?.length
        ? "When a 5-minute candle touches target and stop, completed 1-minute bars resolve which came first; unresolved one-minute ties are counted conservatively."
        : "When a 5-minute candle touches target and stop and no 1-minute source is available, the outcome is counted conservatively.",
      "A recommendation requires positive final expectancy, doubled-cost survival, and profitable neighboring parameter values.",
    ],
  };
}

export function openingReversalRecipe(
  optimization: OpeningReversalOptimization,
): string {
  const candidate = optimization.recommended;
  if (!candidate) return optimization.failureSummary;
  const parameters = candidate.parameters;
  return [
    `Use ${optimization.executionTimeframe} candles. Let the first 15 minutes close.`,
    `Continue only when that range is at least ${parameters.manipulationAtrPct}% of the prior completed daily ATR(14).`,
    "If the opening candle rose, seek a short; if it fell, seek a long.",
    `Wait for a rejection candle at the opening-range edge with at least ${parameters.minimumRejectionWickPct}% wick, no more than ${parameters.maximumBodyPct}% body, and a close in the outer ${parameters.closeLocationPct}% of its candle.`,
    parameters.requireCloseBackInside
      ? "The rejection candle must close back inside the opening range."
      : "A close back inside the opening range is not required.",
    parameters.entryMode === "next-open"
      ? "Enter at the next 5-minute candle open."
      : "Enter at the rejection candle close.",
    "Place the stop beyond the session extreme already known at entry.",
    "Take profit at the opening-range midpoint; otherwise exit at the regular-session close.",
  ].join("\n");
}
