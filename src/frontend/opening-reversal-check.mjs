import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const fixtureDirectory = resolve(
  process.argv[2] ??
    "/Users/tb/Documents/Codex/outputs/opening-reversal-research",
);
const server = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const { parseCsv } = await server.ssrLoadModule("/src/lib/csvParser.ts");
  const { optimizeOpeningReversal } = await server.ssrLoadModule(
    "/src/lib/openingReversalOptimizer.ts",
  );
  const session = {
    timeZone: "America/New_York",
    regularOpenMinutes: 570,
    regularCloseMinutes: 960,
    openingRangeMinutes: 15,
    tradingDayStartMinutes: 1080,
  };
  const outcomes = {};
  for (const symbol of ["DJ30", "USTECH"]) {
    for (const kind of ["PLANTED_EDGE", "NULL"]) {
      const prefix = `CONTROL_${symbol}_${kind}`;
      const [intrabar, execution, daily] = await Promise.all(
        ["1m", "5m", "1d"].map(async (timeframe) =>
          parseCsv(
            await readFile(
              resolve(fixtureDirectory, `${prefix}_${timeframe}.csv`),
              "utf8",
            ),
            `${prefix}_${timeframe}.csv`,
          ).dataset,
        ),
      );
      const optimization = optimizeOpeningReversal({
        instrumentKey: prefix.toLowerCase(),
        executionTimeframe: "5m",
        executionBars: execution.bars,
        intrabarBars: intrabar.bars,
        dailyBars: daily.bars,
        session,
        roundTripCostBps: 2,
      });
      outcomes[`${symbol}_${kind}`] = {
        sessions: optimization.sessionsExamined,
        finalists: optimization.finalists.length,
        recommended: optimization.recommended
          ? {
              parameters: optimization.recommended.parameters,
              development: optimization.recommended.development,
              holdout: optimization.recommended.sealedHoldout,
              stableNeighbors: optimization.recommended.stableNeighbors,
            }
          : null,
        failure: optimization.failureSummary,
        topFinalists: optimization.finalists.slice(0, 3).map((candidate) => ({
          parameters: candidate.parameters,
          development: candidate.development,
          holdout: candidate.sealedHoldout,
          stress: candidate.costStressHoldout,
          stableNeighbors: candidate.stableNeighbors,
          eligible: candidate.eligible,
        })),
      };
      if (kind === "PLANTED_EDGE" && optimization.recommended) {
        const threshold =
          optimization.recommended.parameters.manipulationAtrPct;
        if (threshold < 30 || threshold > 50) {
          throw new Error(
            `${symbol} recovered an implausible ATR threshold: ${threshold}.`,
          );
        }
      }
      outcomes[`${symbol}_${kind}`].unexpectedRecommendation =
        kind === "NULL" && optimization.recommended != null;
      if (kind === "PLANTED_EDGE" && !optimization.recommended) {
        throw new Error(`${symbol} planted-edge control was not recovered.`);
      }
      if (kind === "NULL" && optimization.recommended) {
        throw new Error(`${symbol} null control produced a recommendation.`);
      }
    }
  }
  for (const symbol of ["DJ30", "USTECH"]) {
    const prefix = `YAHOO_${symbol}_PROXY`;
    const [execution, daily] = await Promise.all(
      ["5m", "1D"].map(async (timeframe) =>
        parseCsv(
          await readFile(
            resolve(fixtureDirectory, `${prefix}_${timeframe}.csv`),
            "utf8",
          ),
          `${prefix}_${timeframe}.csv`,
        ).dataset,
      ),
    );
    const optimization = optimizeOpeningReversal({
      instrumentKey: prefix.toLowerCase(),
      executionTimeframe: "5m",
      executionBars: execution.bars,
      dailyBars: daily.bars,
      session,
      roundTripCostBps: 2,
      minDevelopmentTrades: 15,
      minHoldoutTrades: 4,
    });
    outcomes[`${symbol}_YAHOO_PROXY_EXPLORATORY`] = {
      sessions: optimization.sessionsExamined,
      finalists: optimization.finalists.length,
      recommended: optimization.recommended
        ? {
            parameters: optimization.recommended.parameters,
            development: optimization.recommended.development,
            holdout: optimization.recommended.sealedHoldout,
            stableNeighbors: optimization.recommended.stableNeighbors,
          }
        : null,
      failure: optimization.failureSummary,
      warning:
        "Exploratory only: Yahoo currently supplied about 60 days of free 5-minute proxy history, below the robust research target.",
    };
  }
  console.log(JSON.stringify(outcomes, null, 2));
} finally {
  await server.close();
}
