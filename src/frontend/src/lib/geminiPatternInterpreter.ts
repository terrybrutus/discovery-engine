import type { Pattern, ValidationResult } from "@/types";

// Keep interpretation on the same generally available, low-cost model as the
// definition compiler.
const MODEL = "gemini-3.5-flash-lite";
const INPUT_PRICE_PER_MILLION = 0.3;
const OUTPUT_PRICE_PER_MILLION = 2.5;

export interface InterpretedPattern {
  patternId: string;
  setupNarrative: string;
  whyItMayMatter: string;
  statisticalConcerns: string[];
  nextBacktest: string;
}

export interface PatternInterpretation {
  overview: string;
  strongestCandidates: InterpretedPattern[];
  rejectedOrWeak: { patternId: string; reason: string }[];
  usage: {
    promptTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseSchema() {
  return {
    type: "OBJECT",
    properties: {
      overview: { type: "STRING" },
      strongestCandidates: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            patternId: { type: "STRING" },
            setupNarrative: { type: "STRING" },
            whyItMayMatter: { type: "STRING" },
            statisticalConcerns: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
            nextBacktest: { type: "STRING" },
          },
          required: [
            "patternId",
            "setupNarrative",
            "whyItMayMatter",
            "statisticalConcerns",
            "nextBacktest",
          ],
        },
      },
      rejectedOrWeak: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            patternId: { type: "STRING" },
            reason: { type: "STRING" },
          },
          required: ["patternId", "reason"],
        },
      },
    },
    required: ["overview", "strongestCandidates", "rejectedOrWeak"],
  };
}

