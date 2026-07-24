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
  const parsed = JSON.parse(text) as Omit<PatternInterpretation, "usage">;
  if (
    typeof parsed.overview !== "string" ||
    !Array.isArray(parsed.strongestCandidates) ||
    !Array.isArray(parsed.rejectedOrWeak)
  ) {
    throw new Error("Gemini returned an invalid interpretation structure.");
  }
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
