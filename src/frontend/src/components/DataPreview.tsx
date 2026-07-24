import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { COLUMN_ALIASES, normalizeHeader } from "@/lib/csvParser";
import { cn } from "@/lib/utils";
import type { Dataset } from "@/types";
import { Calendar, Database, Layers, Rows3 } from "lucide-react";

const PREVIEW_ROWS = 15;

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} ${time}`;
}

function fmtPrice(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtVolume(n: number): string {
  return Math.round(n).toLocaleString();
}

interface StatCardProps {
  icon: typeof Database;
  label: string;
  value: string;
  dataOcid: string;
}

function StatCard({ icon: Icon, label, value, dataOcid }: StatCardProps) {
  return (
    <div
      data-ocid={dataOcid}
      className="flex items-center gap-3 rounded-md border border-border bg-card/60 px-3 py-2.5"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
        <Icon className="size-4 text-primary" aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="truncate font-mono text-sm font-medium text-foreground tabular-nums">
          {value}
        </span>
      </div>
    </div>
  );
}

/**
 * Data preview shown after a dataset is loaded. Renders summary stats
 * (name, row count, date range, detected timeframe) and the first 15 rows
 * of OHLCV data in a scrollable table. All numbers use JetBrains Mono with
 * tabular-nums for instrument-panel alignment.
 */
export function DataPreview({ dataset }: { dataset: Dataset }) {
  const previewBars = dataset.bars.slice(0, PREVIEW_ROWS);
  const startDate = fmtDate(dataset.dateRange.start);
  const endDate = fmtDate(dataset.dateRange.end);

  // Pre-compute a lookup from original column name → normalized key, so
  // renderCell can read custom column values from dataset.columnValues.
  const columnKeyByOriginal = new Map<string, string>();
  for (const col of dataset.columns) {
    columnKeyByOriginal.set(col.label, col.key);
  }

  return (
    <div
      data-ocid="data_preview"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card/40 p-4"
    >
      {/* Header row: name + timeframe badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Database
            className="size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <h3
            data-ocid="data_preview.name"
            className="truncate font-display text-sm font-semibold text-foreground"
            title={dataset.name}
          >
            {dataset.name}
          </h3>
        </div>
        <Badge
          data-ocid="data_preview.timeframe_badge"
          variant="secondary"
          className="font-mono tabular-nums"
        >
          {dataset.timeframe} bars
        </Badge>
      </div>

      {/* Summary stats grid */}
      <div
        data-ocid="data_preview.stats"
        className="grid grid-cols-2 gap-2 lg:grid-cols-4"
      >
        <StatCard
          icon={Rows3}
          label="Rows"
          value={dataset.rowCount.toLocaleString()}
          dataOcid="data_preview.stat.rows"
        />
        <StatCard
          icon={Layers}
          label="Timeframe"
          value={dataset.timeframe}
          dataOcid="data_preview.stat.timeframe"
        />
        <StatCard
          icon={Calendar}
          label="Start"
          value={startDate}
          dataOcid="data_preview.stat.start"
        />
        <StatCard
          icon={Calendar}
          label="End"
          value={endDate}
          dataOcid="data_preview.stat.end"
        />
      </div>

      {/* Detected columns */}
      <div
        data-ocid="data_preview.columns"
        className="rounded-md border border-border bg-background p-3"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Detected columns ({dataset.columns.length})
          </span>
          <span className="text-[11px] text-muted-foreground/70">
            Original names preserved from your header row.
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {dataset.columns.map((col, i) => (
            <span
              key={`${col.key}-${i}`}
              data-ocid={`data_preview.column_chip.${i + 1}`}
              className="column-chip"
              title={`${col.label} · ${col.type}`}
            >
              {col.label}
            </span>
          ))}
        </div>
      </div>

      {/* Preview table */}
      <div
        data-ocid="data_preview.table"
        className="rounded-md border border-border bg-background"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            First {previewBars.length} rows
          </span>
          <span className="text-[11px] text-muted-foreground/70">
            Showing a preview — all {dataset.rowCount.toLocaleString()} rows are
            loaded in memory.
          </span>
        </div>
        <ScrollArea className="h-[280px] w-full">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="pl-3 text-xs uppercase tracking-wider text-muted-foreground">
                  #
                </TableHead>
                {dataset.originalColumns.map((col, i) => (
                  <TableHead
                    // biome-ignore lint/suspicious/noArrayIndexKey: key includes stable column name; index disambiguates duplicates
                    key={`${col}-${i}`}
                    className={cn(
                      "text-xs uppercase tracking-wider text-muted-foreground",
                      i > 0 && "text-right",
                      i === dataset.originalColumns.length - 1 && "pr-3",
                    )}
                  >
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewBars.map((bar, i) => (
                <TableRow
                  key={bar.timestamp}
                  data-ocid={`data_preview.row.${i + 1}`}
                  className="border-border/60"
                >
                  <TableCell className="pl-3 font-mono text-xs text-muted-foreground tabular-nums">
                    {i + 1}
                  </TableCell>
                  {dataset.originalColumns.map((col, ci) => (
                    <TableCell
                      // biome-ignore lint/suspicious/noArrayIndexKey: key includes stable column name; index disambiguates duplicates
                      key={`${col}-${ci}`}
                      className={cn(
                        "font-mono text-xs text-foreground tabular-nums",
                        ci > 0 && "text-right",
                        ci === dataset.originalColumns.length - 1 && "pr-3",
                      )}
                    >
                      {renderCell(bar, col, i, dataset, columnKeyByOriginal)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </div>
  );
}

/**
 * Map an original column name to a preview cell value for one row.
 *
 * OHLCV columns read from the bar; custom (non-OHLCV) numeric columns read
 * from `dataset.columnValues[normalizedKey]` at the row's bar index. If the
 * custom value is missing/NaN, falls back to "—".
 */
function renderCell(
  bar: {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  },
  col: string,
  rowIndex: number,
  dataset: Dataset,
  columnKeyByOriginal: Map<string, string>,
): string {
  const norm = col
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]/g, "");
  if (
    COLUMN_ALIASES.timestamp.includes(norm) ||
    norm === "timestamp" ||
    norm === "time" ||
    norm === "date" ||
    norm === "datetime" ||
    norm === "dt" ||
    norm === "unix" ||
    norm === "ts"
  ) {
    return fmtDate(bar.timestamp);
  }
  if (norm === "open" || norm === "o") return fmtPrice(bar.open);
  if (norm === "high" || norm === "h") return fmtPrice(bar.high);
  if (norm === "low" || norm === "l") return fmtPrice(bar.low);
  if (norm === "close" || norm === "c" || norm === "last" || norm === "price")
    return fmtPrice(bar.close);
  if (norm === "volume" || norm === "vol" || norm === "v")
    return fmtVolume(bar.volume);

  // Non-OHLCV column: read from dataset.columnValues at this row's index.
  const cv = dataset.columnValues;
  if (cv) {
    const key = columnKeyByOriginal.get(col) ?? normalizeHeader(col);
    const arr = cv[key];
    if (arr && rowIndex < arr.length) {
      const v = arr[rowIndex];
      if (v != null && !Number.isNaN(v)) {
        return fmtPrice(v);
      }
    }
  }
  return "—";
}
