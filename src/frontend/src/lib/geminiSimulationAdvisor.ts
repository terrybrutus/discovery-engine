import type { CandidateSimulationConfig } from "@/lib/candidateSimulation";
import type { CandidateSystemOptimization } from "@/lib/candidateSystemOptimizer";
import type { Pattern } from "@/types";

const MODEL = "gemini-3.5-flash-lite";

export interface SimulationRecommendation {
  config: CandidateSimulationConfig;
  summary: string;
  cautions: string[];
}

export interface PlainSystemExplanation {
  title: string;
  plainSteps: string[];
  whyItPassed: string;
  warnings: string[];
  pineBuildBrief: string;
}

function schema() {
  return {
    type: "OBJECT",
    required: ["config", "summary", "cautions"],
    properties: {
      config: {
        type: "OBJECT",
        required: [
          "entryMode",
          "entryExpiryBars",
          "stopPct",
          "targetMode",
          "targetPct",
          "rewardRiskMultiple",
          "maxHoldBars",
          "roundTripCostBps",
          "startingCapital",
          "riskPerTradePct",
          "nonOverlapping",
        ],
        properties: {
          entryMode: {
            type: "STRING",
            enum: ["next-open", "signal-close", "box-boundary-limit"],
          },
          entryExpiryBars: { type: "INTEGER" },
          stopPct: { type: "NUMBER" },
          targetMode: {
            type: "STRING",
            enum: ["fixed-percent", "risk-multiple", "box-midpoint"],
          },
          targetPct: { type: "NUMBER" },
          rewardRiskMultiple: { type: "NUMBER" },
          maxHoldBars: { type: "INTEGER" },
          roundTripCostBps: { type: "NUMBER" },
          startingCapital: { type: "NUMBER" },
          riskPerTradePct: { type: "NUMBER" },
          nonOverlapping: { type: "BOOLEAN" },
        },
      },
      summary: { type: "STRING" },
      cautions: { type: "ARRAY", items: { type: "STRING" } },
    },
  };
}

function finite(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(min, Math.min(max, numeric))
    : fallback;
}

export async function recommendSimulationWithGemini(input: {
  apiKey: string;
  pattern: Pattern;
  currentConfig: CandidateSimulationConfig;
  userGoal?: string;
}): Promise<SimulationRecommendation> {
  if (!input.apiKey.trim()) throw new Error("Connect your Gemini key first.");
  const prompt = [
    "Recommend conservative starting assumptions for replaying one statistically discovered market event as a candidate trading system.",
    "You do not calculate profitability and must not claim the pattern works. The deterministic browser simulator will calculate every trade from uploaded bars.",
    "Use box-boundary-limit plus box-midpoint only if the recipe explicitly describes adjusted previous-session box boundaries or midpoint behavior. Otherwise prefer next-open because the discovery signal becomes known after its observation closes.",
    "Use nonOverlapping=true. Use the recommended pattern horizon when present. Infer stop/target starting values from stored MFE/MAE only as exploratory assumptions and clearly warn that they are not optimized rules.",
    `Pattern metadata: ${JSON.stringify({
      label: input.pattern.label,
      direction: input.pattern.direction,
      timeframe: input.pattern.targetTimeframe,
      horizon: input.pattern.horizon,
      horizonAnalysis: input.pattern.horizonAnalysis,
      avgMFE: input.pattern.avgMFE,
      avgMAE: input.pattern.avgMAE,
      recipe: input.pattern.reproductionRecipe,
    })}`,
    `Current simulator assumptions: ${JSON.stringify(input.currentConfig)}`,
    input.userGoal?.trim()
      ? `User goal: ${input.userGoal.trim()}`
      : "User supplied no additional execution notes.",
  ].join("\n\n");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey.trim(),
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2000,
          responseMimeType: "application/json",
          responseSchema: schema(),
        },
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gemini simulation request failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no simulation recommendation.");
  const decoded = JSON.parse(text) as Partial<SimulationRecommendation>;
  const proposed = decoded.config ?? input.currentConfig;
  return {
    config: {
      entryMode:
        proposed.entryMode === "signal-close" ||
        proposed.entryMode === "box-boundary-limit"
          ? proposed.entryMode
          : "next-open",
      entryExpiryBars: Math.round(
        finite(
          proposed.entryExpiryBars,
          input.currentConfig.entryExpiryBars,
          1,
          50,
        ),
      ),
      stopPct: finite(proposed.stopPct, input.currentConfig.stopPct, 0.001, 25),
      targetMode:
        proposed.targetMode === "fixed-percent" ||
        proposed.targetMode === "box-midpoint"
          ? proposed.targetMode
          : "risk-multiple",
      targetPct: finite(
        proposed.targetPct,
        input.currentConfig.targetPct,
        0.001,
        50,
      ),
      rewardRiskMultiple: finite(
        proposed.rewardRiskMultiple,
        input.currentConfig.rewardRiskMultiple,
        0.1,
        20,
      ),
      maxHoldBars: Math.round(
        finite(proposed.maxHoldBars, input.currentConfig.maxHoldBars, 1, 500),
      ),
      roundTripCostBps: finite(
        proposed.roundTripCostBps,
        input.currentConfig.roundTripCostBps,
        0,
        500,
      ),
      startingCapital: finite(
        proposed.startingCapital,
        input.currentConfig.startingCapital,
        100,
        100_000_000,
      ),
      riskPerTradePct: finite(
        proposed.riskPerTradePct,
        input.currentConfig.riskPerTradePct,
        0.01,
        10,
      ),
      nonOverlapping: true,
    },
    summary:
      typeof decoded.summary === "string"
        ? decoded.summary
        : "Exploratory assumptions generated from the stored recipe.",
    cautions: Array.isArray(decoded.cautions)
      ? decoded.cautions.filter(
          (caution): caution is string => typeof caution === "string",
        )
      : [],
  };
}

