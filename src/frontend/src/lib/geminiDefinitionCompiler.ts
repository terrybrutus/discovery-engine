import { validateDefinition } from "@/lib/definitionRegistry";
import type { Dataset, IndicatorDefinition } from "@/types";

// GA low-cost model. The previous 2.5 Flash-Lite endpoint is unavailable to
// new Gemini API users.
const MODEL = "gemini-3.5-flash-lite";
const INPUT_PRICE_PER_MILLION = 0.3;
const OUTPUT_PRICE_PER_MILLION = 2.5;
const MAX_SOURCE_CHARS_PER_INDICATOR = 40_000;
const MAX_TOTAL_SOURCE_CHARS = 120_000;

export interface IndicatorSourceInput {
  id: string;
  name: string;
  source: string;
}

export interface DefinitionCompilationRequest {
  apiKey: string;
  datasets: Dataset[];
  indicatorSources?: IndicatorSourceInput[];
  userNotes?: string;
}

export interface DefinitionCompilationResult {
  proposals: DefinitionMappingProposal[];
  usage: {
    promptTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  model: string;
}

export interface DefinitionMappingProposal {
  definition: IndicatorDefinition;
  column: {
    id: string;
    label: string;
    displayLabel: string;
    position: number;
    datasets: string[];
  };
  assignments: { datasetId: string; columnKey: string }[];
  indicatorSourceId: string;
  indicatorSourceName: string;
  outputName: string;
  mappingReason: string;
}

interface ColumnSummary {
  columnId: string;
  label: string;
  displayLabel: string;
  normalizedKey: string;
  columnIndex: number;
  occurrence: number;
  count: number;
  finiteCount: number;
  uniqueApprox: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  standardDeviation: number | null;
  datasets: string[];
  assignments: { datasetId: string; columnKey: string }[];
}

function summarizeColumns(datasets: Dataset[]): ColumnSummary[] {
  const grouped = new Map<
    string,
    {
      columnId: string;
      label: string;
      displayLabel: string;
      key: string;
      columnIndex: number;
      occurrence: number;
      values: number[];
      datasets: Set<string>;
      assignments: { datasetId: string; columnKey: string }[];
    }
  >();
  for (const dataset of datasets) {
    const totalByLabel = new Map<string, number>();
    for (const column of dataset.columns) {
      const label = column.label.trim().toLowerCase();
      totalByLabel.set(label, (totalByLabel.get(label) ?? 0) + 1);
    }
    const seenByLabel = new Map<string, number>();
    for (
      let columnIndex = 0;
      columnIndex < dataset.columns.length;
      columnIndex++
    ) {
      const column = dataset.columns[columnIndex];
      if (column.type !== "numeric") continue;
      const values = dataset.columnValues?.[column.key];
      if (!values) continue;
      const normalizedLabel = column.label.trim().toLowerCase();
      const occurrence = (seenByLabel.get(normalizedLabel) ?? 0) + 1;
      seenByLabel.set(normalizedLabel, occurrence);
      const duplicated = (totalByLabel.get(normalizedLabel) ?? 0) > 1;
      const displayLabel = duplicated
        ? `${column.label} #${occurrence}`
        : column.label;
      const columnId = `column-${columnIndex + 1}:${column.key}`;
      // Position is deliberately part of the request identity. If the chart
      // order changes, the next compile is a fresh rematch rather than a
      // silent reuse of an old positional assignment.
      const groupKey = `${columnIndex}:${column.key}:${normalizedLabel}`;
      const group = grouped.get(groupKey) ?? {
        columnId,
        label: column.label,
        displayLabel,
        key: column.key,
        columnIndex,
        occurrence,
        values: [],
        datasets: new Set<string>(),
        assignments: [],
      };
      // Summary statistics do not need every row. A deterministic stride
      // bounds memory and prevents raw research histories reaching the model.
      const stride = Math.max(1, Math.floor(values.length / 2_000));
      for (let index = 0; index < values.length; index += stride) {
        if (Number.isFinite(values[index])) group.values.push(values[index]);
      }
      group.datasets.add(dataset.label ?? dataset.name);
      group.assignments.push({
        datasetId: dataset.id,
        columnKey: column.key,
      });
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
      columnId: group.columnId,
      label: group.label,
      displayLabel: group.displayLabel,
      normalizedKey: group.key,
      columnIndex: group.columnIndex,
      occurrence: group.occurrence,
      count,
      finiteCount: count,
      uniqueApprox: new Set(group.values.slice(0, 5_000)).size,
      min: count ? Math.min(...group.values) : null,
      max: count ? Math.max(...group.values) : null,
      mean,
      standardDeviation: variance == null ? null : Math.sqrt(variance),
      datasets: [...group.datasets],
      assignments: group.assignments,
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
  indicatorSources: IndicatorSourceInput[] = [],
  userNotes = "",
): {
  columns: number;
  approximateInputTokens: number;
  worstCaseCostUsd: number;
} {
  const summaries = summarizeColumns(datasets);
  const sourceChars = indicatorSources.reduce(
    (sum, indicator) =>
      sum +
      Math.min(indicator.source.length, MAX_SOURCE_CHARS_PER_INDICATOR) +
      indicator.name.length,
    0,
  );
  const chars =
    JSON.stringify(summaries).length +
    Math.min(sourceChars, MAX_TOTAL_SOURCE_CHARS) +
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
            columnId: { type: "STRING" },
            indicatorSourceId: { type: "STRING" },
            outputName: { type: "STRING" },
            mappingReason: { type: "STRING" },
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
            "columnId",
            "indicatorSourceId",
            "outputName",
            "mappingReason",
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
  const indicatorSources = (request.indicatorSources ?? [])
    .filter((indicator) => indicator.source.trim())
    .map((indicator) => ({
      id: indicator.id,
      name: indicator.name.trim() || "Unnamed indicator",
      source: indicator.source.slice(0, MAX_SOURCE_CHARS_PER_INDICATOR),
    }));
  let remainingSourceChars = MAX_TOTAL_SOURCE_CHARS;
  const boundedSources = indicatorSources.map((indicator) => {
    const source = indicator.source.slice(0, remainingSourceChars);
    remainingSourceChars -= source.length;
    return { ...indicator, source };
  });
  const signature = sourceHash(
    JSON.stringify(
      summaries.map(({ columnId, label, normalizedKey }) => ({
        columnId,
        label,
        normalizedKey,
      })),
    ) + JSON.stringify(boundedSources),
  );
  const promptSummaries = summaries.map(
    ({ assignments: _assignments, ...summary }) => summary,
  );
  const sourcePayload =
    boundedSources.length > 0
      ? boundedSources.map((indicator) => ({
          id: indicator.id,
          userLabel: indicator.name,
          source: indicator.source,
        }))
      : [];
  const prompt = [
    "You are compiling deterministic metadata for a quantitative trading research engine.",
    "Create exactly one definition for every supplied columnId. Never merge columns merely because their visible labels match.",
    "Map each column to the indicator source that most plausibly produced it. Use the indicator declaration/short title, input defaults, calculations, variable names, plot titles, plot order, column position, and sampled value relationships.",
    'Set indicatorSourceId to one supplied source id, or exactly "unmapped" when the evidence is insufficient.',
    "Changing chart order can change column position, so this request is a fresh mapping. Do not assume a saved positional mapping.",
    "canonicalName must be specific enough to distinguish repeated outputs, for example 'BB 20/2 Upper' versus 'Keltner 20/1.5 Upper'.",
    "outputName is the source variable or plot title that produced the field. mappingReason briefly states the concrete evidence.",
    "When source code is supplied, parameters MUST preserve every calculation input required to reproduce the mapped output: lengths, multipliers, smoothing methods, price source, volatility method, and relevant input defaults. Use concise parameter names and concrete values from the source; do not return an empty parameters object for a mapped source.",
    "Classify what each output represents and which generic relationships are mathematically valid.",
    "Absolute price-valued series and cumulative totals must be marked non-stationary.",
    "Bands must be identified as upper-band, lower-band, or basis so the engine can compare width and nesting.",
    "Oscillators should support pivots/divergence when meaningful. Discrete signals should be binary-event.",
    "The output is metadata only; calculations remain deterministic in the application.",
    `Unique positional column summaries (sampled statistics only, never raw rows): ${JSON.stringify(promptSummaries)}`,
    sourcePayload.length
      ? `Separate indicator sources with stable request ids:\n${JSON.stringify(sourcePayload)}`
      : "No indicator source was supplied. Use unmapped and infer only from each unique column summary.",
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
    definitions?: (Partial<IndicatorDefinition> & {
      columnId?: string;
      indicatorSourceId?: string;
      outputName?: string;
      mappingReason?: string;
    })[];
  };
  if (!Array.isArray(decoded.definitions)) {
    throw new Error("Gemini response did not contain a definitions array.");
  }
  const timestamp = Date.now();
  const decodedByColumnId = new Map(
    decoded.definitions
      .filter((definition) => definition.columnId)
      .map((definition) => [definition.columnId as string, definition]),
  );
  const proposals = summaries.map((summary, index) => {
    const proposed =
      decodedByColumnId.get(summary.columnId) ??
      decoded.definitions?.[index] ??
      {};
    const indicatorSourceId = boundedSources.some(
      (source) => source.id === proposed.indicatorSourceId,
    )
      ? (proposed.indicatorSourceId as string)
      : "unmapped";
    const indicatorSourceName =
      boundedSources.find((source) => source.id === indicatorSourceId)?.name ??
      "Unmapped";
    const canonicalName =
      proposed.canonicalName ?? summary.displayLabel ?? "Imported series";
    const definition = validateDefinition({
      ...proposed,
      id: `ai.${canonicalName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.|\.$/g, "")}.${summary.columnId
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")}.${signature}`,
      version: 1,
      canonicalName,
      description:
        proposed.description ?? "AI-assisted imported indicator definition.",
      role: proposed.role ?? "generic-series",
      semantic: proposed.semantic ?? "generic",
      units: proposed.units ?? "unknown",
      parameters: {
        ...(proposed.parameters ?? {}),
        indicatorSourceId,
        columnIdentity: summary.columnId,
        outputName: proposed.outputName ?? summary.label,
      },
      stationary: proposed.stationary ?? false,
      supportedRelationships: proposed.supportedRelationships ?? [
        "percentile",
        "direction",
        "slope",
      ],
      // A positional duplicate alias such as "Upper #2" is safe. The raw
      // ambiguous alias "Upper" is intentionally not stored for duplicates.
      aliases: [
        summary.columnId,
        summary.displayLabel,
        ...(proposed.aliases ?? []).filter(
          (alias) =>
            alias.trim().toLowerCase() !== summary.label.trim().toLowerCase() ||
            summary.displayLabel === summary.label,
        ),
      ],
      source: "ai",
      confidence: proposed.confidence ?? 0.7,
      sourceHash: signature,
      reviewed: false,
      updatedAt: timestamp,
    } as IndicatorDefinition);
    return {
      definition,
      column: {
        id: summary.columnId,
        label: summary.label,
        displayLabel: summary.displayLabel,
        position: summary.columnIndex + 1,
        datasets: summary.datasets,
      },
      assignments: summary.assignments,
      indicatorSourceId,
      indicatorSourceName,
      outputName: proposed.outputName ?? summary.label,
      mappingReason:
        proposed.mappingReason ??
        "No source-specific mapping explanation was returned.",
    };
  });
  const promptTokens =
    payload.usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4);
  const outputTokens =
    payload.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
  return {
    proposals,
    usage: {
      promptTokens,
      outputTokens,
      estimatedCostUsd: estimateCost(promptTokens, outputTokens),
    },
    model: MODEL,
  };
}
