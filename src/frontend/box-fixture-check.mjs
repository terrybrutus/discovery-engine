import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const fixtureDir =
  process.argv[2] ??
  path.resolve(
    process.cwd(),
    "../../outputs/box-theory-walk-forward-test",
  );
const server = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const { parseCsv } = await server.ssrLoadModule("/src/lib/csvParser.ts");
  const { buildMultiTimeframeResearchSpace } = await server.ssrLoadModule(
    "/src/lib/multiTimeframe.ts",
  );
  const { runDiscovery } = await server.ssrLoadModule("/src/lib/discovery.ts");
  const { buildDatasetFeatures } = await server.ssrLoadModule(
    "/src/store/engineStore.ts",
  );
  const { optimizeCandidateSystem } = await server.ssrLoadModule(
    "/src/lib/candidateSystemOptimizer.ts",
  );
  const { simulateCandidateSystem } = await server.ssrLoadModule(
    "/src/lib/candidateSimulation.ts",
  );

  const filenames = [
    "SYNTH_BOX_TEST_1D.csv",
    "SYNTH_BOX_TEST_15m.csv",
    "SYNTH_BOX_TEST_5m.csv",
  ];
  const datasets = [];
  for (const filename of filenames) {
    const text = await fs.readFile(path.join(fixtureDir, filename), "utf8");
    const parsed = parseCsv(text, filename);
    if (!parsed.dataset) throw new Error(`${filename}: ${parsed.error}`);
    datasets.push(parsed.dataset);
  }
  const featuresByDataset = {};
  const matricesByDataset = {};
  for (const dataset of datasets) {
    const generated = buildDatasetFeatures(dataset, {});
    featuresByDataset[dataset.id] = generated.features;
    matricesByDataset[dataset.id] = generated.matrix;
  }
  const target = datasets.find((dataset) => dataset.timeframe === "15m");
  if (!target) throw new Error("15m target missing.");
  const research = buildMultiTimeframeResearchSpace(
    target,
    datasets,
    featuresByDataset,
    matricesByDataset,
    target.id,
  );
  const categories = [...new Set(research.features.map((item) => item.category))];
  const config = {
    maxDepth: 3,
    minSampleSize: 20,
    minWinRate: 55,
    enabledCategories: categories,
    horizon: 12,
    maxCombinations: 50_000,
    mfeMaeWindow: 12,
    minMfeMaeRatio: 1,
    mfeMaeRatioEnabled: false,
    mfeMaeRatioMode: "off",
    holdWindowAutoFind: true,
    outcomeTargetsPct: [0.1, 0.25, 0.5, 1],
    outcomeStopsPct: [0.1, 0.25, 0.5, 1],
    walkForwardFolds: 4,
    roundTripCostBps: 5,
    costFilterEnabled: false,
    minNetMovePct: 0,
    minGrossCostMultiple: 3,
    executionView: "non-overlapping",
    requireCrossSourceConfluence: false,
    minConfluenceSources: 1,
  };
  const patterns = await runDiscovery(
    target.bars,
    research.features,
    research.matrix,
    config,
    () => undefined,
    () => false,
  );
  const tagged = patterns.map((pattern) => ({
    ...pattern,
    targetDatasetId: target.id,
    targetDatasetLabel: target.label ?? target.name,
    targetTimeframe: target.timeframe,
  }));
  const boxPatterns = tagged.filter((pattern) =>
    pattern.conditions.some(
      (condition) =>
        condition.featureId.includes("adjusted_pds") ||
        condition.featureId.includes("prev_day_level"),
    ),
  );
  if (boxPatterns.length === 0) {
    throw new Error("The planted box behavior was not rediscovered.");
  }
  const dailyBiasPatterns = tagged.filter((pattern) =>
    pattern.conditions.some(
      (condition) =>
        condition.featureId.includes("prev_day_level_state") ||
        condition.featureId.includes("gap_direction"),
    ),
  );
  if (dailyBiasPatterns.length === 0) {
    throw new Error("The planted daily price-state bias was not rediscovered.");
  }
  const selected =
    boxPatterns.find((pattern) =>
      pattern.conditions.some(
        (condition) =>
          condition.featureId === "adjusted_pds_level_event" &&
          (condition.bucketLabel === "Rejected Upper" ||
            condition.bucketLabel === "Rejected Lower"),
      ),
    ) ?? boxPatterns[0];
  const optimization = optimizeCandidateSystem({
    pattern: selected,
    bars: target.bars,
    matrix: research.matrix,
    session: {
      timeZone: "America/New_York",
      regularOpenMinutes: 570,
      regularCloseMinutes: 960,
      openingRangeMinutes: 30,
      tradingDayStartMinutes: 1080,
    },
    baseConfig: {
      entryMode: "next-open",
      entryExpiryBars: 3,
      stopPct: 0.25,
      targetMode: "risk-multiple",
      targetPct: 0.5,
      rewardRiskMultiple: 2,
      maxHoldBars: selected.horizon,
      roundTripCostBps: 5,
      startingCapital: 50_000,
      riskPerTradePct: 1,
      nonOverlapping: true,
    },
    optimizerConfig: {
      minDevelopmentTrades: 12,
      minHoldoutTrades: 3,
      maxCandidates: 160,
    },
  });
  const recommended = optimization.candidates.find(
    (candidate) => candidate.id === optimization.recommendedCandidateId,
  );
  if (!recommended) {
    throw new Error("No planted candidate passed walk-forward and holdout gates.");
  }
  const directBoxConfig = {
    entryMode: "box-boundary-limit",
    entryExpiryBars: 5,
    stopPct: 0.1,
    targetMode: "box-midpoint",
    targetPct: 0.5,
    rewardRiskMultiple: 2,
    maxHoldBars: 12,
    roundTripCostBps: 5,
    startingCapital: 50_000,
    riskPerTradePct: 1,
    nonOverlapping: true,
  };
  const directBoxPattern = (direction, state) => ({
    id: `direct-box-${direction}`,
    conditions: [
      {
        featureId: "adjusted_pds_box_state",
        operator: "eq",
        bucketLabel: state,
      },
    ],
    label: `${state}: retest the adjusted boundary toward its midpoint`,
    direction,
    winRate: 0,
    avgMove: 0,
    avgMAE: 0,
    avgMFE: 0,
    sampleSize: 0,
    confidence: "moderate",
    score: 0,
    horizon: 12,
    targetDatasetLabel: target.label,
    targetTimeframe: target.timeframe,
  });
  const directBoxMatrix = {
    ...research.matrix,
    __adjusted_pds_high:
      matricesByDataset[target.id].__adjusted_pds_high,
    __adjusted_pds_low: matricesByDataset[target.id].__adjusted_pds_low,
    __adjusted_pds_mid: matricesByDataset[target.id].__adjusted_pds_mid,
  };
  const directBoxLong = simulateCandidateSystem({
    pattern: directBoxPattern("bullish", "Gap Down Adjusted"),
    bars: target.bars,
    matrix: directBoxMatrix,
    session: {
      timeZone: "America/New_York",
      regularOpenMinutes: 570,
      regularCloseMinutes: 960,
      openingRangeMinutes: 30,
      tradingDayStartMinutes: 1080,
    },
    config: directBoxConfig,
  });
  const directBoxShort = simulateCandidateSystem({
    pattern: directBoxPattern("bearish", "Gap Up Adjusted"),
    bars: target.bars,
    matrix: directBoxMatrix,
    session: {
      timeZone: "America/New_York",
      regularOpenMinutes: 570,
      regularCloseMinutes: 960,
      openingRangeMinutes: 30,
      tradingDayStartMinutes: 1080,
    },
    config: directBoxConfig,
  });
  const directBoxTrades = [
    ...directBoxLong.trades,
    ...directBoxShort.trades,
  ];
  const directBoxWinners = directBoxTrades.filter((trade) => trade.pnl > 0);
  const directBoxGrossProfit = directBoxWinners.reduce(
    (sum, trade) => sum + trade.pnl,
    0,
  );
  const directBoxGrossLoss = Math.abs(
    directBoxTrades
      .filter((trade) => trade.pnl <= 0)
      .reduce((sum, trade) => sum + trade.pnl, 0),
  );
  const directBoxReplay = {
    trades: directBoxTrades,
    expectancyR:
      directBoxTrades.reduce((sum, trade) => sum + trade.rMultiple, 0) /
      Math.max(1, directBoxTrades.length),
    winRate: (directBoxWinners.length / Math.max(1, directBoxTrades.length)) * 100,
    profitFactor:
      directBoxGrossLoss > 0 ? directBoxGrossProfit / directBoxGrossLoss : null,
    skippedOverlapping:
      directBoxLong.skippedOverlapping + directBoxShort.skippedOverlapping,
  };
  if (
    directBoxReplay.trades.length < 10 ||
    directBoxReplay.expectancyR <= 0 ||
    directBoxReplay.winRate < 60
  ) {
    const boxStateCounts = {};
    for (const value of research.matrix.adjusted_pds_box_state ?? []) {
      boxStateCounts[String(value)] = (boxStateCounts[String(value)] ?? 0) + 1;
    }
    throw new Error(
      `The planted boundary-to-midpoint box replay failed: ${JSON.stringify({
        trades: directBoxReplay.trades.length,
        expectancyR: directBoxReplay.expectancyR,
        winRate: directBoxReplay.winRate,
        skippedOverlapping: directBoxReplay.skippedOverlapping,
        longSkippedUnfilled: directBoxLong.skippedUnfilled,
        shortSkippedUnfilled: directBoxShort.skippedUnfilled,
        boxStateCounts,
        adjustedLevels: {
          high: directBoxMatrix.__adjusted_pds_high?.filter(
            (value) => value != null,
          ).length,
          low: directBoxMatrix.__adjusted_pds_low?.filter(
            (value) => value != null,
          ).length,
        },
      })}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        hierarchy: datasets
          .sort((a, b) => a.intervalMs - b.intervalMs)
          .map((dataset) => dataset.timeframe)
          .join(" → "),
        rows: Object.fromEntries(
          datasets.map((dataset) => [dataset.timeframe, dataset.rowCount]),
        ),
        patterns: patterns.length,
        boxPatterns: boxPatterns.length,
        dailyBiasPatterns: dailyBiasPatterns.length,
        selectedPattern: selected.plainEnglishSentence ?? selected.label,
        selectedSample: selected.sampleSize,
        selectedWinRate: selected.winRate,
        candidatesTested: optimization.candidatesTested,
        recommended: recommended.recipe.oneSentenceRule,
        walkForward: `${recommended.walkForward.profitableFolds}/${recommended.walkForward.folds}`,
        sealedTrades: recommended.sealedHoldout.trades.length,
        sealedExpectancyR: recommended.sealedHoldout.expectancyR,
        sealedProfitFactor: recommended.sealedHoldout.profitFactor,
        directBoxReplay: {
          trades: directBoxReplay.trades.length,
          winRate: directBoxReplay.winRate,
          expectancyR: directBoxReplay.expectancyR,
          profitFactor: directBoxReplay.profitFactor,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await server.close();
}
