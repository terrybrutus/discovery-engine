import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import {
  validationFailureReason,
  validationHeldUp,
} from "@/lib/validationPolicy";
import type { PatternMetrics, ValidationResult } from "@/types";
import { TrendingDown, TrendingUp, X } from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

interface ValidationBreakdownProps {
  /** Single-pattern detail view. */
  result: ValidationResult;
  onClose: () => void;
}

const chartConfig = {
  winRate: { label: "Win Rate %", color: "oklch(var(--chart-1))" },
  bull: { label: "Bull Market", color: "oklch(var(--chart-1))" },
  bear: { label: "Bear Market", color: "oklch(var(--chart-3))" },
} satisfies ChartConfig;

/** Win-rate threshold (out-of-sample) above which a pattern "passes". */
const PASS_THRESHOLD = 50;

/**
 * Detailed breakdown for a single validated pattern: a plain-English
 * summary, market-condition split (bull vs bear), and a year-by-year
 * win-rate chart. Uses recharts for the year visualization.
 *
 * Aggregate statistics (total patterns validated, pass rate, average
 * direction-adjusted MFE/MAE ratio, average cross-symbol survival) are
 * available via the exported {@link ValidationAggregate} component.
 */
export function ValidationBreakdown({
  result,
  onClose,
}: ValidationBreakdownProps) {
  const summary = useMemo(() => buildSummary(result), [result]);
  const yearData = useMemo(
    () =>
      result.byYear.map((y) => ({
        year: String(y.year),
        winRate: Number(y.metrics.winRate.toFixed(1)),
        sample: y.metrics.sampleSize,
      })),
    [result],
  );

  const bull = result.byMarketCondition.bull;
  const bear = result.byMarketCondition.bear;

  return (
    <div
      data-ocid="validation_breakdown"
      className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5 shadow-subtle"
    >
      {/* Header + close */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <h3 className="font-display text-base font-semibold text-foreground">
            Pattern Breakdown
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {result.patternLabel}
          </p>
        </div>
        <Button
          data-ocid="validation_breakdown.close_button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close breakdown"
          className="size-8 shrink-0"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {/* Robustness metrics for this pattern */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <RobustnessStat
          label="Direction-Adjusted MFE/MAE"
          value={formatRatio(result.directionAdjustedMfeMaeRatio)}
          hint="MFE/MAE recomputed with direction adjustment so the ratio is meaningful for bearish patterns."
          dataOcid="validation_breakdown.direction_adjusted_ratio"
        />
        <RobustnessStat
          label="Cross-Symbol Survival"
          value={formatSurvival(result.crossSymbolSurvival)}
          hint="Fraction of symbols/datasets the pattern remains profitable on (0–1)."
          dataOcid="validation_breakdown.cross_symbol_survival"
        />
        <RobustnessStat
          label="Cross-Timeframe Survival"
          value={formatSurvival(result.crossTimeframeSurvival ?? null)}
          hint="Fraction of independently evaluated timeframes on which the pattern remained profitable."
          dataOcid="validation_breakdown.cross_timeframe_survival"
        />
        <RobustnessStat
          label="Walk-Forward Folds"
          value={
            result.walkForward
              ? `${result.walkForward.passedFolds}/${result.walkForward.folds}`
              : "—"
          }
          hint={
            result.walkForward
              ? `Mean ${result.walkForward.meanWinRate.toFixed(1)}%; worst fold ${result.walkForward.worstWinRate.toFixed(1)}%.`
              : "No walk-forward audit available."
          }
          dataOcid="validation_breakdown.walk_forward"
        />
      </div>

      {/* Plain-English summary */}
      <div
        data-ocid="validation_breakdown.summary"
        className="rounded-md border border-border bg-muted/30 px-4 py-3"
      >
        <p className="text-sm leading-relaxed text-foreground">{summary}</p>
      </div>

      {/* Market condition split */}
      <div className="flex flex-col gap-3">
        <h4 className="font-display text-sm font-semibold text-foreground">
          By Market Condition
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ConditionCard
            label="Bull Periods"
            metrics={bull}
            tone="bull"
            dataOcid="validation_breakdown.condition.bull"
          />
          <ConditionCard
            label="Bear Periods"
            metrics={bear}
            tone="bear"
            dataOcid="validation_breakdown.condition.bear"
          />
        </div>
      </div>

      {/* Year-by-year chart */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="font-display text-sm font-semibold text-foreground">
            Year-by-Year Win Rate
          </h4>
          <span className="text-xs text-muted-foreground">
            {result.byYear.length} calendar year
            {result.byYear.length === 1 ? "" : "s"} in dataset
          </span>
        </div>
        {yearData.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
            No matched samples in any year.
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-[16/7] w-full"
            data-ocid="validation_breakdown.year_chart"
          >
            <BarChart
              data={yearData}
              margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="oklch(var(--border))"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="year"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "oklch(var(--muted-foreground))" }}
              />
              <YAxis
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "oklch(var(--muted-foreground))" }}
                tickFormatter={(v) => `${v}%`}
              />
              <ChartTooltip
                cursor={{ fill: "oklch(var(--muted) / 0.4)" }}
                content={
                  <ChartTooltipContent
                    formatter={(value, _name, _item, _idx, payload) => (
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {Number(value).toFixed(1)}% win rate
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {payload?.[0]?.payload?.sample ?? 0} samples
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Bar dataKey="winRate" radius={[3, 3, 0, 0]}>
                {yearData.map((d) => (
                  <Cell
                    key={d.year}
                    fill={
                      d.winRate >= 55
                        ? "oklch(var(--chart-1))"
                        : d.winRate >= 45
                          ? "oklch(var(--chart-2))"
                          : "oklch(var(--chart-3))"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
        <YearLegend rows={result.byYear} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aggregate statistics panel
// ---------------------------------------------------------------------------

interface ValidationAggregateProps {
  results: ValidationResult[];
  /** Out-of-sample win-rate threshold above which a pattern "passes". */
  passThreshold?: number;
}

/**
 * Aggregate validation statistics across all validated patterns:
 * total patterns validated, pass rate (fraction with out-of-sample
 * win rate above the threshold), average direction-adjusted MFE/MAE
 * ratio (average of non-null values), and average cross-symbol
 * survival (average of non-null values). All numerics use JetBrains
 * Mono with tabular-nums.
 */
export function ValidationAggregate({
  results,
  passThreshold = PASS_THRESHOLD,
}: ValidationAggregateProps) {
  const stats = useMemo(
    () => computeAggregate(results, passThreshold),
    [results, passThreshold],
  );

  return (
    <div
      data-ocid="validation_aggregate"
      className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 shadow-subtle sm:grid-cols-5"
    >
      <AggregateStat
        label="Patterns Validated"
        value={String(stats.total)}
        dataOcid="validation_aggregate.total"
      />
      <AggregateStat
        label="Pass Rate"
        value={stats.total === 0 ? "—" : `${stats.passRate.toFixed(1)}%`}
        hint={`Requires more than ${passThreshold}% OOS wins, at least 20 OOS occurrences, and no material degradation.`}
        dataOcid="validation_aggregate.pass_rate"
      />
      <AggregateStat
        label="Avg Adj. MFE/MAE"
        value={formatRatio(stats.avgDirectionAdjustedMfeMaeRatio)}
        hint="Average of non-null direction-adjusted MFE/MAE ratios."
        dataOcid="validation_aggregate.avg_ratio"
      />
      <AggregateStat
        label="Avg Cross-Sym Survival"
        value={formatSurvival(stats.avgCrossSymbolSurvival)}
        hint="Average of non-null cross-symbol survival fractions (0–1)."
        dataOcid="validation_aggregate.avg_survival"
      />
      <AggregateStat
        label="Avg Cross-TF Survival"
        value={formatSurvival(stats.avgCrossTimeframeSurvival)}
        hint="Average survival across independently evaluated compatible timeframes."
        dataOcid="validation_aggregate.avg_timeframe_survival"
      />
    </div>
  );
}

interface AggregateStats {
  total: number;
  passRate: number;
  avgDirectionAdjustedMfeMaeRatio: number | null;
  avgCrossSymbolSurvival: number | null;
  avgCrossTimeframeSurvival: number | null;
}

function computeAggregate(
  results: ValidationResult[],
  passThreshold: number,
): AggregateStats {
  const total = results.length;
  if (total === 0) {
    return {
      total: 0,
      passRate: 0,
      avgDirectionAdjustedMfeMaeRatio: null,
      avgCrossSymbolSurvival: null,
      avgCrossTimeframeSurvival: null,
    };
  }

  const passed = results.filter((result) =>
    validationHeldUp(result, passThreshold),
  ).length;
  const passRate = (passed / total) * 100;

  const ratios = results
    .map((r) => r.directionAdjustedMfeMaeRatio)
    .filter((v): v is number => v != null);
  const avgDirectionAdjustedMfeMaeRatio =
    ratios.length === 0
      ? null
      : ratios.reduce((a, b) => a + b, 0) / ratios.length;

  const survivals = results
    .map((r) => r.crossSymbolSurvival)
    .filter((v): v is number => v != null);
  const avgCrossSymbolSurvival =
    survivals.length === 0
      ? null
      : survivals.reduce((a, b) => a + b, 0) / survivals.length;
  const timeframeSurvivals = results
    .map((result) => result.crossTimeframeSurvival ?? null)
    .filter((value): value is number => value != null);
  const avgCrossTimeframeSurvival =
    timeframeSurvivals.length === 0
      ? null
      : timeframeSurvivals.reduce((left, right) => left + right, 0) /
        timeframeSurvivals.length;

  return {
    total,
    passRate,
    avgDirectionAdjustedMfeMaeRatio,
    avgCrossSymbolSurvival,
    avgCrossTimeframeSurvival,
  };
}

function AggregateStat({
  label,
  value,
  hint,
  dataOcid,
}: {
  label: string;
  value: string;
  hint?: string;
  dataOcid: string;
}) {
  return (
    <div data-ocid={dataOcid} className="flex flex-col gap-1" title={hint}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-lg tabular-nums font-semibold text-foreground">
        {value}
      </span>
    </div>
  );
}

function RobustnessStat({
  label,
  value,
  hint,
  dataOcid,
}: {
  label: string;
  value: string;
  hint?: string;
  dataOcid: string;
}) {
  return (
    <div
      data-ocid={dataOcid}
      className="flex flex-col gap-1 rounded-md border border-border bg-background/40 px-3 py-2"
      title={hint}
    >
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConditionCard({
  label,
  metrics,
  tone,
  dataOcid,
}: {
  label: string;
  metrics: PatternMetrics;
  tone: "bull" | "bear";
  dataOcid: string;
}) {
  const Icon = tone === "bull" ? TrendingUp : TrendingDown;
  const accent =
    tone === "bull"
      ? "text-primary border-primary/30"
      : "text-chart-3 border-chart-3/30";
  return (
    <div
      data-ocid={dataOcid}
      className="flex flex-col gap-3 rounded-md border border-border bg-background/40 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className={cn("flex items-center gap-1.5", accent)}>
          <Icon className="size-4" aria-hidden="true" />
          <span className="font-display text-sm font-semibold">{label}</span>
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          n={metrics.sampleSize}
        </span>
      </div>
      <WinRateBar winRate={metrics.winRate} tone={tone} />
      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric label="Win %" value={`${metrics.winRate.toFixed(1)}%`} />
        <Metric label="Avg Move" value={`${metrics.avgMove.toFixed(2)}%`} />
        <Metric
          label="MFE (proxy) / MAE (proxy)"
          value={`${metrics.avgMFE.toFixed(2)}% / ${metrics.avgMAE.toFixed(2)}%`}
        />
      </div>
    </div>
  );
}

function WinRateBar({
  winRate,
  tone,
}: {
  winRate: number;
  tone: "bull" | "bear";
}) {
  const pct = Math.max(0, Math.min(100, winRate));
  const barColor = tone === "bull" ? "bg-primary" : "bg-chart-3";
  return (
    <div
      className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`Win rate ${pct.toFixed(1)} percent`}
    >
      <div
        className={cn("h-full rounded-full transition-all", barColor)}
        style={{ width: `${pct}%` }}
      />
      {/* 50% reference line */}
      <div
        className="absolute top-0 bottom-0 w-px bg-foreground/30"
        style={{ left: "50%" }}
        aria-hidden="true"
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-xs tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function YearLegend({
  rows,
}: {
  rows: { year: number; metrics: PatternMetrics }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {rows.map((r) => (
        <div
          key={r.year}
          data-ocid={`validation_breakdown.year_legend.${r.year}`}
          className="flex items-center gap-1.5 text-xs"
        >
          <span className="font-mono tabular-nums text-muted-foreground">
            {r.year}
          </span>
          <span className="font-mono tabular-nums text-foreground">
            {r.metrics.winRate.toFixed(1)}%
          </span>
          <span className="font-mono tabular-nums text-muted-foreground/70">
            (n={r.metrics.sampleSize})
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plain-English summary builder
// ---------------------------------------------------------------------------

function buildSummary(r: ValidationResult): string {
  const yearsHeld = r.byYear.filter(
    (y) => y.metrics.winRate >= r.inSampleMetrics.winRate - 10,
  ).length;
  const yearsTotal = r.byYear.length;

  const bull = r.byMarketCondition.bull;
  const bear = r.byMarketCondition.bear;
  const bearDegraded =
    bear.sampleSize >= 20 &&
    bull.sampleSize >= 20 &&
    bull.winRate - bear.winRate > 10;

  const parts: string[] = [];

  if (r.outOfSampleMetrics.sampleSize < 20) {
    parts.push(
      `Only ${r.outOfSampleMetrics.sampleSize} out-of-sample matches — too few to trust the result.`,
    );
  } else if (r.degraded) {
    const drop = (
      r.inSampleMetrics.winRate - r.outOfSampleMetrics.winRate
    ).toFixed(1);
    parts.push(
      `This pattern degraded out-of-sample, dropping ${drop}pp from ${r.inSampleMetrics.winRate.toFixed(1)}% to ${r.outOfSampleMetrics.winRate.toFixed(1)}%.`,
    );
  } else if (!validationHeldUp(r)) {
    parts.push(
      `This pattern did not clear the reliability rule because it ${validationFailureReason(r)}.`,
    );
  } else {
    parts.push(
      `This pattern held up out-of-sample: ${r.outOfSampleMetrics.winRate.toFixed(1)}% win rate vs ${r.inSampleMetrics.winRate.toFixed(1)}% in-sample.`,
    );
  }

  if (yearsTotal > 0) {
    parts.push(
      `It held up in ${yearsHeld} of ${yearsTotal} year${yearsTotal === 1 ? "" : "s"}.`,
    );
  }

  if (bearDegraded) {
    parts.push(
      `It degraded in bear markets (${bear.winRate.toFixed(1)}% vs ${bull.winRate.toFixed(1)}% in bull periods).`,
    );
  } else if (bull.sampleSize >= 20 && bear.sampleSize >= 20) {
    parts.push(
      `It performed similarly in bull (${bull.winRate.toFixed(1)}%) and bear (${bear.winRate.toFixed(1)}%) markets.`,
    );
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Formatting helpers (shared with ValidationTable conventions)
// ---------------------------------------------------------------------------

function formatRatio(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function formatSurvival(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}
