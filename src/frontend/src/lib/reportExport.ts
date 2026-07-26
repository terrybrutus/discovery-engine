import type { CandidateSystemOptimization } from "@/lib/candidateSystemOptimizer";
import type { Dataset, Pattern, Report, ValidationResult } from "@/types";

function safeName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "discovery-report"
  );
}

function downloadText(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildReportMarkdown(
  report: Report,
  patterns: Pattern[],
  validationResults: ValidationResult[],
  datasets: Dataset[],
  systemOptimizations: Record<string, CandidateSystemOptimization> = {},
): string {
  const validationById = new Map(
    validationResults.map((result) => [result.patternId, result]),
  );
  const lines = [
    `# ${report.datasetName || "Trading Discovery Report"}`,
    "",
    `Generated: ${new Date(report.generatedAt).toISOString()}`,
    `Datasets: ${datasets.map((dataset) => dataset.label ?? dataset.name).join(", ")}`,
    "",
    report.summary,
    "",
  ];
  for (const section of report.sections) {
    lines.push(`## ${section.title}`, "", ...section.paragraphs, "");
  }
  lines.push("## Discovered patterns", "");
  patterns.forEach((pattern, index) => {
    const validation = validationById.get(pattern.id);
    lines.push(
      `### ${index + 1}. ${pattern.label}`,
      "",
      pattern.plainEnglishSentence ?? pattern.label,
      "",
      `- Outcome target: ${pattern.targetDatasetLabel ?? "Current target"} (${pattern.targetTimeframe ?? "unknown timeframe"})`,
      `- Direction: ${pattern.direction}`,
      `- Recommended hold: ${pattern.horizon} target observations`,
      `- Sample: ${pattern.sampleSize}`,
      `- Win rate: ${pattern.winRate.toFixed(1)}%`,
      `- Average move: ${pattern.avgMove.toFixed(3)}%`,
      `- MFE/MAE: ${(pattern.mfeMaeRatio ?? 0).toFixed(2)}`,
      `- OOS status: ${pattern.validationStatus ?? (validation?.degraded ? "degraded" : validation ? "held" : "not tested")}`,
      "",
    );
    const optimization = systemOptimizations[pattern.id];
    const recommended = optimization?.candidates.find(
      (candidate) => candidate.id === optimization.recommendedCandidateId,
    );
    if (recommended) {
      lines.push(
        "#### Executable candidate system",
        "",
        recommended.recipe.oneSentenceRule,
        "",
        ...recommended.recipe.steps.map(
          (step, stepIndex) => `${stepIndex + 1}. ${step}`,
        ),
        "",
        `- Walk-forward: ${recommended.walkForward.profitableFolds}/${recommended.walkForward.folds} profitable folds`,
        `- Sealed holdout trades: ${recommended.sealedHoldout.trades.length}`,
        `- Sealed holdout expectancy: ${recommended.sealedHoldout.expectancyR.toFixed(2)}R`,
        `- Sealed holdout profit factor: ${recommended.sealedHoldout.profitFactor?.toFixed(2) ?? "—"}`,
        "",
      );
    }
  });
  return lines.join("\n");
}

export function downloadReportMarkdown(
  report: Report,
  patterns: Pattern[],
  validationResults: ValidationResult[],
  datasets: Dataset[],
  systemOptimizations: Record<string, CandidateSystemOptimization> = {},
): void {
  downloadText(
    buildReportMarkdown(
      report,
      patterns,
      validationResults,
      datasets,
      systemOptimizations,
    ),
    `${safeName(report.datasetName)}.md`,
    "text/markdown;charset=utf-8",
  );
}

export function downloadResearchBundle(
  report: Report,
  patterns: Pattern[],
  validationResults: ValidationResult[],
  datasets: Dataset[],
  systemOptimizations: Record<string, CandidateSystemOptimization> = {},
): void {
  const bundle = {
    schema: "trading-discovery-research-bundle",
    version: 1,
    exportedAt: new Date().toISOString(),
    report,
    patterns,
    validationResults,
    systemOptimizations,
    datasets: datasets.map(({ bars: _bars, ...metadata }) => metadata),
  };
  downloadText(
    JSON.stringify(bundle, null, 2),
    `${safeName(report.datasetName)}.json`,
    "application/json;charset=utf-8",
  );
}
