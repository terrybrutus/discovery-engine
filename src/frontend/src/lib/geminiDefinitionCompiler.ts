import { validateDefinition } from "@/lib/definitionRegistry";
import type { Dataset, IndicatorDefinition } from "@/types";

const MODEL = "gemini-2.5-flash-lite";
const INPUT_PRICE_PER_MILLION = 0.1;
const OUTPUT_PRICE_PER_MILLION = 0.4;
const MAX_SOURCE_CHARS = 80_000;

export interface DefinitionCompilationRequest {
  apiKey: string;
  datasets: Dataset[];
  pineSource?: string;
  userNotes?: string;
}

export interface DefinitionCompilationResult {
  definitions: IndicatorDefinition[];
  usage: {
    promptTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  model: string;
}

interface ColumnSummary {
  label: string;
  normalizedKey: string;
  count: number;
  finiteCount: number;
  uniqueApprox: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  standardDeviation: number | null;
  datasets: string[];
}

function summarizeColumns(datasets: Dataset[]): ColumnSummary[] {
  const grouped = new Map<
    string,
    { label: string; key: string; values: number[]; datasets: Set<string> }
  >();
  for (const dataset of datasets) {
    for (const column of dataset.columns) {
      if (column.type !== "numeric") continue;
      const values = dataset.columnValues?.[column.key];
      if (!values) continue;
      const groupKey = column.label.trim().toLowerCase();
      const group = grouped.get(groupKey) ?? {
        label: column.label,
        key: column.key,
        values: [],
        datasets: new Set<string>(),
      };
      // Summary statistics do not need every row. A deterministic stride
      // bounds memory and prevents raw research histories reaching the model.
      const stride = Math.max(1, Math.floor(values.length / 2_000));
      for (let index = 0; index < values.length; index += stride) {
        if (Number.isFinite(values[index])) group.values.push(values[index]);
      }
      group.datasets.add(dataset.label ?? dataset.name);
      grouped.set(groupKey, group);
    }
  }
  return [...grouped.values()].map((group) => {
    const count = group.values.length;
    const sum = group.values.reduce((total, value) => total + value, 0);
    const mean = count ? sum / count : null;
    const variance =
      count && mean != null
        ? group.values.reduce(
            (total, value) => total + (value - mean) ** 2,
            0,
          ) / count
        : null;
    return {
      label: group.label,
      normalizedKey: group.key,
      count,
      finiteCount: count,
      uniqueApprox: new Set(group.values.slice(0, 5_000)).size,
      min: count ? Math.min(...group.values) : null,
      max: count ? Math.max(...group.values) : null,
      mean,
      standardDeviation: variance == null ? null : Math.sqrt(variance),
      datasets: [...group.datasets],
    };
  });
}

function sourceHash(value: string): string {
  // Stable non-cryptographic content signature. It is used only as a cache
  // key/version marker, never for authentication.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function estimateCost(promptTokens: number, outputTokens: number): number {
  return (
    (promptTokens / 1_000_000) * INPUT_PRICE_PER_MILLION +
    (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION
  );
}

export function previewDefinitionCompilation(
  datasets: Dataset[],
  pineSource = "",
  userNotes = "",
): {
  columns: number;
  approximateInputTokens: number;
  worstCaseCostUsd: number;
} {
  const summaries = summarizeColumns(datasets);
  const chars =
    JSON.stringify(summaries).length +
    Math.min(pineSource.length, MAX_SOURCE_CHARS) +
    userNotes.length +
    6_000;
  const approximateInputTokens = Math.ceil(chars / 4);
  // Bound output to roughly 500 tokens per definition.
  const outputTokens = Math.max(1_000, summaries.length * 500);
  return {
    columns: summaries.length,
    approximateInputTokens,
    worstCaseCostUsd: estimateCost(approximateInputTokens, outputTokens),
  };
}

function responseSchema() {
  return {
    type: "OBJECT",
    properties: {
      definitions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            canonicalName: { type: "STRING" },
            description: { type: "STRING" },
            role: {
              type: "STRING",
              enum: [
                "price",
                "price-level",
                "upper-band",
                "lower-band",
                "basis",
                "oscillator",
                "volume",
                "volatility",
                "cumulative",
                "percentage",
                "binary-event",
                "generic-series",
              ],
            },
            semantic: {
              type: "STRING",
              enum: [
                "price-level",
                "binary-event",
                "oscillator",
                "cumulative",
                "percentage",
                "generic",
              ],
            },
            units: {
              type: "STRING",
              enum: [
                "price",
                "percent",
                "ratio",
                "bounded",
                "count",
                "event",
                "unknown",
              ],
            },
            expectedRange: {
              type: "ARRAY",
              items: { type: "NUMBER" },
              minItems: 2,
              maxItems: 2,
            },
            parameters: { type: "OBJECT" },
            stationary: { type: "BOOLEAN" },
            directionalMeaning: { type: "STRING" },
            supportedRelationships: {
              type: "ARRAY",
              items: {
                type: "STRING",
                enum: [
                  "normalized-value",
                  "percentile",
                  "zscore",
                  "direction",
                  "slope",
                  "acceleration",
                  "persistence",
                  "cross",
                  "touch",
                  "rejection",
                  "breakout",
                  "failed-breakout",
                  "compression",
                  "expansion",
                  "regime-transition",
                  "divergence",
                  "convergence",
                  "sequence",
                ],
              },
            },
            aliases: { type: "ARRAY", items: { type: "STRING" } },
            confidence: { type: "NUMBER" },
          },
          required: [
            "canonicalName",
            "description",
            "role",
            "semantic",
            "units",
            "stationary",
            "supportedRelationships",
            "aliases",
            "confidence",
          ],
        },
      },
    },
    required: ["definitions"],
  };
}

