import { DegradationBadge } from "@/components/DegradationBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ValidationResult } from "@/types";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
} from "lucide-react";
import { useMemo, useState } from "react";

type SortKey =
  | "inSampleWinRate"
  | "outOfSampleWinRate"
  | "degradation"
  | "directionAdjustedMfeMaeRatio"
  | "crossSymbolSurvival"
  | "crossTimeframeSurvival";
type SortDir = "asc" | "desc";

interface ValidationTableProps {
  results: ValidationResult[];
  /** Currently selected pattern id (controls row highlight). */
  selectedId: string | null;
  onSelect: (result: ValidationResult) => void;
}

/**
 * Side-by-side in-sample vs out-of-sample comparison table for validated
 * patterns. Sortable by in-sample win rate, out-of-sample win rate,
 * degradation, direction-adjusted MFE/MAE ratio, or cross-symbol survival.
 * Numeric cells use JetBrains Mono with tabular-nums. Row click expands an
 * inline per-pattern detail view with the full metric breakdown.
 */
export function ValidationTable({
  results,
  selectedId,
  onSelect,
}: ValidationTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("inSampleWinRate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const copy = [...results];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = av - bv;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [results, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const handleRowClick = (r: ValidationResult) => {
    onSelect(r);
    setExpandedId((prev) => (prev === r.patternId ? null : r.patternId));
  };

  return (
    <div
      data-ocid="validation_table"
      className="overflow-hidden rounded-lg border border-border bg-card shadow-subtle"
    >
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-muted/30 hover:bg-muted/30">
            <TableHead className="w-8 bg-muted/30" />
            <SortableHeader
              label="Rank"
              sortKey="inSampleWinRate"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => toggleSort("inSampleWinRate")}
              align="left"
              className="w-16"
            />
            <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Conditions
            </TableHead>
            <SortableHeader
              label="In-Sample Win %"
              sortKey="inSampleWinRate"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => toggleSort("inSampleWinRate")}
              align="right"
            />
            <SortableHeader
              label="OOS Win %"
              sortKey="outOfSampleWinRate"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => toggleSort("outOfSampleWinRate")}
              align="right"
            />
            <TableHead className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Δ
            </TableHead>
            <SortableHeader
              label="Adj. MFE/MAE"
              sortKey="directionAdjustedMfeMaeRatio"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => toggleSort("directionAdjustedMfeMaeRatio")}
              align="right"
            />
            <SortableHeader
              label="Cross-Sym Survival"
              sortKey="crossSymbolSurvival"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => toggleSort("crossSymbolSurvival")}
              align="right"
            />
            <SortableHeader
              label="Cross-TF Survival"
              sortKey="crossTimeframeSurvival"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => toggleSort("crossTimeframeSurvival")}
              align="right"
            />
            <SortableHeader
              label="Sample"
              sortKey="outOfSampleWinRate"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => toggleSort("outOfSampleWinRate")}
              align="right"
            />
            <SortableHeader
              label="Status"
              sortKey="degradation"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => toggleSort("degradation")}
              align="center"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r, idx) => {
            const dropPp =
              r.inSampleMetrics.winRate - r.outOfSampleMetrics.winRate;
            const isSelected = r.patternId === selectedId;
            const isExpanded = expandedId === r.patternId;
            return (
              <ValidationRow
                key={r.patternId}
                result={r}
                rank={idx + 1}
                isSelected={isSelected}
                isExpanded={isExpanded}
                dropPp={dropPp}
                onRowClick={handleRowClick}
              />
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row (with expandable detail)
// ---------------------------------------------------------------------------

interface ValidationRowProps {
  result: ValidationResult;
  rank: number;
  isSelected: boolean;
  isExpanded: boolean;
  dropPp: number;
  onRowClick: (r: ValidationResult) => void;
}

function ValidationRow({
  result: r,
  rank,
  isSelected,
  isExpanded,
  dropPp,
  onRowClick,
}: ValidationRowProps) {
  return (
    <>
      <TableRow
        data-ocid={`validation_table.row.${rank - 1}`}
        onClick={() => onRowClick(r)}
        aria-expanded={isExpanded}
        className={cn(
          "cursor-pointer border-border transition-colors",
          isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/40",
        )}
      >
        <TableCell className="w-8 px-2 text-muted-foreground">
          {isExpanded ? (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden="true" />
          )}
        </TableCell>
        <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
          {String(rank).padStart(2, "0")}
        </TableCell>
        <TableCell className="max-w-[20rem]">
          <span className="line-clamp-2 text-sm text-foreground">
            {r.patternLabel}
          </span>
        </TableCell>
        <NumericCell
          value={`${r.inSampleMetrics.winRate.toFixed(1)}`}
          suffix="%"
        />
        <NumericCell
          value={`${r.outOfSampleMetrics.winRate.toFixed(1)}`}
          suffix="%"
        />
        <TableCell className="text-right">
          <DeltaPill dropPp={dropPp} />
        </TableCell>
        <NumericCell value={formatRatio(r.directionAdjustedMfeMaeRatio)} />
        <NumericCell value={formatSurvival(r.crossSymbolSurvival)} />
        <NumericCell value={formatSurvival(r.crossTimeframeSurvival ?? null)} />
        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
          <span className="text-foreground">
            {r.outOfSampleMetrics.sampleSize}
          </span>
          <span className="text-muted-foreground/60">
            {" / "}
            {r.inSampleMetrics.sampleSize + r.outOfSampleMetrics.sampleSize}
          </span>
        </TableCell>
        <TableCell className="text-center">
          <DegradationBadge
            outOfSampleWinRate={r.outOfSampleMetrics.winRate}
            inSampleWinRate={r.inSampleMetrics.winRate}
            outOfSampleSampleSize={r.outOfSampleMetrics.sampleSize}
          />
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow
          data-ocid={`validation_table.detail.${rank - 1}`}
          className="border-border bg-muted/20 hover:bg-muted/20"
        >
          <TableCell colSpan={11} className="p-0">
            <ExpandedDetail result={r} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Expanded detail panel
// ---------------------------------------------------------------------------

function ExpandedDetail({ result: r }: { result: ValidationResult }) {
  const bull = r.byMarketCondition.bull;
  const bear = r.byMarketCondition.bear;
  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      {/* In-sample vs out-of-sample */}
      <div className="flex flex-col gap-2">
        <h4 className="font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          In-Sample vs Out-of-Sample
        </h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <DetailStat
            label="In-Sample Win %"
            value={`${r.inSampleMetrics.winRate.toFixed(1)}%`}
          />
          <DetailStat
            label="OOS Win %"
            value={`${r.outOfSampleMetrics.winRate.toFixed(1)}%`}
          />
          <DetailStat
            label="In-Sample Sample"
            value={String(r.inSampleMetrics.sampleSize)}
          />
          <DetailStat
            label="OOS Sample"
            value={String(r.outOfSampleMetrics.sampleSize)}
          />
          <DetailStat
            label="In-Sample Avg Move"
            value={formatMove(r.inSampleMetrics.avgMove)}
          />
          <DetailStat
            label="OOS Avg Move"
            value={formatMove(r.outOfSampleMetrics.avgMove)}
          />
          <DetailStat
            label="In-Sample MFE / MAE"
            value={`${r.inSampleMetrics.avgMFE.toFixed(2)}% / ${r.inSampleMetrics.avgMAE.toFixed(2)}%`}
          />
          <DetailStat
            label="OOS MFE / MAE"
            value={`${r.outOfSampleMetrics.avgMFE.toFixed(2)}% / ${r.outOfSampleMetrics.avgMAE.toFixed(2)}%`}
          />
        </div>
      </div>

      {/* Direction-adjusted ratio + cross-symbol survival */}
      <div className="flex flex-col gap-2">
        <h4 className="font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Robustness Metrics
        </h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <DetailStat
            label="Direction-Adjusted MFE/MAE Ratio"
            value={formatRatio(r.directionAdjustedMfeMaeRatio)}
            hint={
              r.directionAdjustedMfeMaeRatio == null
                ? "Ratio not computable (zero MAE/MFE)."
                : "MFE/MAE recomputed with direction adjustment so the ratio is meaningful for bearish patterns."
            }
          />
          <DetailStat
            label="Cross-Symbol Survival"
            value={formatSurvival(r.crossSymbolSurvival)}
            hint={
              r.crossSymbolSurvival == null
                ? "No datasets available to evaluate."
                : "Fraction of symbols/datasets the pattern remains profitable on (0–1)."
            }
          />
        </div>
      </div>

      {/* By market condition */}
      <div className="flex flex-col gap-2">
        <h4 className="font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          By Market Condition
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ConditionMiniCard label="Bull Periods" metrics={bull} />
          <ConditionMiniCard label="Bear Periods" metrics={bear} />
        </div>
      </div>

      {/* By year */}
      {r.byYear.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            By Year
          </h4>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {r.byYear.map((y) => (
              <div
                key={y.year}
                data-ocid={`validation_table.detail.year.${y.year}`}
                className="flex items-center gap-1.5 text-xs"
              >
                <span className="font-mono tabular-nums text-muted-foreground">
                  {y.year}
                </span>
                <span className="font-mono tabular-nums text-foreground">
                  {y.metrics.winRate.toFixed(1)}%
                </span>
                <span className="font-mono tabular-nums text-muted-foreground/70">
                  (n={y.metrics.sampleSize})
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Degradation note */}
      {r.degradationNote ? (
        <div className="rounded-md border border-border bg-background/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">{r.degradationNote}</p>
        </div>
      ) : null}
    </div>
  );
}

function DetailStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-md border border-border bg-background/40 px-3 py-2"
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

function ConditionMiniCard({
  label,
  metrics,
}: {
  label: string;
  metrics: ValidationResult["byMarketCondition"]["bull"];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-xs font-semibold text-foreground">
          {label}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          n={metrics.sampleSize}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <DetailStat label="Win %" value={`${metrics.winRate.toFixed(1)}%`} />
        <DetailStat label="Avg Move" value={formatMove(metrics.avgMove)} />
        <DetailStat
          label="MFE / MAE"
          value={`${metrics.avgMFE.toFixed(2)}% / ${metrics.avgMAE.toFixed(2)}%`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SortableHeaderProps {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onClick: () => void;
  align: "left" | "right" | "center";
  className?: string;
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  align,
  className,
}: SortableHeaderProps) {
  const isActive = sortKey === activeKey;
  const Icon = !isActive ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={cn(
        "text-xs font-medium uppercase tracking-wide text-muted-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      <button
        type="button"
        data-ocid={`validation_table.sort.${sortKey}`}
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          align === "center" && "flex-row justify-center",
          isActive && "text-foreground",
        )}
      >
        <span>{label}</span>
        <Icon
          className={cn("size-3", !isActive && "opacity-40")}
          aria-hidden="true"
        />
      </button>
    </TableHead>
  );
}

function NumericCell({
  value,
  suffix,
}: {
  value: string;
  suffix?: string;
}) {
  return (
    <TableCell className="text-right font-mono text-xs tabular-nums text-foreground">
      {value}
      {suffix ? (
        <span className="text-muted-foreground/70">{suffix}</span>
      ) : null}
    </TableCell>
  );
}

function DeltaPill({ dropPp }: { dropPp: number }) {
  const isDegraded = dropPp > 10;
  const isNeutral = Math.abs(dropPp) <= 0.05;
  const sign = dropPp > 0 ? "-" : dropPp < 0 ? "+" : "";
  const abs = Math.abs(dropPp).toFixed(1);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded font-mono text-xs tabular-nums px-1.5 py-0.5",
        isNeutral
          ? "text-muted-foreground"
          : isDegraded
            ? "bg-warning/10 text-warning"
            : "text-primary",
      )}
      title={
        isNeutral
          ? "No meaningful change out-of-sample."
          : `${sign}${abs}pp vs in-sample`
      }
    >
      {isNeutral ? "±0.0" : `${sign}${abs}`}
      <span className="text-muted-foreground/70">pp</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortValue(r: ValidationResult, key: SortKey): number {
  switch (key) {
    case "inSampleWinRate":
      return r.inSampleMetrics.winRate;
    case "outOfSampleWinRate":
      return r.outOfSampleMetrics.winRate;
    case "degradation": {
      // Sort by severity: insufficient sample first (worst), then by pp drop.
      if (r.outOfSampleMetrics.sampleSize < 20) return 9999;
      return r.inSampleMetrics.winRate - r.outOfSampleMetrics.winRate;
    }
    case "directionAdjustedMfeMaeRatio":
      // Nulls sort last regardless of direction.
      return r.directionAdjustedMfeMaeRatio ?? Number.NEGATIVE_INFINITY;
    case "crossSymbolSurvival":
      return r.crossSymbolSurvival ?? Number.NEGATIVE_INFINITY;
    case "crossTimeframeSurvival":
      return r.crossTimeframeSurvival ?? Number.NEGATIVE_INFINITY;
  }
}

function formatMove(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function formatRatio(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function formatSurvival(v: number | null): string {
  if (v == null) return "—";
  // Display as a 0–1 fraction with two decimals (e.g. 0.83).
  return v.toFixed(2);
}
