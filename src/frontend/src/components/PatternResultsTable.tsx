import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Confidence, Pattern } from "@/types";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronsUpDown,
  Info,
} from "lucide-react";
import { useMemo, useState } from "react";

type SortKey = "winRate" | "sampleSize" | "avgMove" | "confidence";
type SortDir = "asc" | "desc";

interface SortState {
  key: SortKey;
  dir: SortDir;
}

const CONFIDENCE_RANK: Record<Confidence, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  "very high": 3,
};

const CONFIDENCE_PCT: Record<Confidence, number> = {
  low: 25,
  moderate: 50,
  high: 75,
  "very high": 100,
};

interface ColumnDef {
  key: SortKey | "rank" | "conditions" | "mae" | "mfe" | "ratio" | "direction";
  label: string;
  sortable: boolean;
  align: "left" | "right";
}

const COLUMNS: ColumnDef[] = [
  { key: "rank", label: "#", sortable: false, align: "left" },
  { key: "conditions", label: "Conditions", sortable: false, align: "left" },
  { key: "sampleSize", label: "Sample", sortable: true, align: "right" },
  { key: "winRate", label: "Win Rate", sortable: true, align: "right" },
  { key: "avgMove", label: "Avg Move", sortable: true, align: "right" },
  { key: "mae", label: "MAE (proxy)", sortable: false, align: "right" },
  { key: "mfe", label: "MFE (proxy)", sortable: false, align: "right" },
  { key: "ratio", label: "Ratio", sortable: false, align: "right" },
  { key: "confidence", label: "Confidence", sortable: true, align: "left" },
];

/** Tooltip explaining the window-based proxy MFE/MAE measurement. */
const PROXY_TOOLTIP =
  "Window-based proxy: max favorable/adverse excursion measured over the forward hold window, not from a simulated strategy.";

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

function winRateClass(winRate: number): string {
  if (Number.isNaN(winRate)) return "text-muted-foreground";
  if (winRate >= 65) return "text-primary";
  if (winRate >= 55) return "text-warning";
  return "text-destructive";
}