function firstString(record: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function firstArray(record: JsonRecord, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function normalizeInterpretation(
  text: string,
): Omit<PatternInterpretation, "usage"> {
  const decoded = JSON.parse(text) as unknown;
  if (!isRecord(decoded)) {
    throw new Error("Gemini returned a report in an unsupported JSON format.");
  }

  // The enforced schema should produce the top-level form. These wrapper
  // fallbacks keep otherwise valid responses usable if a model version wraps
  // the report or changes only casing/naming.
  const possibleRoots: JsonRecord[] = [decoded];
  for (const key of ["interpretation", "report", "result"]) {
    const value = decoded[key];
    if (isRecord(value)) possibleRoots.push(value);
  }
  const root =
    possibleRoots.find(
      (candidate) =>
        firstString(candidate, ["overview", "summary"]) !== undefined &&
        firstArray(candidate, [
          "strongestCandidates",
          "strongest_candidates",
          "strongestPatterns",
          "candidates",
        ]) !== undefined,
    ) ?? decoded;

  const overview = firstString(root, ["overview", "summary"]);
  const strongest = firstArray(root, [
    "strongestCandidates",
    "strongest_candidates",
    "strongestPatterns",
    "candidates",
  ]);
  const rejected = firstArray(root, [
    "rejectedOrWeak",
    "rejected_or_weak",
    "rejectedCandidates",
    "weakCandidates",
  ]);
  if (
    overview === undefined ||
    strongest === undefined ||
    rejected === undefined
  ) {
    throw new Error(
      "Gemini returned JSON but omitted required report sections. Please retry.",
    );
  }

  const strongestCandidates = strongest.flatMap((value) => {
    if (!isRecord(value)) return [];
    const patternId = firstString(value, ["patternId", "pattern_id", "id"]);
    if (!patternId) return [];
    const rawConcerns =
      value.statisticalConcerns ?? value.statistical_concerns ?? value.concerns;
    const statisticalConcerns = Array.isArray(rawConcerns)
      ? rawConcerns.filter(
          (concern): concern is string => typeof concern === "string",
        )
      : typeof rawConcerns === "string"
        ? [rawConcerns]
        : [];
    return [
      {
        patternId,
        setupNarrative:
          firstString(value, [
            "setupNarrative",
            "setup_narrative",
            "setup",
            "summary",
          ]) ?? "No setup narrative was returned.",
        whyItMayMatter:
          firstString(value, [
            "whyItMayMatter",
            "why_it_may_matter",
            "rationale",
          ]) ?? "No rationale was returned.",
        statisticalConcerns,
        nextBacktest:
          firstString(value, [
            "nextBacktest",
            "next_backtest",
            "nextTest",
            "recommendation",
          ]) ?? "Re-test this candidate out of sample.",
      },
    ];
  });
  const rejectedOrWeak = rejected.flatMap((value) => {
    if (!isRecord(value)) return [];
    const patternId = firstString(value, ["patternId", "pattern_id", "id"]);
    const reason = firstString(value, ["reason", "rationale", "concern"]);
    return patternId && reason ? [{ patternId, reason }] : [];
  });

  return { overview, strongestCandidates, rejectedOrWeak };
}

export function previewInterpretationCost(patterns: Pattern[]): number {
  const inputTokens =
    Math.ceil(JSON.stringify(patterns.slice(0, 20)).length / 4) + 1500;
  const outputTokens = Math.max(1500, Math.min(8000, patterns.length * 250));
  return (
    (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION +
    (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION
  );
}

export async function interpretPatternsWithGemini(
  apiKey: string,
  patterns: Pattern[],
  validationResults: ValidationResult[],
): Promise<PatternInterpretation> {
  if (!apiKey.trim())
    throw new Error("Enter a Gemini API key for this request.");
  const validationById = new Map(
    validationResults.map((result) => [result.patternId, result]),
  );
  const candidates = patterns.slice(0, 20).map((pattern) => {
    const validation = validationById.get(pattern.id);
    return {
      id: pattern.id,
      conditions: pattern.label,
      direction: pattern.direction,
      target: pattern.targetDatasetLabel,
      timeframe: pattern.targetTimeframe,
      sampleSize: pattern.sampleSize,
      inSampleWinRate: pattern.winRate,
      baselineWinRate: pattern.baselineWinRate,
      liftVsBaseline: pattern.liftVsBaseline,
      falseDiscoveryRate: pattern.falseDiscoveryRate,
      averageMove: pattern.avgMove,
      mfeMaeRatio: pattern.mfeMaeRatio,
      outcomeProfile: pattern.outcomeProfile,
      validation: validation
        ? {
            degraded: validation.degraded,
            note: validation.degradationNote,
            outOfSample: validation.outOfSampleMetrics,
            walkForward: validation.walkForward,
            crossSymbolSurvival: validation.crossSymbolSurvival,
            crossTimeframeSurvival: validation.crossTimeframeSurvival,
          }
        : null,
    };
  });
  const prompt = [
    "Act as a skeptical quantitative trading research reviewer.",
    "Translate deterministic event conditions into concise trading-language hypotheses.",
    "Do not claim profitability, certainty, causation, or financial advice.",
    "A high in-sample win rate is not sufficient. Give priority to genuine out-of-sample sample size, direction consistency, walk-forward folds, confidence intervals, false-discovery estimates, and independent symbol/timeframe survival.",
    "Reject candidates driven by calendar fragments, tiny samples, unavailable holdouts, contradictory direction, or implausible target/stop paths.",
    "For useful candidates, state exactly what should be backtested next, including entry event, invalidation, and outcome measurement.",
    `Candidate summaries (no raw market rows): ${JSON.stringify(candidates)}`,
    "Return JSON with overview, strongestCandidates, and rejectedOrWeak. strongestCandidates entries require patternId, setupNarrative, whyItMayMatter, statisticalConcerns array, and nextBacktest. rejectedOrWeak entries require patternId and reason.",
  ].join("\n\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim(),
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 8000,
          responseMimeType: "application/json",
          responseSchema: responseSchema(),
        },
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gemini interpretation failed (${response.status}): ${body.slice(0, 400)}`,
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
  if (!text) throw new Error("Gemini returned no interpretation.");
  const parsed = normalizeInterpretation(text);
  const promptTokens =
    payload.usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4);
  const outputTokens =
    payload.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
  return {
    ...parsed,
    usage: {
      promptTokens,
      outputTokens,
      estimatedCostUsd:
        (promptTokens / 1_000_000) * INPUT_PRICE_PER_MILLION +
        (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION,
    },
  };
}
