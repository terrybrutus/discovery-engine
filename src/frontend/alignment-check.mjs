import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const { parseCsv } = await server.ssrLoadModule("/src/lib/csvParser.ts");
  const { buildResearchUniverse } = await server.ssrLoadModule(
    "/src/lib/researchUniverse.ts",
  );
  const { buildAlignmentAudit } = await server.ssrLoadModule(
    "/src/lib/alignmentAudit.ts",
  );
  const { buildMultiTimeframeResearchSpace } = await server.ssrLoadModule(
    "/src/lib/multiTimeframe.ts",
  );
  const {
    analyzePatternHorizons,
    buildEventPriorityCombinations,
    runDiscovery,
  } = await server.ssrLoadModule("/src/lib/discovery.ts");
  const { selectBalancedPatterns } = await server.ssrLoadModule(
    "/src/lib/patternSelection.ts",
  );
  const { meetsConfluenceRequirement } = await server.ssrLoadModule(
    "/src/lib/patternConfluence.ts",
  );
  const { validationHeldUp } = await server.ssrLoadModule(
    "/src/lib/validationPolicy.ts",
  );
  const {
    collectResearchCategories,
    requireMultiTimeframeCategory,
  } = await server.ssrLoadModule("/src/lib/researchCategories.ts");
  const { computeFeatureValues, generateFeatures } =
    await server.ssrLoadModule("/src/lib/features.ts");
  const { simulateCandidateSystem } = await server.ssrLoadModule(
    "/src/lib/candidateSimulation.ts",
  );
  const { buildDatasetFeatures, createAutomaticResearchPlan } =
    await server.ssrLoadModule("/src/store/engineStore.ts");

  const makeCsv = (start, minutes, rows) => {
    const lines = ["time,open,high,low,close"];
    for (let index = 0; index < rows; index++) {
      const time = new Date(
        Date.parse(start) + index * minutes * 60_000,
      ).toISOString();
      const open = 100 + index;
      lines.push(`${time},${open},${open + 2},${open - 1},${open + 1}`);
    }
    return lines.join("\n");
  };

  // Candidate-system replay regression: clustered statistical matches must
  // become one executable trade when non-overlap is enabled, with deterministic
  // risk sizing and next-open timing.
  const simulationBars = [
    { timestamp: 0, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1 },
    {
      timestamp: 60_000,
      open: 100,
      high: 101.2,
      low: 99.5,
      close: 101,
      volume: 1,
    },
    {
      timestamp: 120_000,
      open: 101,
      high: 101.5,
      low: 100.5,
      close: 101.2,
      volume: 1,
    },
  ];
  const simulation = simulateCandidateSystem({
    pattern: {
      id: "simulation-regression",
      conditions: [
        { featureId: "event", operator: "eq", bucketLabel: "Yes" },
      ],
      label: "Synthetic event",
      direction: "bullish",
      winRate: 100,
      avgMove: 1,
      avgMAE: 0.5,
      avgMFE: 1.2,
      sampleSize: 2,
      confidence: "low",
      score: 1,
      horizon: 2,
    },
    bars: simulationBars,
    matrix: { event: ["Yes", "Yes", "No"] },
    config: {
      entryMode: "next-open",
      entryExpiryBars: 1,
      stopPct: 1,
      targetMode: "risk-multiple",
      targetPct: 1,
      rewardRiskMultiple: 1,
      maxHoldBars: 2,
      roundTripCostBps: 0,
      startingCapital: 50_000,
      riskPerTradePct: 1,
      nonOverlapping: true,
    },
    session: {
      timeZone: "America/New_York",
      regularOpenMinutes: 570,
      regularCloseMinutes: 960,
      openingRangeMinutes: 30,
      tradingDayStartMinutes: 1080,
    },
  });
  if (
    simulation.trades.length !== 1 ||
    simulation.skippedOverlapping !== 1 ||
    Math.abs(simulation.netProfit - 500) > 1e-9
  ) {
    throw new Error("Candidate-system execution regression failed.");
  }
  const parse = (name, minutes, rows = 10) => {
    const result = parseCsv(
      makeCsv("2026-01-05T09:30:00Z", minutes, rows),
      name,
    );
    if (!result.dataset) throw new Error(`${name}: ${result.error}`);
    return result.dataset;
  };

  const hierarchy = buildResearchUniverse([
    parse("01_DJ30.R_1D.csv", 1440),
    parse("01_DJ30.R_1h.csv", 60),
    parse("01_DJ30.R_15.csv", 15),
  ]);
  if (hierarchy.instruments.length !== 1) {
    throw new Error(
      `Expected one instrument group; got ${hierarchy.instruments.length}`,
    );
  }

  // Automatic-plan regression: identical and constant uploaded measurements
  // must be removed without asking the user to choose research checkboxes.
  const schemaLines = ["time,Signal A,Signal B,Constant"];
  for (let index = 0; index < 240; index++) {
    const time = new Date(
      Date.parse("2026-01-05T09:30:00Z") + index * 60_000,
    ).toISOString();
    const signal = Math.sin(index / 7).toFixed(8);
    schemaLines.push(`${time},${signal},${signal},1`);
  }
  const schemaParsed = parseCsv(
    schemaLines.join("\n"),
    "SCHEMA_AUTOMATION_1m.csv",
  );
  if (!schemaParsed.dataset) {
    throw new Error(`Automatic-plan fixture failed: ${schemaParsed.error}`);
  }
  const schemaGenerated = buildDatasetFeatures(schemaParsed.dataset, {});
  const schemaPlan = createAutomaticResearchPlan(
    [schemaParsed.dataset],
    { [schemaParsed.dataset.id]: schemaGenerated.features },
    [schemaGenerated],
  );
  if (
    schemaGenerated.excludedSparseOrConstant < 1 ||
    schemaGenerated.excludedDuplicates < 1 ||
    schemaPlan.enabledCategories.length === 0 ||
    !schemaPlan.holdWindowAutoFind ||
    schemaPlan.executionView !== "non-overlapping"
  ) {
    throw new Error(
      "Automatic research selection did not remove dead/duplicate measurements and apply a complete first-pass plan.",
    );
  }

  // Structural-search regression: the portable three-source relationship
  // must be scheduled before incidental structural proxies consume the
  // bounded search and report pools.
  const priorityFeatures = [
    {
      id: "prev_day_level_event",
      name: "Previous Day Level Event",
      category: "Levels & Sessions",
      type: "categorical",
      enabled: true,
      description: "",
      originDatasetId: "target-5m",
      originTimeframe: "5m",
    },
    {
      id: "source15__candle_direction",
      name: "15m Candle Direction",
      category: "Multi-Timeframe",
      type: "categorical",
      enabled: true,
      description: "",
      originDatasetId: "source-15m",
      originTimeframe: "15m",
    },
    {
      id: "source1d__candle_direction",
      name: "1d Candle Direction",
      category: "Multi-Timeframe",
      type: "categorical",
      enabled: true,
      description: "",
      originDatasetId: "source-1d",
      originTimeframe: "1d",
    },
  ];
  const priorityConditions = [
    {
      featureId: "prev_day_level_event",
      operator: "eq",
      bucketLabel: "Swept PDL",
    },
    {
      featureId: "source15__candle_direction",
      operator: "eq",
      bucketLabel: "Up",
    },
    {
      featureId: "source15__candle_direction",
      operator: "eq",
      bucketLabel: "Down",
    },
    {
      featureId: "source1d__candle_direction",
      operator: "eq",
      bucketLabel: "Up",
    },
    {
      featureId: "source1d__candle_direction",
      operator: "eq",
      bucketLabel: "Down",
    },
  ];
  const scheduled = buildEventPriorityCombinations(
    priorityConditions,
    priorityFeatures,
    3,
    20,
  ).combinations;
  const scheduledExact = scheduled.some(
    (conditions) =>
      conditions.some(
        (condition) =>
          condition.featureId === "prev_day_level_event" &&
          condition.bucketLabel === "Swept PDL",
      ) &&
      conditions.some(
        (condition) =>
          condition.featureId === "source15__candle_direction" &&
          condition.bucketLabel === "Up",
      ) &&
      conditions.some(
        (condition) =>
          condition.featureId === "source1d__candle_direction" &&
          condition.bucketLabel === "Down",
      ),
  );
  if (!scheduledExact) {
    throw new Error(
      "The canonical 5m event + 15m direction + 1d direction relationship was not guaranteed structural-search coverage.",
    );
  }
  const canonicalPattern = {
    id: "canonical",
    targetDatasetId: "target-5m",
    searchTier: "event-priority",
    conditions: [
      priorityConditions[0],
      priorityConditions[1],
      priorityConditions[4],
    ],
    confluenceDatasetIds: ["target-5m", "source-15m", "source-1d"],
    score: 1,
    sampleSize: 55,
  };
  const proxyPatterns = Array.from({ length: 120 }, (_, index) => ({
    id: `proxy-${index}`,
    targetDatasetId: "target-5m",
    searchTier: "event-priority",
    conditions: [
      {
        featureId: `proxy-${index}__box_event`,
        operator: "eq",
        bucketLabel: "Breakout Up",
      },
      {
        featureId: `proxy-${index}__numeric_context`,
        operator: "gt",
        value: index,
      },
    ],
    confluenceDatasetIds: ["target-5m", `proxy-${index}`],
    score: 100 - index / 10,
    sampleSize: 100,
  }));
  const selectedStructural = selectBalancedPatterns(
    [...proxyPatterns, canonicalPattern],
    100,
  );
  if (!selectedStructural.some((pattern) => pattern.id === "canonical")) {
    throw new Error(
      "Portable cross-timeframe event relationships were crowded out of the report by proxy families.",
    );
  }

  const labels = hierarchy.instruments[0].timeframeLabels.join(" → ");
  if (labels !== "15m → 1h → 1d") {
    throw new Error(`Unexpected hierarchy: ${labels}`);
  }

  const oneMinute = parse("DJ30.R_1.csv", 1, 10);
  const fiveMinute = parse("DJ30.R_5.csv", 5, 3);
  const beforeClose = buildAlignmentAudit(oneMinute, [oneMinute, fiveMinute], 0)
    .rows[0];
  const atClose = buildAlignmentAudit(oneMinute, [oneMinute, fiveMinute], 4)
    .rows[0];
  const developing = buildAlignmentAudit(
    oneMinute,
    [oneMinute, fiveMinute],
    5,
  ).rows[0];
  if (beforeClose.sourceIndex !== -1) {
    throw new Error("5m bar leaked before its 09:35 completion.");
  }
  if (
    atClose.sourceIndex !== 0 ||
    !atClose.completed ||
    atClose.futureLeakCount !== 0
  ) {
    throw new Error("Completed 5m bar was not aligned at 09:35.");
  }
  if (developing.developingProgressPct !== 20) {
    throw new Error(
      `Expected developing 5m progress 20%; got ${developing.developingProgressPct}`,
    );
  }
  const intrabarAudit = buildAlignmentAudit(
    fiveMinute,
    [fiveMinute, oneMinute],
    0,
  ).rows[0];
  if (
    intrabarAudit.containedIntrabarCount !== 5 ||
    intrabarAudit.expectedIntrabarCount !== 5
  ) {
    throw new Error(
      `Expected 5/5 contained 1m bars; got ${intrabarAudit.containedIntrabarCount}/${intrabarAudit.expectedIntrabarCount}`,
    );
  }
  const research = buildMultiTimeframeResearchSpace(
    fiveMinute,
    [fiveMinute, oneMinute],
    { [fiveMinute.id]: [], [oneMinute.id]: [] },
    { [fiveMinute.id]: {}, [oneMinute.id]: {} },
  );
  const pathFeature = research.features.find((feature) =>
    feature.id.endsWith("intrabar_high_low_order"),
  );
  if (!pathFeature || research.matrix[pathFeature.id][0] !== "Low before high") {
    throw new Error("Completed 1m high/low path was not exposed to discovery.");
  }
  const contextCategorySource = {
    id: "context_time",
    name: "Time of Day",
    category: "Time",
    description: "",
    type: "categorical",
    enabled: true,
    formula: "time bucket",
  };
  const categoryResearch = buildMultiTimeframeResearchSpace(
    fiveMinute,
    [fiveMinute, oneMinute],
    {
      [fiveMinute.id]: [],
      [oneMinute.id]: [contextCategorySource],
    },
    {
      [fiveMinute.id]: {},
      [oneMinute.id]: { context_time: Array(oneMinute.bars.length).fill("Open") },
    },
  );
  const alignedContextCategory = categoryResearch.features.find((feature) =>
    feature.id.endsWith("context_time"),
  );
  if (alignedContextCategory?.category !== "Time") {
    throw new Error(
      `Aligned context feature lost its source category: ${alignedContextCategory?.category}`,
    );
  }
  const confluenceFeatures = [
    {
      id: "target",
      name: "Target",
      category: "Test",
      description: "",
      type: "numeric",
      enabled: true,
      originDatasetId: "dj30-15m",
      originTimeframe: "15m",
    },
    {
      id: "context",
      name: "Context",
      category: "Test",
      description: "",
      type: "numeric",
      enabled: true,
      originDatasetId: "dj30-1d",
      originTimeframe: "1d",
    },
  ];
  const targetOnly = [{ featureId: "target", operator: "gt", value: 0 }];
  const crossSource = [
    ...targetOnly,
    { featureId: "context", operator: "gt", value: 0 },
  ];
  if (meetsConfluenceRequirement(targetOnly, confluenceFeatures, 2)) {
    throw new Error("Single-source pattern incorrectly passed confluence.");
  }
  if (!meetsConfluenceRequirement(crossSource, confluenceFeatures, 2)) {
    throw new Error("Cross-source pattern failed confluence.");
  }
  const generatedCategories = collectResearchCategories(
    [[confluenceFeatures[0]], [confluenceFeatures[1]]],
    true,
  );
  if (!generatedCategories.includes("Multi-Timeframe")) {
    throw new Error(
      "Multi-Timeframe disappeared while collecting multi-source lenses.",
    );
  }
  const repairedCategories = requireMultiTimeframeCategory(["Test"], true);
  if (!repairedCategories.includes("Multi-Timeframe")) {
    throw new Error("Runtime did not repair a stale multi-source lens config.");
  }

  // Session-semantics regression: index CFDs cross UTC midnight, but their
  // research day runs 18:00 New York through 17:59. Previous-day levels,
  // session gap, time buckets, and the 09:30-10:00 opening range must all use
  // that convention rather than UTC calendar dates or every bar's open.
  const sessionBars = [
    {
      timestamp: Date.parse("2026-01-04T18:00:00-05:00"),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1,
    },
    {
      timestamp: Date.parse("2026-01-05T09:30:00-05:00"),
      open: 104,
      high: 106,
      low: 103,
      close: 105,
      volume: 1,
    },
    {
      timestamp: Date.parse("2026-01-05T09:45:00-05:00"),
      open: 105,
      high: 108,
      low: 102,
      close: 107,
      volume: 1,
    },
    {
      timestamp: Date.parse("2026-01-05T10:00:00-05:00"),
      open: 107,
      high: 107.5,
      low: 104,
      close: 106,
      volume: 1,
    },
    {
      timestamp: Date.parse("2026-01-05T17:45:00-05:00"),
      open: 106,
      high: 107,
      low: 105,
      close: 107,
      volume: 1,
    },
    {
      timestamp: Date.parse("2026-01-05T18:00:00-05:00"),
      open: 110,
      high: 111,
      low: 109,
      close: 110,
      volume: 1,
    },
    {
      timestamp: Date.parse("2026-01-06T09:30:00-05:00"),
      open: 110,
      high: 113,
      low: 109,
      close: 112,
      volume: 1,
    },
    {
      timestamp: Date.parse("2026-01-06T09:45:00-05:00"),
      open: 112,
      high: 114,
      low: 108,
      close: 109,
      volume: 1,
    },
    {
      timestamp: Date.parse("2026-01-06T10:00:00-05:00"),
      open: 109,
      high: 111,
      low: 107,
      close: 108,
      volume: 1,
    },
    {
      timestamp: Date.parse("2026-01-06T10:15:00-05:00"),
      open: 108,
      high: 110,
      low: 106,
      close: 107,
      volume: 1,
    },
    {
      timestamp: Date.parse("2026-01-06T10:30:00-05:00"),
      open: 107,
      high: 109,
      low: 105,
      close: 106,
      volume: 1,
    },
  ];
  const sessionCatalog = generateFeatures(sessionBars);
  const sessionMatrix = computeFeatureValues(sessionBars, sessionCatalog);
  const expectedGapPct = ((110 - 107) / 107) * 100;
  if (
    Math.abs(sessionMatrix.gap_size_pct[5] - expectedGapPct) > 1e-9 ||
    Math.abs(sessionMatrix.gap_size_pct[8] - expectedGapPct) > 1e-9
  ) {
    throw new Error("Session gap was not frozen from the 18:00 opening print.");
  }
  if (
    sessionMatrix.prev_day_level_state[5] !== "Above PDH" ||
    sessionMatrix.time_of_day[5] !== "Outside RTH"
  ) {
    throw new Error("New York trading-session boundaries were not respected.");
  }
  if (
    sessionMatrix.or_breakout[7] != null ||
    sessionMatrix.or_size_pct[8] == null ||
    Math.abs(sessionMatrix.or_size_pct[8] - (6 / 108) * 100) > 1e-9
  ) {
    throw new Error("Opening range was not anchored to 09:30-10:00 New York.");
  }
  if (
    sessionMatrix.adjusted_pds_box_state[8] !== "Gap Up Awaiting Pivot" ||
    sessionMatrix.adjusted_pds_box_state[10] !== "Gap Up Adjusted" ||
    Math.abs(sessionMatrix.adjusted_pds_box_position[10] - ((106 - 99) / 15) * 100) >
      1e-9
  ) {
    throw new Error(
      "Gap-adjusted session box did not wait for and then apply the confirmed pivot.",
    );
  }

  // Execution-horizon regression: the deterministic event rises most
  // efficiently for five 1m bars, then fades and is losing by 21 bars. Auto
  // recommendation must select 5 rather than drifting to the longest option.
  const executionBars = Array.from({ length: 900 }, (_, index) => ({
    timestamp: Date.parse("2026-01-05T09:30:00Z") + index * 60_000,
    open: 100,
    high: 100.01,
    low: 99.99,
    close: 100,
  }));
  const executionMatches = [];
  for (let entry = 30; entry < 850; entry += 60) {
    executionMatches.push(entry);
    const path = new Map([
      [1, 100.1],
      [2, 100.2],
      [3, 100.4],
      [5, 101],
      [8, 100.3],
      [12, 99.8],
      [13, 99.7],
      [21, 99.5],
      [34, 99.4],
      [50, 99.3],
    ]);
    for (const [offset, close] of path) {
      executionBars[entry + offset] = {
        ...executionBars[entry + offset],
        open: close,
        high: close + 0.01,
        low: close - 0.01,
        close,
      };
    }
  }
  const horizonAnalysis = analyzePatternHorizons(
    executionBars,
    executionMatches,
    "bullish",
    {
      maxDepth: 3,
      minSampleSize: 10,
      minWinRate: 55,
      enabledCategories: [],
      horizon: 12,
      maxCombinations: 1,
      mfeMaeWindow: 12,
      minMfeMaeRatio: 0,
      mfeMaeRatioMode: "off",
      holdWindowAutoFind: true,
      outcomeTargetsPct: [0.1, 0.25, 0.5, 1],
      outcomeStopsPct: [0.1, 0.25, 0.5, 1],
      walkForwardFolds: 4,
      roundTripCostBps: 0,
      costFilterEnabled: false,
      minNetMovePct: 0,
      minGrossCostMultiple: 0,
      executionView: "non-overlapping",
      requireCrossSourceConfluence: false,
      minConfluenceSources: 1,
    },
  );
  if (horizonAnalysis.recommendedHorizon !== 5) {
    throw new Error(
      `Expected the executable hold optimizer to select 5 bars; got ${horizonAnalysis.recommendedHorizon}.`,
    );
  }
  const twentyOne = horizonAnalysis.candidates.find(
    (candidate) => candidate.horizon === 21,
  );
  if (!twentyOne || twentyOne.avgNetMove >= 0) {
    throw new Error("The losing 21-bar control was not measured correctly.");
  }

  // Direct-hypothesis regression: a one-condition research question must be
  // discoverable without adding an unrelated second condition.
  const hypothesisBars = Array.from({ length: 401 }, (_, index) => {
    const close = 100 + Math.floor(index / 10) * 0.05 + (index % 2 ? -0.1 : 0);
    return {
      timestamp: Date.parse("2026-01-05T09:30:00Z") + index * 60_000,
      open: close,
      high: close + 0.02,
      low: close - 0.02,
      close,
    };
  });
  const hypothesisFeature = {
    id: "direct_hypothesis",
    name: "Direct Hypothesis",
    category: "Test",
    description: "",
    type: "categorical",
    enabled: true,
    formula: "deterministic test signal",
    buckets: ["Active", "Inactive"],
    originDatasetId: "test-1m",
    originTimeframe: "1m",
  };
  const hypothesisValues = hypothesisBars.map((_, index) =>
    index % 10 === 0 ? "Active" : "Inactive",
  );
  const directPatterns = await runDiscovery(
    hypothesisBars,
    [hypothesisFeature],
    { direct_hypothesis: hypothesisValues },
    {
      maxDepth: 1,
      minSampleSize: 30,
      minWinRate: 55,
      enabledCategories: ["Test"],
      horizon: 1,
      maxCombinations: 10,
      mfeMaeWindow: 1,
      minMfeMaeRatio: 0,
      mfeMaeRatioEnabled: false,
      mfeMaeRatioMode: "off",
      holdWindowAutoFind: false,
      outcomeTargetsPct: [0.1],
      outcomeStopsPct: [0.1],
      walkForwardFolds: 3,
      roundTripCostBps: 0,
      costFilterEnabled: false,
      minNetMovePct: 0,
      minGrossCostMultiple: 0,
      executionView: "every-match",
      requireCrossSourceConfluence: false,
      minConfluenceSources: 1,
    },
    () => {},
    () => false,
  );
  if (
    !directPatterns.some(
      (pattern) =>
        pattern.conditions.length === 1 &&
        pattern.conditions[0].featureId === "direct_hypothesis",
    )
  ) {
    throw new Error("Direct one-condition hypothesis was not discoverable.");
  }
  const validationControl = {
    degraded: false,
    outOfSampleMetrics: {
      sampleSize: 30,
      winRate: 65,
      avgMove: 0.2,
      avgMAE: 0.1,
      avgMFE: 0.2,
      direction: "bullish",
    },
    walkForward: {
      folds: 4,
      passedFolds: 2,
      meanWinRate: 60,
      worstWinRate: 40,
    },
  };
  if (validationHeldUp(validationControl)) {
    throw new Error("Two of four walk-forward folds incorrectly passed.");
  }
  validationControl.walkForward.passedFolds = 3;
  if (!validationHeldUp(validationControl)) {
    throw new Error("Three of four walk-forward folds should pass.");
  }

  console.log(
    JSON.stringify(
      {
        hierarchy: labels,
        automaticUsableRelationships: schemaPlan.usableFeatureCount,
        automaticRemovedRelationships:
          schemaPlan.excludedSparseOrConstant +
          schemaPlan.excludedDuplicates,
        beforeCloseSourceIndex: beforeClose.sourceIndex,
        atCloseSourceIndex: atClose.sourceIndex,
        futureLeakCount: atClose.futureLeakCount,
        developingProgressPct: developing.developingProgressPct,
        containedIntrabars: `${intrabarAudit.containedIntrabarCount}/${intrabarAudit.expectedIntrabarCount}`,
        intrabarPath: research.matrix[pathFeature.id][0],
        singleSourceRejected: true,
        crossSourceAccepted: true,
        multiTimeframeLensPreserved: true,
        sessionGapPct: sessionMatrix.gap_size_pct[8],
        overnightBucket: sessionMatrix.time_of_day[5],
        openingRangeSizePct: sessionMatrix.or_size_pct[8],
        adjustedBoxStateBeforeConfirmation:
          sessionMatrix.adjusted_pds_box_state[8],
        adjustedBoxStateAfterConfirmation:
          sessionMatrix.adjusted_pds_box_state[10],
        recommendedExecutionHold: horizonAnalysis.recommendedHorizon,
        losingLongHoldNetPct: twentyOne.avgNetMove,
        directHypothesisPatterns: directPatterns.length,
        walkForwardReliabilityGate: "3/4 folds",
        simulatedTrades: simulation.trades.length,
        simulatedNetProfit: simulation.netProfit,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
