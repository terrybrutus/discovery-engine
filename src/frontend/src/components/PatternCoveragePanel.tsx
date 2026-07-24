import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { PatternCoverage } from "@/types";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Database,
  Gauge,
  Layers,
  ListChecks,
  PieChart,
  TrendingUp,
} from "lucide-react";

interface PatternCoveragePanelProps {
  coverage: PatternCoverage;
}

/**
 * Renders a PatternCoverage object: data span, total bars examined, total
 * occurrences, per-symbol / per-timeframe / per-period breakdowns, first &
 * most-recent occurrence, percent of history containing occurrences,
 * performance consistency, concentration flags (as badges), broadly-validated
 * status, and pooled vs equal-symbol results side by side.
 *
 * Embedded inside PatternDetailModal.
 */
export function PatternCoveragePanel({ coverage }: PatternCoveragePanelProps) {
  const spanLabel = formatSpan(
    coverage.earliestTimestamp,
    coverage.latestTimestamp,
  );
  const firstLabel = formatTimestamp(coverage.firstOccurrence);
  const recentLabel = formatTimestamp(coverage.mostRecentOccurrence);

  const symbolEntries = Object.entries(coverage.occurrencesPerSymbol).sort(
    (a, b) => b[1] - a[1],
  );
  const timeframeEntries = Object.entries(
    coverage.occurrencesPerTimeframe,
  ).sort((a, b) => b[1] - a[1]);
  const periodEntries = [...coverage.occurrencesByPeriod].sort((a, b) =>
    a.period.localeCompare(b.period),
  );
  const maxPeriodCount = periodEntries.reduce(
    (m, p) => Math.max(m, p.count),
    1,
  );

  return (
    <div
      data-ocid="pattern_coverage_panel"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      {/* ---- Header: broadly-validated status ---- */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-sm font-semibold tracking-wide text-foreground uppercase">
            Coverage
          </h3>
          <p className="text-xs text-muted-foreground">
            How broadly this pattern is validated across the examined history.
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 gap-1 text-[10px] font-medium uppercase tracking-wide",
            coverage.isBroadlyValidated
              ? "border-success/40 bg-success/10 text-success"
              : "border-warning/40 bg-warning/10 text-warning",
          )}
        >
          {coverage.isBroadlyValidated ? (
            <CheckCircle2 className="size-3" aria-hidden="true" />
          ) : (
            <AlertTriangle className="size-3" aria-hidden="true" />
          )}
          {coverage.isBroadlyValidated ? "Broadly validated" : "Narrow edge"}
        </Badge>
      </div>

      {/* ---- Top-line stats grid ---- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          icon={<Database className="size-3.5" aria-hidden="true" />}
          label="Bars examined"
          value={coverage.totalBarsExamined.toLocaleString()}
        />
        <StatTile
          icon={<ListChecks className="size-3.5" aria-hidden="true" />}
          label="Occurrences"
          value={coverage.totalOccurrences.toLocaleString()}
        />
        <StatTile
          icon={<PieChart className="size-3.5" aria-hidden="true" />}
          label="History covered"
          value={`${coverage.percentOfHistoryContainingOccurrences.toFixed(1)}%`}
        />
        <StatTile
          icon={<Gauge className="size-3.5" aria-hidden="true" />}
          label="Consistency"
          value={coverage.performanceConsistentAcrossSpan ? "Stable" : "Drift"}
          valueClass={
            coverage.performanceConsistentAcrossSpan
              ? "text-success"
              : "text-warning"
          }
        />
      </div>

      {/* ---- Data span + first/most recent ---- */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <LabeledRow
          icon={<CalendarClock className="size-3.5" aria-hidden="true" />}
          label="Data span"
          value={spanLabel}
        />
        <LabeledRow
          icon={<Clock className="size-3.5" aria-hidden="true" />}
          label="First occurrence"
          value={firstLabel}
        />
        <LabeledRow
          icon={<Clock className="size-3.5" aria-hidden="true" />}
          label="Most recent"
          value={recentLabel}
        />
      </div>

      <Separator />

      {/* ---- Per-symbol + per-timeframe lists ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BreakdownList
          icon={<Layers className="size-3.5" aria-hidden="true" />}
          title="Occurrences per symbol"
          entries={symbolEntries}
          emptyText="No symbol breakdown available."
          dataOcidPrefix="pattern_coverage_panel.symbol"
        />
        <BreakdownList
          icon={<Layers className="size-3.5" aria-hidden="true" />}
          title="Occurrences per timeframe"
          entries={timeframeEntries}
          emptyText="No timeframe breakdown available."
          dataOcidPrefix="pattern_coverage_panel.timeframe"
        />
      </div>

      {/* ---- Occurrences by period (simple bars) ---- */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Occurrences by period
          </h4>
        </div>
        {periodEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No period breakdown available.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {periodEntries.map((p) => (
              <li
                key={p.period}
                data-ocid={`pattern_coverage_panel.period.${p.period}`}
                className="flex items-center gap-2"
              >
                <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {p.period}
                </span>
                <div
                  className="relative h-3 flex-1 overflow-hidden rounded-sm bg-muted"
                  role="img"
                  aria-label={`${p.count} occurrences in ${p.period}`}
                >
                  <div
                    className="h-full rounded-sm bg-primary/70"
                    style={{
                      width: `${Math.max(2, (p.count / maxPeriodCount) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-foreground">
                  {p.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- Concentration flags ---- */}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Concentration flags
        </h4>
        {coverage.concentrationFlags.length === 0 ? (
          <div className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            <span>
              No concentration warnings — pattern is well distributed.
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {coverage.concentrationFlags.map((flag) => (
              <Badge
                key={flag}
                variant="outline"
                className="gap-1 border-warning/40 bg-warning/10 text-warning text-[10px] font-medium uppercase tracking-wide"
              >
                <AlertTriangle className="size-2.5" aria-hidden="true" />
                {flag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* ---- Pooled vs equal-symbol results ---- */}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Pooled vs equal-symbol results
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ResultCard
            title="Pooled"
            subtitle="all occurrences weighted equally"
            result={coverage.pooledResult}
            dataOcid="pattern_coverage_panel.pooled"
          />
          <ResultCard
            title="Equal-symbol"
            subtitle="each symbol weighted equally"
            result={coverage.equalSymbolResult}
            dataOcid="pattern_coverage_panel.equal_symbol"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatTile({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-background/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <span
        className={cn(
          "font-mono text-sm tabular-nums font-semibold text-foreground",
          valueClass,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function LabeledRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background/40 px-2.5 py-1.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <span className="font-mono text-xs tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function BreakdownList({
  icon,
  title,
  entries,
  emptyText,
  dataOcidPrefix,
}: {
  icon: React.ReactNode;
  title: string;
  entries: [string, number][];
  emptyText: string;
  dataOcidPrefix: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h4>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {entries.map(([key, count]) => (
            <li
              key={key}
              data-ocid={`${dataOcidPrefix}.${key}`}
              className="flex items-baseline justify-between gap-2 text-xs"
            >
              <span className="truncate text-foreground">{key}</span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {count.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultCard({
  title,
  subtitle,
  result,
  dataOcid,
}: {
  title: string;
  subtitle: string;
  result: { winRate: number; avgMove: number; sampleSize: number };
  dataOcid: string;
}) {
  return (
    <div
      data-ocid={dataOcid}
      className="flex flex-col gap-1.5 rounded-md border border-border bg-background/40 px-3 py-2.5"
    >
      <div className="flex flex-col">
        <span className="font-display text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="text-[10px] text-muted-foreground">{subtitle}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <MiniMetric label="Win %" value={`${result.winRate.toFixed(1)}%`} />
        <MiniMetric
          label="Avg move"
          value={`${result.avgMove > 0 ? "+" : result.avgMove < 0 ? "−" : ""}${Math.abs(result.avgMove).toFixed(2)}`}
        />
        <MiniMetric label="Sample" value={result.sampleSize.toLocaleString()} />
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
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

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSpan(startMs: number, endMs: number): string {
  if (
    !startMs ||
    !endMs ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs)
  ) {
    return "—";
  }
  const start = new Date(startMs);
  const end = new Date(endMs);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";
  const startStr = start.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  const endStr = end.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  return `${startStr} → ${endStr}`;
}