export async function explainOptimizedSystemWithGemini(input: {
  apiKey: string;
  pattern: Pattern;
  optimization: CandidateSystemOptimization;
}): Promise<PlainSystemExplanation> {
  if (!input.apiKey.trim()) throw new Error("Connect your Gemini key first.");
  const candidate = input.optimization.candidates.find(
    (item) => item.id === input.optimization.recommendedCandidateId,
  );
  if (!candidate) throw new Error("No optimized candidate passed every gate.");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey.trim(),
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  "Explain this deterministic candidate trading system in language a fifth grader or non-technical grandparent can follow.",
                  "Do not change, optimize, add, or guess any rule. Do not promise profitability.",
                  "Use short commands for the front-end steps. Keep statistical explanation in whyItPassed and warnings.",
                  "The Pine build brief must preserve exact signal timing, timeframe, conditions, entry, stop, target, maximum hold, overlap rule, costs, and ambiguity handling.",
                  `Pattern: ${JSON.stringify({
                    label: input.pattern.label,
                    recipe: input.pattern.reproductionRecipe,
                  })}`,
                  `Locked candidate: ${JSON.stringify(candidate)}`,
                  `Methodology: ${JSON.stringify(input.optimization.methodology)}`,
                ].join("\n\n"),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.05,
          maxOutputTokens: 2500,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            required: [
              "title",
              "plainSteps",
              "whyItPassed",
              "warnings",
              "pineBuildBrief",
            ],
            properties: {
              title: { type: "STRING" },
              plainSteps: { type: "ARRAY", items: { type: "STRING" } },
              whyItPassed: { type: "STRING" },
              warnings: { type: "ARRAY", items: { type: "STRING" } },
              pineBuildBrief: { type: "STRING" },
            },
          },
        },
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gemini system explanation failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no system explanation.");
  const decoded = JSON.parse(text) as Partial<PlainSystemExplanation>;
  if (
    typeof decoded.title !== "string" ||
    !Array.isArray(decoded.plainSteps) ||
    typeof decoded.whyItPassed !== "string" ||
    !Array.isArray(decoded.warnings) ||
    typeof decoded.pineBuildBrief !== "string"
  ) {
    throw new Error("Gemini returned an invalid system explanation.");
  }
  return {
    title: decoded.title,
    plainSteps: decoded.plainSteps
      .filter((step): step is string => typeof step === "string")
      .slice(0, 10),
    whyItPassed: decoded.whyItPassed,
    warnings: decoded.warnings
      .filter((warning): warning is string => typeof warning === "string")
      .slice(0, 6),
    pineBuildBrief: decoded.pineBuildBrief,
  };
}
