import { EmptyState } from "@/components/EmptyState";
import { ResearchInterpreter } from "@/components/ResearchInterpreter";
import { Button } from "@/components/ui/button";
import {
  formatPatternHorizon,
  formatPatternTarget,
} from "@/lib/patternPresentation";
import {
  patternSymbolEntries,
  summarizeSymbolAttribution,
} from "@/lib/symbolAttribution";
import { cn } from "@/lib/utils";
import { validationHeldUp } from "@/lib/validationPolicy";
import { useEngineStore } from "@/store/engineStore";
import type { Pattern, TabId, ValidationResult } from "@/types";
import {
  ArrowRight,
  FileBarChart,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Report tab — renders the current discovery run as a structured, readable
// document. A shareable summary block leads with run name, timestamp,
// dataset, and headline metrics. The body is organized into clearly labeled
// sections (dataset, features, discovery, methodology, …) rendered as prose,
// plus two ranked pattern tables (by win rate and by direction-adjusted
// MFE/MAE ratio) and an aggregate validation summary block. All numerics use
// JetBrains Mono with tabular-nums per the Calibrated Ink Terminal system.
// ---------------------------------------------------------------------------

const RANK_LIMIT = 10;

export default function ReportPage() {
  const dataset = useEngineStore((s) => s.dataset);
  const datasets = useEngineStore((s) => s.datasets);
  const features = useEngineStore((s) => s.features);
  const patterns = useEngineStore((s) => s.patterns);
  const validationResults = useEngineStore((s) => s.validationResults);
  const report = useEngineStore((s) => s.report);
  const generateReportAction = useEngineStore((s) => s.generateReportAction);
  const setActiveTab = useEngineStore((s) => s.setActiveTab);

  const hasRun = patterns.length > 0;
  const hasReport = report != null;

  // ---- Empty state: no discovery run active ----
  // Per requirements, render a clear empty state when no report is available
  // or no patterns exist. Guide the user to run a discovery first.
  if (!hasRun) {
    const goToDiscovery = () => setActiveTab("discovery" as TabId);
    return (
      <div data-ocid="page.report" className="flex flex-col gap-4 p-4 md:p-6">
        <PageHeader />
        <EmptyState
          icon={FileBarChart}
          title="No report available"
          description="No report is available yet. Run a discovery on the Discovery tab first — once patterns are found and validated, come back here to generate a structured research brief of your strongest discoveries."
          hint="You can also adjust discovery settings and re-run to find stronger patterns before generating the report."
          actionLabel="Go to Discovery"
          onAction={goToDiscovery}
        />
      </div>
    );
  }

  if (!hasReport) {
    return (
      <div data-ocid="page.report" className="flex flex-col gap-4 p-4 md:p-6">
        <PageHeader />
        <EmptyState
          icon={FileBarChart}
          title="Build the research brief"
          description="Discovery and automatic validation are complete. Generate a structured report covering every selected dataset, the strongest validated patterns, baseline lift, and cross-timeframe findings."
          actionLabel="Generate Report"
          onAction={generateReportAction}
        />
      </div>
    );
  }

  // report is non-null and patterns exist past this point.
  const activeReport = report!;
  const validationById = new Map(
    validationResults.map((v) => [v.patternId, v]),
  );

  // ---- Headline metrics for the shareable summary block ----
  const patternCount = patterns.length;
  const featureCount = features.filter((f) => f.enabled).length;
  const topWinRate =
    patterns.length > 0 ? Math.max(...patterns.map((p) => p.winRate)) : null;

  // Top direction-adjusted MFE/MAE ratio across all patterns (preferring the
  // validation result's recomputed value, falling back to the pattern's raw
  // ratio). Null ratios are excluded.
  const ratioValues = patterns
    .map((p) => resolveRatio(p, validationById.get(p.id)))
    .filter((n): n is number => n != null);
  const topRatio = ratioValues.length > 0 ? Math.max(...ratioValues) : null;

  // ---- Ranked pattern lists ----
  const topByWinRate = patterns.slice(0, RANK_LIMIT);
  const topByRatio = [...patterns]
    .map((p) => ({
      pattern: p,
      ratio: resolveRatio(p, validationById.get(p.id)),
    }))
    .sort(
      (a, b) =>
        (b.ratio ?? Number.NEGATIVE_INFINITY) -
        (a.ratio ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, RANK_LIMIT);

  // ---- Aggregate validation summary ----
  const totalValidated = validationResults.length;
  const passedCount = validationResults.filter((result) =>
    validationHeldUp(result),
  ).length;
  const passRate =
    totalValidated > 0 ? (passedCount / totalValidated) * 100 : null;
  const validatedRatios = validationResults
    .map((v) => v.directionAdjustedMfeMaeRatio)
    .filter((n): n is number => n != null);
  const avgRatio =
    validatedRatios.length > 0
      ? validatedRatios.reduce((acc, v) => acc + v, 0) / validatedRatios.length
      : null;
  const survivalValues = validationResults
    .map((v) => v.crossSymbolSurvival)
    .filter((n): n is number => n != null);
  const avgSurvival =
    survivalValues.length > 0
      ? survivalValues.reduce((acc, v) => acc + v, 0) / survivalValues.length
      : null;
  const timeframeSurvivalValues = validationResults
    .map((result) => result.crossTimeframeSurvival ?? null)
    .filter((value): value is number => value != null);
  const avgTimeframeSurvival =
    timeframeSurvivalValues.length > 0
      ? timeframeSurvivalValues.reduce((sum, value) => sum + value, 0) /
        timeframeSurvivalValues.length
      : null;
  const symbolAttribution = summarizeSymbolAttribution(
    patterns,
    validationResults,
  );

  // ---- Dataset name(s) for the summary block ----
  // Prefer the list of all loaded datasets; fall back to the active dataset.
  const datasetNames =
    datasets.length > 0
      ? datasets.map((d) => d.label ?? d.name)
      : dataset
        ? [dataset.label ?? dataset.name]
        : [];

  // Sections to render as prose. Skip the two ranking sections — they are
  // rendered as dedicated tables below to avoid duplicating the same patterns
  // as both narrative and table.
  const proseSections = activeReport.sections.filter(
    (s) =>
      s.id !== "top-discoveries" &&
      s.id !== "top-by-ratio" &&
      s.id !== "symbol-attribution",
  );

  const handleRegenerate = () => generateReportAction();

  return (
    <div data-ocid="page.report" className="flex flex-col gap-5 p-4 md:p-6">
      <PageHeader />

      {/* Regenerate control */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Report generated from this session&apos;s discovery and validation
          results. Adjust settings and regenerate to update.
        </p>
        <Button
          data-ocid="report.regenerate_button"
          onClick={handleRegenerate}
          disabled={!dataset || features.length === 0}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Regenerate Report
        </Button>
      </div>

      {/* ---- Shareable summary block ---- */}
      <section
        data-ocid="report.summary_block"
        aria-labelledby="report-summary-title"
        className="stat-card flex flex-col gap-4"
        data-accent="true"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <FileBarChart
                className="size-4 text-primary"
                aria-hidden="true"
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Research Brief
              </span>
            </div>
            <h2
              id="report-summary-title"
              className="font-display text-xl font-semibold text-foreground"
            >
              {activeReport.datasetName ?? "Untitled Run"}
            </h2>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">
                {formatTimestamp(activeReport.generatedAt)}
              </span>
              {" · "}
              <span>{datasetNames.join(", ") || "No dataset"}</span>
            </p>
          </div>
        </div>

        {/* Headline metrics */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <HeadlineMetric
            label="Patterns"
            value={patternCount.toLocaleString()}
          />
          <HeadlineMetric
            label="Features"
            value={featureCount.toLocaleString()}
          />
          <HeadlineMetric
            label="Top Win Rate"
            value={topWinRate != null ? `${topWinRate.toFixed(1)}%` : "—"}
          />
          <HeadlineMetric
            label="Top MFE/MAE Ratio"
            value={topRatio != null ? topRatio.toFixed(2) : "—"}
          />
        </div>
      </section>

      <ResearchInterpreter
        patterns={patterns}
        validationResults={validationResults}
      />

      {/* ---- Top patterns by win rate ---- */}
      <section
        data-ocid="report.top_by_win_rate"
        aria-labelledby="top-win-rate-title"
        className="flex flex-col gap-3"
      >
        <SectionHeader index="01" title="Top Patterns by Win Rate" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          The strongest patterns ranked by win rate — the share of occurrences
          that moved in the pattern&apos;s dominant direction.
        </p>
        <PatternTable
          patterns={topByWinRate}
          validationById={validationById}
          emptyMessage="No patterns met the discovery thresholds. Try lowering the minimum win rate or sample size, or enabling more feature categories."
        />
      </section>

      {/* ---- Top patterns by direction-adjusted MFE/MAE ratio ---- */}
      <section
        data-ocid="report.top_by_ratio"
        aria-labelledby="top-ratio-title"
        className="flex flex-col gap-3"
      >
        <SectionHeader
          index="02"
          title="Top Patterns by Direction-Adjusted MFE/MAE Ratio"
        />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Ranked by direction-adjusted MFE/MAE ratio — favorable excursion
          divided by adverse excursion, signed so bearish patterns are scored on
          the same scale as bullish ones. Higher is better.
        </p>
        <PatternTable
          patterns={topByRatio.map((r) => r.pattern)}
          validationById={validationById}
          emptyMessage="No patterns had a computable direction-adjusted MFE/MAE ratio. This usually means the adverse excursion (MAE) was zero across the measured window."
        />
      </section>

      {/* ---- Aggregate validation summary ---- */}
      <section
        data-ocid="report.validation_summary"
        aria-labelledby="validation-summary-title"
        className="flex flex-col gap-3"
      >
        <SectionHeader index="03" title="Aggregate Validation Summary" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Out-of-sample re-test of the top patterns on a 30% chronological
          holdout (the most recent 30% of the dataset). Patterns whose
          out-of-sample win rate drops more than 10 percentage points, or whose
          out-of-sample sample is too small, are flagged as degraded.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryStat
            label="Patterns Validated"
            value={totalValidated.toLocaleString()}
          />
          <SummaryStat
            label="Pass Rate"
            value={passRate != null ? `${passRate.toFixed(1)}%` : "—"}
            hint={
              totalValidated > 0
                ? `${passedCount} of ${totalValidated} passed`
                : undefined
            }
          />
          <SummaryStat
            label="Avg Direction-Adj. MFE/MAE"
            value={avgRatio != null ? avgRatio.toFixed(2) : "—"}
            hint={
              validatedRatios.length > 0
                ? `across ${validatedRatios.length} pattern${
                    validatedRatios.length === 1 ? "" : "s"
                  }`
                : undefined
            }
          />
          <SummaryStat
            label="Avg Cross-Symbol Survival"
            value={
              avgSurvival != null ? `${(avgSurvival * 100).toFixed(1)}%` : "—"
            }
            hint={
              survivalValues.length > 0
                ? `across ${survivalValues.length} pattern${
                    survivalValues.length === 1 ? "" : "s"
                  }`
                : undefined
            }
          />
          <SummaryStat
            label="Avg Cross-Timeframe Survival"
            value={
              avgTimeframeSurvival != null
                ? `${(avgTimeframeSurvival * 100).toFixed(1)}%`
                : "—"
            }
            hint={
              timeframeSurvivalValues.length > 0
                ? `across ${timeframeSurvivalValues.length} pattern${
                    timeframeSurvivalValues.length === 1 ? "" : "s"
                  }`
                : undefined
            }
          />
        </div>
      </section>

      {/* ---- Per-symbol occurrence attribution ---- */}
      <section
        data-ocid="report.symbol_attribution"
        aria-labelledby="symbol-attribution-title"
        className="flex flex-col gap-3"
      >
        <SectionHeader
          index="04"
          title="Symbol Attribution"
          id="symbol-attribution-title"
        />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Shows which outcome symbol supplied the matches behind the reported
          patterns. Shares use all reported pattern occurrences as the
          denominator; when multiple patterns match the same bar, each pattern
          occurrence remains counted.
        </p>
        <SymbolAttributionTable rows={symbolAttribution} />
      </section>

      {/* ---- Narrative sections ---- */}
      {proseSections.map((section, idx) => (
        <section
          key={section.id}
          data-ocid={`report.section.${section.id}`}
          aria-labelledby={`section-${section.id}-title`}
          className="rounded-lg border border-border bg-card p-5"
        >
          <SectionHeader
            index={String(idx + 5).padStart(2, "0")}
            title={section.title}
            id={`section-${section.id}-title`}
          />
          <div className="flex flex-col gap-2.5">
            {section.paragraphs.map((para, i) => (
              <p
                key={`${section.id}-${i}`}
                className="text-sm leading-relaxed text-muted-foreground"
              >
                {para}
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageHeader() {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <FileBarChart className="size-4 text-primary" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          04 · Report
        </span>
      </div>
      <h1 className="font-display text-lg font-semibold text-foreground">
        Discovery Report
      </h1>
      <p className="text-sm text-muted-foreground">
        A structured summary of your strongest pattern discoveries, ranked by
        statistical strength and direction-adjusted reward-to-risk.
      </p>
    </div>
  );
}

function SectionHeader({
  index,
  title,
  id,
}: {
  index: string;
  title: string;
  id?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {index}
      </span>
      <h2
        id={id}
        className="font-display text-base font-semibold text-foreground"
      >
        {title}
      </h2>
    </div>
  );
}

function HeadlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div
      data-ocid={`report.headline.${label.toLowerCase().replace(/[^a-z]+/g, "_")}`}
      className="rounded-md border border-border bg-background/40 px-3 py-2.5"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="stat-card flex flex-col gap-1">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {hint ? (
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground/80">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function PatternTable({
  patterns,
  validationById,
  emptyMessage,
}: {
  patterns: Pattern[];
  validationById: Map<string, ValidationResult>;
  emptyMessage: string;
}) {
  if (patterns.length === 0) {
    return (
      <div
        data-ocid="report.pattern_table.empty"
        className="rounded-lg border border-dashed border-border bg-card/40 px-5 py-10 text-center"
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <div
      data-ocid="report.pattern_table"
      className="overflow-x-auto rounded-lg border border-border bg-card"
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            <Th className="w-8 text-right">#</Th>
            <Th>Pattern</Th>
            <Th className="min-w-44">Outcome target</Th>
            <Th className="w-24">Direction</Th>
            <Th className="w-24 text-right">Win Rate</Th>
            <Th className="w-28 text-right">MFE/MAE Ratio</Th>
            <Th className="w-24 text-right">Avg Move</Th>
            <Th className="w-20 text-right">Sample</Th>
            <Th className="min-w-44">Symbol Occurrences</Th>
            <Th className="w-24">Confidence</Th>
            <Th className="w-20">Status</Th>
          </tr>
        </thead>
        <tbody>
          {patterns.map((p, i) => {
            const v = validationById.get(p.id);
            const ratio = resolveRatio(p, v);
            const degraded = v ? !validationHeldUp(v) : false;
            return (
              <tr
                key={p.id}
                data-ocid={`report.pattern_table.row.${i}`}
                className="border-b border-border/60 last:border-0 hover:bg-muted/30"
              >
                <Td className="text-right font-mono tabular-nums text-muted-foreground">
                  {i + 1}
                </Td>
                <Td>
                  <span className="text-foreground">
                    {p.label.replace(/^When\s+/i, "")}
                  </span>
                </Td>
                <Td>
                  <div className="flex flex-col font-mono text-[11px]">
                    <span className="text-foreground">
                      {formatPatternTarget(p)}
                    </span>
                    <span className="text-muted-foreground">
                      {formatPatternHorizon(p)}
                    </span>
                  </div>
                </Td>
                <Td>
                  <DirectionBadge direction={p.direction} />
                </Td>
                <Td className="text-right font-mono tabular-nums text-foreground">
                  {p.winRate.toFixed(1)}%
                </Td>
                <Td className="text-right font-mono tabular-nums text-foreground">
                  {ratio != null ? ratio.toFixed(2) : "—"}
                </Td>
                <Td className="text-right font-mono tabular-nums text-foreground">
                  {p.avgMove.toFixed(2)}
                </Td>
                <Td className="text-right font-mono tabular-nums text-muted-foreground">
                  {p.sampleSize.toLocaleString()}
                </Td>
                <Td>
                  <PatternSymbolDistribution pattern={p} />
                </Td>
                <Td className="font-mono text-xs capitalize text-muted-foreground">
                  {p.confidence}
                </Td>
                <Td>
                  {v ? (
                    <span className={degraded ? "degraded" : "surviving"}>
                      {degraded ? "Failed" : "Passed"}
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-muted-foreground/60">
                      unvalidated
                    </span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PatternSymbolDistribution({ pattern }: { pattern: Pattern }) {
  const entries = patternSymbolEntries(pattern);
  return (
    <div className="flex min-w-40 flex-col gap-0.5">
      {entries.map((entry) => (
        <div
          key={entry.symbol}
          className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
        >
          <span
            className="max-w-28 truncate text-foreground"
            title={entry.symbol}
          >
            {entry.symbol}
          </span>
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {entry.occurrences.toLocaleString()} ·{" "}
            {entry.shareOfPattern.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function SymbolAttributionTable({
  rows,
}: {
  rows: ReturnType<typeof summarizeSymbolAttribution>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 px-5 py-8 text-center text-sm text-muted-foreground">
        No per-symbol occurrence attribution was available.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            <Th>Symbol</Th>
            <Th className="text-right">Patterns</Th>
            <Th className="text-right">Occurrences</Th>
            <Th className="text-right">Share</Th>
            <Th className="text-right">Weighted Win Rate</Th>
            <Th className="text-right">Avg Move</Th>
            <Th className="text-right">Passed / Degraded</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.symbol}
              className="border-b border-border/60 last:border-0"
            >
              <Td>
                <span className="font-mono text-xs text-foreground">
                  {row.symbol}
                </span>
              </Td>
              <Td className="text-right font-mono tabular-nums">
                {row.patternCount.toLocaleString()}
              </Td>
              <Td className="text-right font-mono tabular-nums">
                {row.occurrences.toLocaleString()}
              </Td>
              <Td className="text-right font-mono tabular-nums">
                {row.shareOfReportedOccurrences.toFixed(1)}%
              </Td>
              <Td className="text-right font-mono tabular-nums">
                {row.occurrenceWeightedWinRate.toFixed(1)}%
              </Td>
              <Td className="text-right font-mono tabular-nums">
                {row.occurrenceWeightedAvgMove.toFixed(2)}%
              </Td>
              <Td className="text-right font-mono tabular-nums">
                <span className="text-success">{row.passedPatterns}</span>
                {" / "}
                <span className="text-destructive">{row.degradedPatterns}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("px-3 py-2.5 align-middle", className)}>{children}</td>
  );
}

function DirectionBadge({ direction }: { direction: Pattern["direction"] }) {
  if (direction === "bullish") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs text-primary">
        <TrendingUp className="size-3.5" aria-hidden="true" />
        Bullish
      </span>
    );
  }
  if (direction === "bearish") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs text-destructive">
        <TrendingDown className="size-3.5" aria-hidden="true" />
        Bearish
      </span>
    );
  }
  return (
    <span className="font-mono text-xs text-muted-foreground">Neutral</span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the direction-adjusted MFE/MAE ratio for a pattern, preferring the
 * validation result's recomputed value and falling back to the pattern's raw
 * `mfeMaeRatio`. Returns `null` when neither source yields a usable number.
 */
function resolveRatio(
  pattern: Pattern,
  validation?: ValidationResult,
): number | null {
  if (validation && validation.directionAdjustedMfeMaeRatio != null) {
    return validation.directionAdjustedMfeMaeRatio;
  }
  return pattern.mfeMaeRatio ?? null;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
