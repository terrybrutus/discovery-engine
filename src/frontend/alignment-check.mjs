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
  const { meetsConfluenceRequirement } = await server.ssrLoadModule(
    "/src/lib/patternConfluence.ts",
  );

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

  console.log(
    JSON.stringify(
      {
        hierarchy: labels,
        beforeCloseSourceIndex: beforeClose.sourceIndex,
        atCloseSourceIndex: atClose.sourceIndex,
        futureLeakCount: atClose.futureLeakCount,
        developingProgressPct: developing.developingProgressPct,
        containedIntrabars: `${intrabarAudit.containedIntrabarCount}/${intrabarAudit.expectedIntrabarCount}`,
        intrabarPath: research.matrix[pathFeature.id][0],
        singleSourceRejected: true,
        crossSourceAccepted: true,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
