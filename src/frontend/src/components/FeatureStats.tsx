import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Feature, FeatureMatrix } from "@/types";
import { Hash, Minus, Plus, Sigma } from "lucide-react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface FeatureStatsProps {
  features: Feature[];
  featureValues: FeatureMatrix;
  /** Map of featureId -> enabled. Only enabled features are shown. */
  enabledMap: Record<string, boolean>;
}

interface NumericStats {
  min: number;
  max: number;
  mean: number;
  p25: number;
  p50: number;
  p75: number;
  count: number;
}

interface CategoricalStats {
  bucket: string;
  count: number;
  pct: number;
}

const CHART_COLORS = [
  "oklch(var(--chart-1))",
  "oklch(var(--chart-2))",
  "oklch(var(--chart-3))",
  "oklch(var(--chart-4))",
  "oklch(var(--chart-5))",
];

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000)
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 100) return n.toFixed(1);
  return n.toFixed(digits);
}

function computeNumericStats(
  values: (number | string | undefined)[],
): NumericStats | null {
  const nums = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (nums.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const n of nums) {
    if (n < min) min = n;
    if (n > max) max = n;
    sum += n;
  }
  const mean = sum / nums.length;
  // Sort a single typed copy in place to compute percentiles. We avoid the
  // [...nums].sort() spread+copy pattern which doubles memory for large
  // arrays; instead we copy once into a typed array and sort that copy so
  // the caller's array is not mutated.
  const sorted = nums.slice().sort((a, b) => a - b);
  const pct = (p: number) => {
    const idx = Math.min(
      sorted.length - 1,
      Math.floor((p / 100) * sorted.length),
    );
    return sorted[idx] ?? mean;
  };
  return {
    min,
    max,
    mean,
    p25: pct(25),
    p50: pct(50),
    p75: pct(75),
    count: nums.length,
  };
}

function computeCategoricalStats(
  values: (number | string | undefined)[],
  buckets: string[],
): CategoricalStats[] {
  const counts = new Map<string, number>();
  for (const b of buckets) counts.set(b, 0);
  let total = 0;
  for (const v of values) {
    if (typeof v === "string" && counts.has(v)) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
      total++;
    }
  }
  return buckets.map((bucket) => ({
    bucket,
    count: counts.get(bucket) ?? 0,
    pct: total > 0 ? ((counts.get(bucket) ?? 0) / total) * 100 : 0,
  }));
}

/**
 * Feature summary statistics. For each enabled feature: numeric features show
 * min/max/mean/percentile distribution; categorical features show bucket
 * distribution (count + percentage) with a visual bar chart.
 */