export async function compileDefinitionsWithGemini(
  request: DefinitionCompilationRequest,
): Promise<DefinitionCompilationResult> {
  const apiKey = request.apiKey.trim();
  if (!apiKey) throw new Error("Enter a Gemini API key for this request.");
  const summaries = summarizeColumns(request.datasets);
  if (summaries.length === 0) {
    throw new Error("No imported numeric columns are available to define.");
  }
  const pineSource = (request.pineSource ?? "").slice(0, MAX_SOURCE_CHARS);
  const signature = sourceHash(
    JSON.stringify(
      summaries.map(({ label, normalizedKey }) => ({ label, normalizedKey })),
    ) + pineSource,
  );
  const prompt = [
    "You are compiling deterministic metadata for a quantitative trading research engine.",
    "Create exactly one definition for every supplied column. Do not invent columns or trading profitability.",
    "Classify what each output represents and which generic relationships are mathematically valid.",
    "Absolute price-valued series and cumulative totals must be marked non-stationary.",
    "Bands must be identified as upper-band, lower-band, or basis so the engine can compare width and nesting.",
    "Oscillators should support pivots/divergence when meaningful. Discrete signals should be binary-event.",
    "The output is metadata only; calculations remain deterministic in the application.",
    `Column summaries (sampled statistics only, never raw rows): ${JSON.stringify(summaries)}`,
    pineSource ? `Optional Pine/source definition:\n${pineSource}` : "",
    request.userNotes ? `User notes:\n${request.userNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

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
          maxOutputTokens: Math.min(
            32_000,
            Math.max(4_000, summaries.length * 600),
          ),
          responseMimeType: "application/json",
          responseSchema: responseSchema(),
        },
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gemini definition request failed (${response.status}): ${body.slice(0, 400)}`,
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
  if (!text) throw new Error("Gemini returned no definition payload.");
  const decoded = JSON.parse(text) as {
    definitions?: Partial<IndicatorDefinition>[];
  };
  if (!Array.isArray(decoded.definitions)) {
    throw new Error("Gemini response did not contain a definitions array.");
  }
  const timestamp = Date.now();
  const definitions = decoded.definitions.map((definition, index) =>
    validateDefinition({
      ...definition,
      id: `ai.${(
        definition.canonicalName ??
        summaries[index]?.label ??
        "series"
      )
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.|\.$/g, "")}.${signature}`,
      version: 1,
      canonicalName:
        definition.canonicalName ??
        summaries[index]?.label ??
        "Imported series",
      description:
        definition.description ?? "AI-assisted imported indicator definition.",
      role: definition.role ?? "generic-series",
      semantic: definition.semantic ?? "generic",
      units: definition.units ?? "unknown",
      stationary: definition.stationary ?? false,
      supportedRelationships: definition.supportedRelationships ?? [
        "percentile",
        "direction",
        "slope",
      ],
      aliases: definition.aliases?.length
        ? definition.aliases
        : [summaries[index]?.label ?? definition.canonicalName ?? "series"],
      source: "ai",
      confidence: definition.confidence ?? 0.7,
      sourceHash: signature,
      reviewed: false,
      updatedAt: timestamp,
    } as IndicatorDefinition),
  );
  const promptTokens =
    payload.usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4);
  const outputTokens =
    payload.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
  return {
    definitions,
    usage: {
      promptTokens,
      outputTokens,
      estimatedCostUsd: estimateCost(promptTokens, outputTokens),
    },
    model: MODEL,
  };
}
