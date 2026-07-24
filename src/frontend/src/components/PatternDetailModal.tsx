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
    returns.push(exit - entry);
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
      positive: mid >= 0,
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
  const dataset = useEngineStore((s) => s.dataset);
  const features = useEngineStore((s) => s.features);
  const featureValues = useEngineStore((s) => s.featureValues);

  const histogram = useMemo(() => {
    if (!pattern || !dataset || !featureValues) return [];
    return computeHistogram(dataset.bars, features, featureValues, pattern);
  }, [pattern, dataset, features, featureValues]);

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
            Bars to the right of zero were winners.
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
