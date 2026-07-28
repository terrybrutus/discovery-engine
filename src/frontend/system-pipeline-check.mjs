import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const { VALIDATION_COHORT_LIMIT } = await server.ssrLoadModule(
    "/src/lib/validationPolicy.ts",
  );
  const { selectValidatedSystemPatterns } = await server.ssrLoadModule(
    "/src/components/SystemRecommendationPanel.tsx",
  );

  assert.equal(
    VALIDATION_COHORT_LIMIT,
    100,
    "Every displayed report candidate should be eligible for validation.",
  );

  const held = Array.from({ length: 12 }, (_, index) => ({
    id: `held-${index}`,
    validationStatus: "held",
    score: 12 - index,
    sampleSize: 80 + index,
    conditions: [{ featureId: "x", operator: "gt", value: index }],
  }));
  const rejected = [
    {
      id: "not-tested",
      validationStatus: "not-tested",
      score: 999,
      sampleSize: 999,
      conditions: [],
    },
    {
      id: "degraded",
      validationStatus: "degraded",
      score: 999,
      sampleSize: 999,
      conditions: [],
    },
  ];
  const selected = selectValidatedSystemPatterns([...rejected, ...held]);
  assert.equal(
    selected.length,
    held.length,
    "The system search must not truncate validated patterns to eight.",
  );
  assert.ok(
    selected.every((pattern) => pattern.validationStatus === "held"),
    "Unvalidated and degraded patterns must never enter system construction.",
  );

  console.log(
    "System pipeline check passed: all validated patterns are retained and unvalidated patterns are excluded.",
  );
} finally {
  await server.close();
}