function formatPrice(n: number): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)}`;
}

interface PatternResultsTableProps {
  patterns: Pattern[];
  /** Called when a row is clicked — opens the detail modal. */
  onRowClick: (pattern: Pattern) => void;
}

/**
 * Ranked, sortable results table — the signature view of the engine.
 * Win rate is color-coded; confidence is a horizontal bar; every numeric
 * cell uses JetBrains Mono with tabular-nums. Header is sticky for long
 * lists. Row click opens the detail modal.
 */
export function PatternResultsTable({
  patterns,
  onRowClick,
}: PatternResultsTableProps) {
  const [sort, setSort] = useState<SortState>({
    key: "winRate",
    dir: "desc",
  });

  const sorted = useMemo(() => {
    const rows = [...patterns];
    rows.sort((a, b) => {
      let cmp = 0;
      // Null-safe numeric comparison: treat missing values as -Infinity so
      // incomplete pattern objects sort to the bottom instead of crashing.
      const num = (v: number | undefined) =>
        v == null || Number.isNaN(v) ? Number.NEGATIVE_INFINITY : v;
      switch (sort.key) {
        case "winRate":
          cmp = num(a.winRate) - num(b.winRate);
          break;
        case "sampleSize":
          cmp = num(a.sampleSize) - num(b.sampleSize);
          break;
        case "avgMove":
          cmp = num(a.avgMove) - num(b.avgMove);
          break;
        case "confidence":
          cmp = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
          break;
      }
      return sort.dir === "desc" ? -cmp : cmp;
    });
    return rows;
  }, [patterns, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  };

  const SortIcon = ({ col }: { col: ColumnDef }) => {
    if (!col.sortable) return null;
    const active = sort.key === col.key;
    if (!active)
      return (
        <ChevronsUpDown className="size-3 opacity-40" aria-hidden="true" />
      );
    return sort.dir === "desc" ? (
      <ArrowDown className="size-3" aria-hidden="true" />
    ) : (
      <ArrowUp className="size-3" aria-hidden="true" />
    );
  };

  return (
    <div
      data-ocid="pattern_results_table"
      className="relative overflow-auto rounded-lg border border-border bg-card max-h-[calc(100vh-22rem)]"
    >
      <Table className="text-sm">
        <TableHeader className="sticky top-0 z-10 bg-card shadow-subtle">
          <TableRow className="border-border hover:bg-transparent">
            {COLUMNS.map((col) => {
              const isSortable = col.sortable;
              return (
                <TableHead
                  key={col.key}
                  className={cn(
                    "px-3 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
                    col.align === "right" ? "text-right" : "text-left",
                    isSortable &&
                      "cursor-pointer select-none hover:text-foreground",
                  )}
                  aria-sort={
                    isSortable
                      ? sort.key === col.key
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                      : undefined
                  }
                  onClick={
                    isSortable
                      ? () => toggleSort(col.key as SortKey)
                      : undefined
                  }
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      col.align === "right" && "flex-row-reverse",
                    )}
                  >
                    {col.label}
                    {(col.key === "mae" || col.key === "mfe") && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={`What does ${col.label} mean?`}
                            className="text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Info className="size-3" aria-hidden="true" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[16rem] text-left">
                          {PROXY_TOOLTIP}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <SortIcon col={col} />
                  </span>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((p, idx) => (
            <TableRow
              key={p.id}
              data-ocid={`pattern_results_table.row.${idx}`}
              className="cursor-pointer border-border transition-colors hover:bg-primary/5 focus-visible:bg-primary/5"
              onClick={() => onRowClick(p)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRowClick(p);
                }
              }}
            >
              <TableCell className="px-3 py-2.5">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {String(idx + 1).padStart(2, "0")}
                </span>
              </TableCell>
              <TableCell className="px-3 py-2.5 max-w-[28rem]">
                <div className="flex flex-col gap-1">
                  <span className="text-sm leading-snug text-foreground line-clamp-2">
                    {p.plainEnglishSentence ?? p.label}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide",
                        p.direction === "bullish"
                          ? "text-primary"
                          : p.direction === "bearish"
                            ? "text-destructive"
                            : "text-muted-foreground",
                      )}
                    >
                      {p.direction === "bullish" ? (
                        <ArrowUp className="size-3" aria-hidden="true" />
                      ) : p.direction === "bearish" ? (
                        <ArrowDown className="size-3" aria-hidden="true" />
                      ) : (
                        <ArrowUpDown className="size-3" aria-hidden="true" />
                      )}
                      {p.direction}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      · {p.horizon}-bar hold
                    </span>
                  </span>
                </div>
              </TableCell>
              <TableCell className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
                {fmtInt(p.sampleSize)}
              </TableCell>
              <TableCell
                className={cn(
                  "px-3 py-2.5 text-right font-mono tabular-nums font-semibold",
                  winRateClass(p.winRate),
                )}
              >
                {p.winRate == null || Number.isNaN(p.winRate)
                  ? "—"
                  : `${p.winRate.toFixed(1)}%`}
              </TableCell>
              <TableCell
                className={cn(
                  "px-3 py-2.5 text-right font-mono tabular-nums",
                  p.avgMove == null || Number.isNaN(p.avgMove)
                    ? "text-muted-foreground"
                    : p.avgMove > 0
                      ? "text-primary"
                      : p.avgMove < 0
                        ? "text-destructive"
                        : "text-foreground",
                )}
              >
                {formatPrice(p.avgMove)}
              </TableCell>
              <TableCell className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                {fmtNum(p.avgMAE)}
              </TableCell>
              <TableCell className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                {fmtNum(p.avgMFE)}
              </TableCell>
              <TableCell
                className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground"
                data-ocid={`pattern_results_table.ratio.${idx}`}
              >
                {p.mfeMaeRatio != null && !Number.isNaN(p.mfeMaeRatio)
                  ? `${p.mfeMaeRatio.toFixed(1)}:1`
                  : "—"}
              </TableCell>
              <TableCell className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    tabIndex={0}
                    aria-valuenow={CONFIDENCE_PCT[p.confidence]}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Confidence: ${p.confidence}`}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${CONFIDENCE_PCT[p.confidence]}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs capitalize text-muted-foreground whitespace-nowrap">
                    {p.confidence}
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
