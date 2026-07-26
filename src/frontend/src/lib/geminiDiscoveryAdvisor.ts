import type {
  Dataset,
  DiscoveryConfig,
  Feature,
  FeatureCategory,
} from "@/types";

const MODEL = "gemini-3.5-flash-lite";
const INPUT_PRICE_PER_MILLION = 0.3;
const OUTPUT_PRICE_PER_MILLION = 2.5;

export interface DiscoverySettingReason {
  setting: string;
  recommendation: string;
  why: string;
}

export interface DiscoveryRecommendation {
  summary: string;
  targetMode: "all" | "single";
  targetDatasetId: string;
  enabledCategories: FeatureCategory[];
  minSampleSize: number;
  minWinRate: number;
  maxDepth: number;
  holdWindowAutoFind: boolean;
  roundTripCostBps: number;
  mfeMaeRatioMode: "off" | "positive" | "auto";
  mfeMaeWindow: number;
  executionView: "every-match" | "non-overlapping";
  reasons: DiscoverySettingReason[];
  cautions: string[];
  usage: {
    promptTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

function responseSchema() {
  return {
    type: "OBJECT",
    required: [
      "summary",
      "targetMode",
      "targetDatasetId",
      "enabledCategories",
      "minSampleSize",
      "minWinRate",
      "maxDepth",
      "holdWindowAutoFind",
      "roundTripCostBps",
      "mfeMaeRatioMode",
      "mfeMaeWindow",
      "executionView",
      "reasons",
      "cautions",
    ],
    properties: {
      summary: { type: "STRING" },
      targetMode: { type: "STRING", enum: ["all", "single"] },
      targetDatasetId: { type: "STRING" },
      enabledCategories: { type: "ARRAY", items: { type: "STRING" } },
      minSampleSize: { type: "INTEGER" },
      minWinRate: { type: "NUMBER" },
      maxDepth: { type: "INTEGER" },
      holdWindowAutoFind: { type: "BOOLEAN" },
      roundTripCostBps: { type: "NUMBER" },
      mfeMaeRatioMode: {
        type: "STRING",
        enum: ["off", "positive", "auto"],
      },
      mfeMaeWindow: { type: "INTEGER" },
      executionView: {
        type: "STRING",
        enum: ["every-match", "non-overlapping"],
      },
      reasons: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["setting", "recommendation", "why"],
          properties: {
            setting: { type: "STRING" },
            recommendation: { type: "STRING" },
            why: { type: "STRING" },
          },
        },
      },
      cautions: { type: "ARRAY", items: { type: "STRING" } },
    },
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(max, Math.max(min, numeric))
    : fallback;
}

function datasetSummary(dataset: Dataset) {
  return {
    id: dataset.id,
    label: dataset.label ?? dataset.name,
    instrument: dataset.instrumentKey,
    timeframe: dataset.timeframe,
    intervalMs: dataset.intervalMs,
    rows: dataset.rowCount,
    hasOHLC: dataset.hasOHLC,
    hasVolume: dataset.hasVolume,
    outcomeField: dataset.outcomeLabel,
    columns: dataset.columns.map((column) => ({
      label: column.label,
      type: column.type,
      semantic: column.semantic ?? "unknown",
      definitionId: column.definitionId ?? "unmapped",
    })),
  };
}

export async function recommendDiscoverySettingsWithGemini(input: {
  apiKey: string;
  datasets: Dataset[];
  selectedDatasetIds: string[];
  activeDatasetId: string | null;
  categories: FeatureCategory[];
  features: Feature[];
  currentConfig: DiscoveryConfig;
  researchGoal?: string;
}): Promise<DiscoveryRecommendation> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("Connect your Gemini API key first.");
  const selected = input.datasets.filter((dataset) =>
    input.selectedDatasetIds.includes(dataset.id),
  );
  if (selected.length === 0) {
    throw new Error("Select at least one generated dataset first.");
  }
  if (input.categories.length === 0) {
    throw new Error("Generate schema-supported relationships first.");
  }