export function FeatureStats({
  features,
  featureValues,
  enabledMap,
}: FeatureStatsProps) {
  const stats = useMemo(() => {
    return features
      .filter((f) => enabledMap[f.id] ?? f.enabled)
      .map((f) => {
        const values = featureValues[f.id] ?? [];
        if (f.type === "categorical") {
          const buckets =
            f.buckets ??
            Array.from(
              new Set(
                values.filter(
                  (value): value is string => typeof value === "string",
                ),
              ),
            ).sort();
          return {
            feature: f,
            kind: "categorical" as const,
            distribution: computeCategoricalStats(values, buckets),
          };
        }
        return {
          feature: f,
          kind: "numeric" as const,
          stats: computeNumericStats(values),
        };
      });
  }, [features, featureValues, enabledMap]);

  if (stats.length === 0) {
    return (
      <div
        data-ocid="feature_stats.empty_state"
        className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground"
      >
        No features enabled. Toggle features on in the catalog above to see
        their stats.
      </div>
    );
  }

  return (
    <div
      data-ocid="feature_stats"
      className="grid grid-cols-1 gap-3 lg:grid-cols-2"
    >
      {stats.map((item) => {
        const { feature, kind } = item;
        const isCategorical = kind === "categorical";
        const numericStats = kind === "numeric" ? item.stats : null;
        const distribution = kind === "categorical" ? item.distribution : null;
        return (
          <div
            key={feature.id}
            data-ocid={`feature_stats.card.${feature.id}`}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <h4 className="font-display text-sm font-semibold text-foreground">
                  {feature.name}
                </h4>
                <Badge
                  variant="secondary"
                  className="w-fit text-[10px] uppercase tracking-wide"
                >
                  {feature.category}
                </Badge>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
                  isCategorical
                    ? "border-border bg-muted/40 text-muted-foreground"
                    : "border-primary/30 bg-primary/10 text-primary",
                )}
              >
                {isCategorical ? (
                  <Hash className="size-2.5" aria-hidden="true" />
                ) : (
                  <Sigma className="size-2.5" aria-hidden="true" />
                )}
                {isCategorical ? "Categorical" : "Numeric"}
              </span>
            </div>

            {/* Body */}
            {isCategorical && distribution ? (
              <CategoricalDistribution distribution={distribution} />
            ) : (
              <NumericDistribution stats={numericStats} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CategoricalDistribution({
  distribution,
}: { distribution: CategoricalStats[] }) {
  const chartData = distribution.map((d) => ({
    bucket: d.bucket,
    count: d.count,
    pct: Number(d.pct.toFixed(1)),
  }));
  // Reduce-based max to avoid Math.max(1, ...distribution.map(...)) spread,
  // which throws RangeError on very large arrays.
  let maxCount = 1;
  for (let i = 0; i < distribution.length; i++) {
    if (distribution[i].count > maxCount) maxCount = distribution[i].count;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Bar chart */}
      <div className="h-32 w-full" data-ocid="feature_stats.chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
          >
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 9, fill: "oklch(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={{ stroke: "oklch(var(--border))" }}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={36}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "oklch(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={32}
            />
            <Tooltip
              cursor={{ fill: "oklch(var(--muted) / 0.4)" }}
              contentStyle={{
                background: "oklch(var(--popover))",
                border: "1px solid oklch(var(--border))",
                borderRadius: "6px",
                fontSize: "11px",
                color: "oklch(var(--popover-foreground))",
              }}
              formatter={(value: number) => [`${value} bars`, "Count"]}
            />
            <Bar dataKey="count" radius={[2, 2, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell
                  key={d.bucket}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Bucket table */}
      <div className="flex flex-col gap-1">
        {distribution.map((d) => (
          <div
            key={d.bucket}
            data-ocid="feature_stats.bucket_row"
            className="flex items-center gap-2"
          >
            <span className="w-20 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
              {d.bucket}
            </span>
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/60">
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-primary transition-all"
                style={{ width: `${(d.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-[10px] text-foreground tabular-nums">
              {d.count.toLocaleString()}
            </span>
            <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
              {d.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NumericDistribution({ stats }: { stats: NumericStats | null }) {
  if (!stats) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        No values computed yet.
      </div>
    );
  }
  const cells: { label: string; value: number; icon: typeof Minus }[] = [
    { label: "Min", value: stats.min, icon: Minus },
    { label: "Mean", value: stats.mean, icon: Sigma },
    { label: "Max", value: stats.max, icon: Plus },
    { label: "P25", value: stats.p25, icon: Minus },
    { label: "P50", value: stats.p50, icon: Sigma },
    { label: "P75", value: stats.p75, icon: Plus },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {cells.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            data-ocid={`feature_stats.stat.${label.toLowerCase()}`}
            className="flex flex-col gap-0.5 rounded-md border border-border bg-muted/30 px-2 py-1.5"
          >
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Icon className="size-2.5" aria-hidden="true" />
              {label}
            </span>
            <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
              {fmt(value)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Sample size
        </span>
        <span className="font-mono text-xs font-semibold text-primary tabular-nums">
          {stats.count.toLocaleString()} bars
        </span>
      </div>
    </div>
  );
}
