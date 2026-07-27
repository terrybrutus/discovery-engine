import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { adjustForCosts } from "@/lib/costAnalysis";
import { buildMultiTimeframeResearchSpace } from "@/lib/multiTimeframe";
import { formatDefinitionParameters } from "@/lib/reproductionRecipe";
import { cn } from "@/lib/utils";
import { useEngineStore } from "@/store/engineStore";
import type {
  Condition,
  Feature,
  FeatureMatrix,
  OHLCVBar,
  Pattern,
} from "@/types";
import { ArrowDown, ArrowUp, ArrowUpDown, Info, X } from "lucide-react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { CandidateSystemSimulator } from "./CandidateSystemSimulator";
import { PatternCoveragePanel } from "./PatternCoveragePanel";

interface PatternDetailModalProps {
  pattern: Pattern | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Tooltip explaining the window-based proxy MFE/MAE measurement. */
const PROXY_TOOLTIP =
  "Window-based proxy: max favorable/adverse excursion measured over the forward hold window, not from a simulated strategy.";

// ---- Histogram binning ----
const NUM_BINS = 21; // odd so the centre bin straddles zero

interface HistogramBin {
  range: string;
  count: number;
  mid: number;
  positive: boolean;
}

/** Null-safe numeric formatter. Returns "—" for null/undefined/NaN so a
 *  missing or incomplete pattern field renders a placeholder instead of
 *  throwing. Per the Calibrated Ink Terminal design system, all numerics
 *  use JetBrains Mono with tabular-nums (applied via the surrounding cell's
 *  `font-mono tabular-nums` classes). */
function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

/** Null-safe integer formatter with thousands separators. */
function fmtInt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString();
}

function fmtDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "—";
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24)
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)}d`;
}

/**
 * Re-evaluates a pattern against the loaded dataset + feature matrix to
 * recover the per-bar forward returns, then bins them into a histogram.
 * Mirrors the matching logic in lib/discovery.ts (kept compact and local
 * so the modal stays self-contained).
 *
 * Guards against undefined/empty input arrays: if `bars`, `features`,
 * `matrix`, or `pattern.conditions` are missing or empty, returns an empty
 * array so the caller renders an empty-histogram placeholder instead of
 * crashing.
 */
function computeHistogram(
  bars: OHLCVBar[] | null | undefined,
  features: Feature[] | null | undefined,
  matrix: FeatureMatrix | null | undefined,
  pattern: Pattern | null | undefined,
): HistogramBin[] {
  if (
    !pattern ||
    !Array.isArray(bars) ||
    bars.length === 0 ||
    !Array.isArray(features) ||
    !matrix ||
    !Array.isArray(pattern.conditions) ||
    pattern.conditions.length === 0
  ) {
    return [];
  }

  const byId = new Map(features.map((f) => [f.id, f]));
  const lookups = new Map<string, (number | string | undefined)[]>();
  for (const c of pattern.conditions) {
    const arr = matrix[c.featureId];
    if (arr) lookups.set(c.featureId, arr);
  }

  const matches = (v: number | string | undefined, c: Condition): boolean => {
    if (v == null) return false;
    const feat = byId.get(c.featureId);
    if (feat?.type === "categorical") {
      const label = String(v);
      return c.operator === "eq"
        ? label === c.bucketLabel
        : c.operator === "neq"
          ? label !== c.bucketLabel
          : false;
    }
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isNaN(n)) return false;
    switch (c.operator) {
      case "gt":
        return n > (c.value ?? 0);
      case "gte":
        return n >= (c.value ?? 0);
      case "lt":
        return n < (c.value ?? 0);
      case "lte":
        return n <= (c.value ?? 0);
      case "between":
        return n >= (c.value ?? 0) && n <= (c.highValue ?? 0);
      default:
        return false;
    }
  };

  const horizon = pattern.horizon;
  const returns: number[] = [];
  for (let i = 0; i < bars.length - horizon; i++) {
    let ok = true;
    for (const c of pattern.conditions) {
      const arr = lookups.get(c.featureId);
      if (!arr || !matches(arr[i], c)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const entry = bars[i].close;
    const exit = bars[i + horizon].close;
    if (entry !== 0) returns.push(((exit - entry) / entry) * 100);
  }

  if (returns.length === 0) return [];

  // Reduce-based min/max to avoid Math.min(...returns) / Math.max(...returns)
  // spread, which throws RangeError on very large arrays (call-stack arg
  // limit). A single pass computes both.
  let min = returns[0];
  let max = returns[0];
  for (let i = 1; i < returns.length; i++) {
    const r = returns[i];
    if (r < min) min = r;
    if (r > max) max = r;
  }
  const span = max - min || 1;
  const binWidth = span / NUM_BINS;
  const bins: HistogramBin[] = [];
  for (let b = 0; b < NUM_BINS; b++) {
    const lo = min + b * binWidth;
    const hi = lo + binWidth;
    const mid = lo + binWidth / 2;
    bins.push({
      range: `${lo.toFixed(2)} to ${hi.toFixed(2)}`,
      count: 0,
      mid,
      positive: pattern.direction === "bearish" ? mid < 0 : mid >= 0,
    });
  }
  for (const r of returns) {
    let idx = Math.floor((r - min) / binWidth);
    if (idx >= NUM_BINS) idx = NUM_BINS - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  }
  return bins;
}

function MetricRow({
  label,
  value,
  valueClass,
  hint,
  tooltip,
}: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
  tooltip?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <div className="flex flex-col">
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {label}
          {tooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`What does ${label} mean?`}
                  className="text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                >
                  <Info className="size-3" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[16rem] text-left">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        {hint ? (
          <span className="text-[11px] text-muted-foreground/70">{hint}</span>
        ) : null}
      </div>
      <span
        className={cn(
          "font-mono text-base tabular-nums font-semibold text-foreground",
          valueClass,
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Detail modal for a discovered pattern. Shows the full conditions in
 * plain English, a complete metric breakdown, and a histogram of the
 * forward-return distribution for matching bars.
 */
export function PatternDetailModal({
  pattern,
  open,
  onOpenChange,
}: PatternDetailModalProps) {
  const datasets = useEngineStore((s) => s.datasets);
  const selectedDatasetIds = useEngineStore((s) => s.selectedDatasetIds);
  const featuresByDataset = useEngineStore((s) => s.featuresByDataset);
  const featureValuesByDataset = useEngineStore(
    (s) => s.featureValuesByDataset,
  );
  const discoveryConfig = useEngineStore((s) => s.discoveryConfig);

  const histogram = useMemo(() => {
    if (!pattern) return [];
    const target =
      datasets.find((item) => item.id === pattern.targetDatasetId) ??
      datasets[0];
    if (!target) return [];
    const selected = datasets.filter((item) =>
      selectedDatasetIds.includes(item.id),
    );
    const space = buildMultiTimeframeResearchSpace(
      target,
      selected.length > 0 ? selected : [target],
      featuresByDataset,
      featureValuesByDataset,
      target.id,
    );
    return computeHistogram(target.bars, space.features, space.matrix, pattern);
  }, [
    datasets,
    featureValuesByDataset,
    featuresByDataset,
    pattern,
    selectedDatasetIds,
  ]);

  if (!pattern) return null;

  const directionIcon =
    pattern.direction === "bullish" ? (
      <ArrowUp className="size-4" aria-hidden="true" />
    ) : pattern.direction === "bearish" ? (
      <ArrowDown className="size-4" aria-hidden="true" />
    ) : (
      <ArrowUpDown className="size-4" aria-hidden="true" />
    );

  const directionClass =
    pattern.direction === "bullish"
      ? "text-primary"
      : pattern.direction === "bearish"
        ? "text-destructive"
        : "text-muted-foreground";

  // Reduce-based max to avoid Math.max(1, ...histogram.map(...)) spread,
  // which throws RangeError on very large arrays.
  let maxCount = 1;
  for (let i = 0; i < histogram.length; i++) {
    if (histogram[i].count > maxCount) maxCount = histogram[i].count;
  }

  // Null-safe win-rate color class for the metric row.
  const winRateValueClass =
    pattern.winRate == null || Number.isNaN(pattern.winRate)
      ? "text-muted-foreground"
      : pattern.winRate >= 65
        ? "text-primary"
        : pattern.winRate >= 55
          ? "text-warning"
          : "text-destructive";

  // Null-safe avg-move color class.
  const avgMoveValueClass =
    pattern.avgMove == null || Number.isNaN(pattern.avgMove)
      ? "text-muted-foreground"
      : pattern.avgMove > 0
        ? "text-primary"
        : pattern.avgMove < 0
          ? "text-destructive"
          : undefined;
  const executionRows = pattern.executionComparison
    ? [
        {
          label: "Every matching bar",
          summary: adjustForCosts(
            pattern.executionComparison.everyMatch,
            discoveryConfig.roundTripCostBps ?? 0,
          ),
        },
        {
          label: "Non-overlapping trades",
          summary: adjustForCosts(
            pattern.executionComparison.nonOverlapping,
            discoveryConfig.roundTripCostBps ?? 0,
          ),
        },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-ocid="pattern_detail_modal"
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="font-display text-lg pr-8 leading-snug">
            {pattern.plainEnglishSentence ?? pattern.label}
          </DialogTitle>
          <DialogDescription>
            Full breakdown of this discovered pattern and the distribution of
            its forward returns.
          </DialogDescription>
        </DialogHeader>

        {/* ---- Conditions in plain English ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Conditions
          </h3>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-sm leading-relaxed text-foreground">
              {pattern.plainEnglishSentence ?? pattern.label}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Direction:</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium capitalize",
                directionClass,
              )}
            >
              {directionIcon}
              {pattern.direction}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Hold:</span>
            <span className="font-mono tabular-nums text-foreground">
              {pattern.horizon} bars
            </span>
          </div>
        </div>

        <Separator />

        {pattern.reproductionRecipe ? (
          <>
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Reproduction recipe
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Exact calculation lineage and timing used by this discovery.
                  This is generated from stored feature metadata, not invented
                  by AI.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <RecipeFact
                  label="Market / timeframe"
                  value={`${pattern.targetDatasetLabel ?? "Current target"} · ${pattern.targetTimeframe ?? "unknown timeframe"}`}
                />
                <RecipeFact
                  label="Signal timing"
                  value="After the target observation closes"
                />
                <RecipeFact
                  label="Research entry"
                  value="Signal observation close"
                />
                <RecipeFact
                  label="Research exit"
                  value={`${pattern.horizon} target observations later, at close`}
                />
                <RecipeFact
                  label="Confluence"
                  value={`${pattern.confluenceDatasetIds?.length ?? 1} source dataset${(pattern.confluenceDatasetIds?.length ?? 1) === 1 ? "" : "s"} · ${pattern.confluenceTimeframes?.join(", ") || pattern.targetTimeframe || "unknown timeframe"}`}
                />
              </div>

              <div className="space-y-2">
                {pattern.reproductionRecipe.conditions.map(
                  (condition, index) => (
                    <div
                      key={`${condition.featureId}-${index}`}
                      className="rounded-md border border-border bg-muted/20 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-mono text-sm font-semibold text-foreground">
                            {index + 1}. {condition.expression}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {condition.definitionName ??
                              (condition.source === "custom"
                                ? "Uploaded field"
                                : "Built-in measurement")}
                            {condition.primitive
                              ? ` · ${condition.primitive}`
                              : ""}
                            {condition.originTimeframe
                              ? ` · source ${condition.originTimeframe}`
                              : ""}
                            {condition.definitionConfidence != null
                              ? ` · mapping ${(condition.definitionConfidence * 100).toFixed(0)}%`
                              : ""}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase",
                            condition.source === "builtin" ||
                              condition.definitionReviewed
                              ? "border-primary/30 text-primary"
                              : "border-warning/30 text-warning",
                          )}
                        >
                          {condition.source === "custom"
                            ? condition.definitionReviewed
                              ? "mapped"
                              : "unreviewed mapping"
                            : "built-in"}
                        </span>
                      </div>
                      <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                        <div>
                          <dt className="text-muted-foreground">Formula</dt>
                          <dd className="break-words font-mono text-foreground">
                            {condition.formula ?? "Not stored"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">
                            Indicator parameters
                          </dt>
                          <dd className="break-words font-mono text-foreground">
                            {formatDefinitionParameters(
                              condition.definitionParameters,
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ),
                )}
              </div>

              <div
                className={cn(
                  "rounded-md border p-3 text-xs leading-relaxed",
                  pattern.reproductionRecipe.portability === "portable"
                    ? "border-primary/30 bg-primary/5 text-foreground"
                    : "border-warning/30 bg-warning/5 text-foreground",
                )}
              >
                <div className="font-semibold">
                  {pattern.reproductionRecipe.portability === "portable"
                    ? "Portable recipe"
                    : pattern.reproductionRecipe.portability ===
                        "source-settings-required"
                      ? "Dataset-exact; source settings still required"
                      : "Incomplete lineage"}
                </div>
                <p className="mt-1">
                  {pattern.reproductionRecipe.portabilityNote}
                </p>
                <p className="mt-2">
                  {pattern.reproductionRecipe.strategyEntryWarning}
                </p>
              </div>
            </div>
            <Separator />
          </>
        ) : null}

        <CandidateSystemSimulator pattern={pattern} />

        <Separator />

        {/* ---- Metric breakdown ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Metrics
          </h3>
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            <div className="flex flex-col divide-y divide-border">
              <MetricRow
                label="Win rate"
                value={
                  pattern.winRate == null || Number.isNaN(pattern.winRate)
                    ? "—"
                    : `${pattern.winRate.toFixed(1)}%`
                }
                valueClass={winRateValueClass}
                hint="share of bars moving in the pattern's direction"
              />
              <MetricRow
                label="Lift vs baseline"
                value={
                  pattern.liftVsBaseline == null
                    ? "—"
                    : `+${pattern.liftVsBaseline.toFixed(1)}pp`
                }
                hint={
                  pattern.baselineWinRate == null
                    ? "improvement over the unconditional directional rate"
                    : `baseline ${pattern.baselineWinRate.toFixed(1)}% for the same hold window`
                }
              />
              <MetricRow
                label="Average move"
                value={
                  pattern.avgMove == null || Number.isNaN(pattern.avgMove)
                    ? "—"
                    : `${pattern.avgMove > 0 ? "+" : pattern.avgMove < 0 ? "−" : ""}${Math.abs(pattern.avgMove).toFixed(2)}%`
                }
                valueClass={avgMoveValueClass}
                hint="mean forward return over the hold"
              />
              <MetricRow
                label="Sample size"
                value={fmtInt(pattern.sampleSize)}
                hint="bars matching all conditions"
              />
            </div>
            <div className="flex flex-col divide-y divide-border">
              <MetricRow
                label="Avg MFE (proxy)"
                value={`${fmtNum(pattern.avgMFE)}%`}
                hint="window-based max favorable excursion"
                tooltip={PROXY_TOOLTIP}
              />
              <MetricRow
                label="Avg MAE (proxy)"
                value={`${fmtNum(pattern.avgMAE)}%`}
                hint="window-based max adverse excursion"
                tooltip={PROXY_TOOLTIP}
              />
              <MetricRow
                label="MFE:MAE ratio"
                value={
                  pattern.mfeMaeRatio != null &&
                  !Number.isNaN(pattern.mfeMaeRatio)
                    ? `${pattern.mfeMaeRatio.toFixed(1)}:1`
                    : "—"
                }
                hint="favorable-to-adverse excursion"
              />
              <MetricRow
                label="Confidence"
                value={pattern.confidence ?? "—"}
                valueClass="capitalize text-primary"
                hint="statistical reliability rating"
              />
              <MetricRow
                label="False-discovery estimate"
                value={
                  pattern.falseDiscoveryRate == null
                    ? "—"
                    : `${(pattern.falseDiscoveryRate * 100).toFixed(2)}%`
                }
                hint="multiple-testing-adjusted estimate across all combinations tested"
              />
            </div>
          </div>
        </div>

        <Separator />

        {pattern.horizonAnalysis ? (
          <>
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Hold-window performance curve
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Recommended hold:{" "}
                  <span className="font-mono font-semibold text-primary">
                    {pattern.horizonAnalysis.recommendedHorizon} bars ·{" "}
                    {fmtDuration(pattern.horizonAnalysis.recommendedDurationMs)}
                  </span>
                  . Ranking uses non-overlapping trades, net expectancy,
                  dispersion, drawdown, early/late stability, sample evidence,
                  and elapsed time—not win rate alone.
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {pattern.horizonAnalysis.rationale}
                </p>
              </div>
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Hold</th>
                      <th className="px-2 py-1.5 text-right">Elapsed</th>
                      <th className="px-2 py-1.5 text-right">Trades</th>
                      <th className="px-2 py-1.5 text-right">Win %</th>
                      <th className="px-2 py-1.5 text-right">Net avg</th>
                      <th className="px-2 py-1.5 text-right">MFE:MAE</th>
                      <th className="px-2 py-1.5 text-right">Max DD</th>
                      <th className="px-2 py-1.5 text-right">Drift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pattern.horizonAnalysis.candidates.map((candidate) => {
                      const recommended =
                        candidate.horizon ===
                        pattern.horizonAnalysis?.recommendedHorizon;
                      return (
                        <tr
                          key={candidate.horizon}
                          className={cn(
                            "border-t border-border",
                            recommended && "bg-primary/5",
                          )}
                        >
                          <td
                            className={cn(
                              "px-2 py-2 font-mono",
                              recommended && "font-semibold text-primary",
                            )}
                          >
                            {candidate.horizon} bars
                            {recommended ? " · best" : ""}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {fmtDuration(candidate.durationMs)}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {candidate.nonOverlapping.sampleSize.toLocaleString()}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {candidate.nonOverlapping.winRate.toFixed(1)}%
                          </td>
                          <td
                            className={cn(
                              "px-2 py-2 text-right font-mono",
                              candidate.avgNetMove > 0
                                ? "text-primary"
                                : "text-destructive",
                            )}
                          >
                            {candidate.avgNetMove >= 0 ? "+" : ""}
                            {candidate.avgNetMove.toFixed(3)}%
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {candidate.mfeMaeRatio == null
                              ? "—"
                              : `${candidate.mfeMaeRatio.toFixed(2)}:1`}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {candidate.maxDrawdown.toFixed(2)}%
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {candidate.stabilityDeltaPp.toFixed(1)}pp
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                “Trades” ignores new signals until the current hold exits. Net
                average subtracts{" "}
                {pattern.horizonAnalysis.roundTripCostBps.toFixed(1)} bps per
                completed trade. The best row is a research recommendation, not
                a guarantee.
              </p>
            </div>
            <Separator />
          </>
        ) : null}

        {executionRows.length > 0 ? (
          <>
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Execution reality check
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Every matching bar preserves the statistical evidence.
                  Non-overlapping trades enter the first signal and ignore new
                  signals until the {pattern.horizon}-bar hold ends, which is
                  closer to a one-position-at-a-time strategy.
                </p>
              </div>
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Interpretation</th>
                      <th className="px-2 py-1.5 text-right">Signals</th>
                      <th className="px-2 py-1.5 text-right">Win %</th>
                      <th className="px-2 py-1.5 text-right">Gross avg</th>
                      <th className="px-2 py-1.5 text-right">Net avg</th>
                      <th className="px-2 py-1.5 text-right">Gross/cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executionRows.map(({ label, summary }) => (
                      <tr key={label} className="border-t border-border">
                        <td className="px-2 py-2 font-medium">{label}</td>
                        <td className="px-2 py-2 text-right font-mono">
                          {summary.sampleSize.toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {summary.winRate.toFixed(1)}%
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {summary.avgGrossMove >= 0 ? "+" : ""}
                          {summary.avgGrossMove.toFixed(2)}%
                        </td>
                        <td
                          className={cn(
                            "px-2 py-2 text-right font-mono",
                            summary.avgNetMove > 0
                              ? "text-primary"
                              : "text-destructive",
                          )}
                        >
                          {summary.avgNetMove >= 0 ? "+" : ""}
                          {summary.avgNetMove.toFixed(2)}%
                        </td>
                        <td className="px-2 py-2 text-right font-mono">
                          {summary.grossCostMultiple == null
                            ? "—"
                            : `${summary.grossCostMultiple.toFixed(1)}×`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Net estimates subtract{" "}
                {(discoveryConfig.roundTripCostBps ?? 0).toFixed(1)} bps (
                {((discoveryConfig.roundTripCostBps ?? 0) / 100).toFixed(3)}%)
                once per completed trade. Ratios are screening heuristics: under
                2× is fragile, 3× is promising, and 5× provides a larger
                cushion.
              </p>
            </div>
            <Separator />
          </>
        ) : null}

        {pattern.outcomeProfile ? (
          <>
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Path-dependent outcomes
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  The event is measured separately from what happened afterward:
                  median movement, target reach, stop reach, and
                  target-before-stop probability.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded border border-border bg-muted/20 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Median move
                  </div>
                  <div className="font-mono text-sm tabular-nums">
                    {pattern.outcomeProfile.medianMove.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded border border-border bg-muted/20 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Median MFE
                  </div>
                  <div className="font-mono text-sm tabular-nums">
                    {pattern.outcomeProfile.medianMFE.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded border border-border bg-muted/20 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Median MAE
                  </div>
                  <div className="font-mono text-sm tabular-nums">
                    {pattern.outcomeProfile.medianMAE.toFixed(2)}%
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Target</th>
                      <th className="px-2 py-1.5 text-right">Hit rate</th>
                      <th className="px-2 py-1.5 text-right">Median time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pattern.outcomeProfile.targetHitRates.map((target) => (
                      <tr
                        key={target.targetPct}
                        className="border-t border-border"
                      >
                        <td className="px-2 py-1.5 font-mono">
                          {target.targetPct.toFixed(2)}%
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {target.hitRate.toFixed(1)}%
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {target.medianBars == null
                            ? "—"
                            : `${target.medianBars.toFixed(0)} bars`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <Separator />
          </>
        ) : null}

        {/* ---- Coverage panel ---- */}
        {pattern.coverage ? (
          <PatternCoveragePanel coverage={pattern.coverage} />
        ) : null}

        <Separator />

        {/* ---- Histogram ---- */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Forward-return distribution
          </h3>
          <p className="text-xs text-muted-foreground">
            How the {fmtInt(pattern.sampleSize)} matching bars were distributed
            by their forward return over the {pattern.horizon ?? "—"}-bar hold.
            {pattern.direction === "bearish"
              ? " Bars to the left of zero favored the bearish pattern."
              : " Bars to the right of zero favored the bullish pattern."}
          </p>
          <div
            data-ocid="pattern_detail_modal.histogram"
            className="h-48 w-full"
          >
            {histogram.length > 0 ? (
              <BarChart
                data={histogram}
                margin={{ top: 4, right: 8, bottom: 4, left: -16 }}
              >
                <CartesianGrid
                  strokeDasharray="2 4"
                  stroke="oklch(var(--border))"
                  vertical={false}
                />
                <XAxis
                  dataKey="mid"
                  tick={{
                    fontSize: 10,
                    fill: "oklch(var(--muted-foreground))",
                  }}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  stroke="oklch(var(--border))"
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{
                    fontSize: 10,
                    fill: "oklch(var(--muted-foreground))",
                  }}
                  stroke="oklch(var(--border))"
                  allowDecimals={false}
                  width={36}
                />
                <ReferenceLine x={0} stroke="oklch(var(--muted-foreground))" />
                <Bar dataKey="count" maxBarSize={28}>
                  {histogram.map((bin) => (
                    <Cell
                      key={bin.range}
                      fill={
                        bin.positive
                          ? "oklch(var(--primary))"
                          : "oklch(var(--destructive) / 0.7)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
                No matching bars available to chart.
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Worst outcome</span>
            <span className="font-mono tabular-nums">
              peak: {maxCount.toLocaleString()} bars
            </span>
            <span>Best outcome</span>
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <Button
            data-ocid="pattern_detail_modal.close_button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" aria-hidden="true" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecipeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-muted/20 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs font-medium text-foreground">{value}</div>
    </div>
  );
}