  const featureCatalog = input.categories.map((category) => {
    const matching = input.features.filter(
      (feature) => feature.category === category,
    );
    return {
      category,
      count: matching.length,
      examples: matching.slice(0, 12).map((feature) => feature.name),
    };
  });
  const prompt = [
    "You configure a deterministic quantitative pattern-discovery engine.",
    "Recommend research settings from the supplied upload schema and timeframe hierarchy. Do not analyze or invent market outcomes.",
    "Use only dataset IDs and relationship categories explicitly supplied below.",
    "Choose targetMode=single with the lowest practical execution timeframe when multiple timeframes of the same instrument are intended for top-down confluence. Choose targetMode=all when comparable datasets should each supply independent outcomes, such as a same-timeframe symbol universe.",
    "Enable only categories that materially match the uploaded fields and the stated research goal. Multi-Timeframe must remain enabled when multiple sources are used.",
    "Use maxDepth 1 only when the stated goal is a direct one-relationship hypothesis test. Prefer maxDepth 2 for a broad/large first pass and 3 for balanced targeted work. Depth 4+ should be exceptional because it is slow and increases false discoveries.",
    "Use Auto-find holds unless the user explicitly requests a fixed horizon. Recommend non-overlapping execution for candidate-system screening.",
    "Minimum sample and win-rate settings are discovery filters, not guarantees. Avoid making the first pass so restrictive that it finds nothing.",
    "Costs are an estimated all-in round trip in basis points. If the schema does not identify an instrument-specific cost, use a conservative 5 bps and say that it must be customized.",
    `Selected dataset summaries (metadata and column names only; no raw rows): ${JSON.stringify(selected.map(datasetSummary))}`,
    `Available relationship categories and examples: ${JSON.stringify(featureCatalog)}`,
    `Current settings: ${JSON.stringify({
      activeDatasetId: input.activeDatasetId,
      targetMode:
        selected.length > 1 ? "multi-source available" : "single source",
      minSampleSize: input.currentConfig.minSampleSize,
      minWinRate: input.currentConfig.minWinRate,
      maxDepth: input.currentConfig.maxDepth,
      holdWindowAutoFind: input.currentConfig.holdWindowAutoFind,
      roundTripCostBps: input.currentConfig.roundTripCostBps,
      mfeMaeRatioMode: input.currentConfig.mfeMaeRatioMode,
      mfeMaeWindow: input.currentConfig.mfeMaeWindow,
    })}`,
    input.researchGoal?.trim()
      ? `User's research goal: ${input.researchGoal.trim()}`
      : "No narrower research goal was supplied; recommend a useful first-pass configuration.",
    "Return a concise summary, the complete recommended setting values, 3-8 reasons, and any cautions.",
  ].join("\n\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4000,
          responseMimeType: "application/json",
          responseSchema: responseSchema(),
        },
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gemini settings request failed (${response.status}): ${body.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no settings recommendation.");
  const decoded = JSON.parse(text) as Partial<DiscoveryRecommendation>;
  const availableCategories = new Set(input.categories);
  const enabledCategories = (decoded.enabledCategories ?? []).filter(
    (category): category is FeatureCategory =>
      typeof category === "string" && availableCategories.has(category),
  );
  if (
    selected.length > 1 &&
    availableCategories.has("Multi-Timeframe") &&
    !enabledCategories.includes("Multi-Timeframe")
  ) {
    enabledCategories.push("Multi-Timeframe");
  }
  if (enabledCategories.length === 0) {
    throw new Error(
      "Gemini did not select any available relationship categories. Please retry.",
    );
  }
  const validTarget =
    selected.find((dataset) => dataset.id === decoded.targetDatasetId)?.id ??
    input.activeDatasetId ??
    selected[0].id;
  const promptTokens =
    payload.usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4);
  const outputTokens =
    payload.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);

  return {
    summary:
      typeof decoded.summary === "string"
        ? decoded.summary
        : "Recommended a schema-aware first-pass configuration.",
    targetMode:
      decoded.targetMode === "all" || selected.length === 1 ? "all" : "single",
    targetDatasetId: validTarget,
    enabledCategories,
    minSampleSize: Math.round(
      clamp(decoded.minSampleSize, 30, 500, input.currentConfig.minSampleSize),
    ),
    minWinRate: clamp(
      decoded.minWinRate,
      50,
      80,
      input.currentConfig.minWinRate,
    ),
    maxDepth: Math.round(
      clamp(decoded.maxDepth, 1, 6, input.currentConfig.maxDepth),
    ),
    holdWindowAutoFind: decoded.holdWindowAutoFind !== false,
    roundTripCostBps: clamp(
      decoded.roundTripCostBps,
      0,
      100,
      input.currentConfig.roundTripCostBps ?? 5,
    ),
    mfeMaeRatioMode:
      decoded.mfeMaeRatioMode === "positive" ||
      decoded.mfeMaeRatioMode === "auto"
        ? decoded.mfeMaeRatioMode
        : "off",
    mfeMaeWindow: Math.round(
      clamp(decoded.mfeMaeWindow, 1, 50, input.currentConfig.mfeMaeWindow),
    ),
    executionView:
      decoded.executionView === "every-match"
        ? "every-match"
        : "non-overlapping",
    reasons: Array.isArray(decoded.reasons)
      ? decoded.reasons
          .filter(
            (reason) =>
              typeof reason?.setting === "string" &&
              typeof reason?.recommendation === "string" &&
              typeof reason?.why === "string",
          )
          .slice(0, 8)
      : [],
    cautions: Array.isArray(decoded.cautions)
      ? decoded.cautions
          .filter((caution): caution is string => typeof caution === "string")
          .slice(0, 6)
      : [],
    usage: {
      promptTokens,
      outputTokens,
      estimatedCostUsd:
        (promptTokens / 1_000_000) * INPUT_PRICE_PER_MILLION +
        (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION,
    },
  };
}
