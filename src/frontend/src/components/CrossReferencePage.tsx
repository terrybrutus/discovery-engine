import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useEngineStore } from "@/store/engineStore";
import type { CrossReferenceConfig, CrossReferenceResult } from "@/types";
import {
  GitCompareArrows,
  Layers,
  ListFilter,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/**
 * Cross-Reference tab — aligns threshold-based events across two or more
 * loaded datasets by timestamp and surfaces moments where conditions on
 * different timeframes line up. Hosts a dataset multi-selector, a column
 * selector (union of selected datasets' original columns), a Run button,
 * and a results table styled for the terminal aesthetic.
 */
export default function CrossReferencePage() {
  const datasets = useEngineStore((s) => s.datasets);
  const crossReferenceResults = useEngineStore((s) => s.crossReferenceResults);
  const isCrossReferencing = useEngineStore((s) => s.isCrossReferencing);
  const runCrossReferenceAction = useEngineStore(
    (s) => s.runCrossReferenceAction,
  );
  const clearCrossReferenceResults = useEngineStore(
    (s) => s.clearCrossReferenceResults,
  );
  const completedSteps = useEngineStore((s) => s.completedSteps);

  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);

  const hasRun = completedSteps.has("crossReferenceComplete");
  const hasResults = crossReferenceResults.length > 0;

  // ---- Derived: union of original columns across selected datasets ----
  const availableColumns = useMemo(() => {
    const set = new Set<string>();
    for (const id of selectedDatasetIds) {
      const ds = datasets.find((d) => d.id === id);
      if (ds) {
        for (const col of ds.originalColumns) set.add(col);
      }
    }
    return Array.from(set);
  }, [selectedDatasetIds, datasets]);

  // Prune selected columns that are no longer available when datasets change.
  useEffect(() => {
    setSelectedColumns((prev) =>
      prev.filter((c) => availableColumns.includes(c)),
    );
  }, [availableColumns]);

  // Toast when a run finishes.
  useEffect(() => {
    if (!isCrossReferencing && hasRun && hasResults) {
      toast.success(
        `Cross-reference complete — ${crossReferenceResults.length.toLocaleString()} coincident moment${crossReferenceResults.length === 1 ? "" : "s"} found.`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCrossReferencing, hasRun, hasResults, crossReferenceResults.length]);

  const canRun = selectedDatasetIds.length >= 2 && selectedColumns.length >= 1;

  const toggleDataset = (id: string) => {
    setSelectedDatasetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) =>
      prev.includes(col) ? prev.filter((x) => x !== col) : [...prev, col],
    );
  };

  const handleRun = () => {
    if (!canRun) return;
    const config: CrossReferenceConfig = {
      datasetIds: selectedDatasetIds,
      columns: selectedColumns,
    };
    void runCrossReferenceAction(config);
  };

  const handleClear = () => {
    clearCrossReferenceResults();
  };

  // ---- Empty: no datasets loaded ----
  if (datasets.length < 2) {
    return (
      <div
        data-ocid="page.cross_reference"
        className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6 md:py-10"
      >
        <PageHeading />
        <EmptyState
          icon={Layers}
          title="Load at least two datasets"
          description="Cross-reference aligns threshold-based events across two or more datasets by timestamp. Load multiple datasets (e.g. different timeframes of the same instrument) in the Data Intake panel, then return here to find coincident conditions."
          hint="Each dataset keeps its original column names — they are preserved verbatim throughout the analysis."
        />
      </div>
    );
  }

  return (
    <div
      data-ocid="page.cross_reference"
      className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10"
    >
      <PageHeading />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[22rem_1fr]">
        {/* ---- Controls panel ---- */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b border-border px-5 py-4">
              <CardTitle className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide">
                <ListFilter
                  className="size-4 text-primary"
                  aria-hidden="true"
                />
                Cross-Reference Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 px-5 py-5">
              {/* Dataset multi-selector */}
              <fieldset className="flex flex-col gap-2">
                <legend className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Datasets</span>
                  <span
                    className="font-mono tabular-nums text-foreground"
                    data-ocid="cross_reference.dataset_count"
                  >
                    {selectedDatasetIds.length}/{datasets.length}
                  </span>
                </legend>
                <p className="text-xs text-muted-foreground">
                  Select 2 or more datasets to align by timestamp.
                </p>
                <ul
                  data-ocid="cross_reference.dataset_list"
                  className="flex flex-col gap-1.5"
                >
                  {datasets.map((ds, idx) => {
                    const checked = selectedDatasetIds.includes(ds.id);
                    return (
                      <li key={ds.id}>
                        <label
                          data-ocid={`cross_reference.dataset.${idx + 1}`}
                          className={cn(
                            "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-smooth",
                            checked
                              ? "border-primary/50 bg-primary/5 text-foreground"
                              : "border-border bg-card text-foreground hover:border-border/80 hover:bg-muted/40",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDataset(ds.id)}
                            data-ocid={`cross_reference.dataset.${idx + 1}.checkbox`}
                            className="size-4 accent-[oklch(var(--primary))]"
                          />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums">
                            {ds.label ?? ds.name}
                          </span>
                          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                            {ds.rowCount.toLocaleString()} bars
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              {/* Column selector (union of selected datasets' original columns) */}
              <fieldset className="flex flex-col gap-2">
                <legend className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Columns to analyze</span>
                  <span
                    className="font-mono tabular-nums text-foreground"
                    data-ocid="cross_reference.column_count"
                  >
                    {selectedColumns.length}/{availableColumns.length}
                  </span>
                </legend>
                {availableColumns.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Select datasets above to populate the column list.
                  </p>
                ) : (
                  <ul
                    data-ocid="cross_reference.column_list"
                    className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1"
                  >
                    {availableColumns.map((col, idx) => {
                      const checked = selectedColumns.includes(col);
                      return (
                        <li key={col}>
                          <label
                            data-ocid={`cross_reference.column.${idx + 1}`}
                            className={cn(
                              "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-smooth",
                              checked
                                ? "border-primary/50 bg-primary/5 text-foreground"
                                : "border-border bg-card text-foreground hover:bg-muted/40",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleColumn(col)}
                              data-ocid={`cross_reference.column.${idx + 1}.checkbox`}
                              className="size-3.5 accent-[oklch(var(--primary))]"
                            />
                            <span className="column-chip min-w-0 flex-1 truncate px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
                              {col}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </fieldset>

              {/* Run / Clear actions */}
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  data-ocid="cross_reference.run_button"
                  onClick={handleRun}
                  disabled={!canRun || isCrossReferencing}
                  className="w-full"
                >
                  <Play className="size-4 fill-current" aria-hidden="true" />
                  {isCrossReferencing ? "Running…" : "Run Cross-Reference"}
                </Button>
                {hasResults ? (
                  <Button
                    data-ocid="cross_reference.clear_button"
                    variant="outline"
                    onClick={handleClear}
                    disabled={isCrossReferencing}
                    className="w-full"
                  >
                    <X className="size-4" aria-hidden="true" />
                    Clear results
                  </Button>
                ) : null}
                {!canRun && !isCrossReferencing ? (
                  <p className="text-center text-xs text-muted-foreground">
                    {selectedDatasetIds.length < 2
                      ? "Select at least 2 datasets."
                      : selectedColumns.length < 1
                        ? "Select at least 1 column to analyze."
                        : ""}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* ---- Main column: progress + results ---- */}
        <section className="flex min-w-0 flex-col gap-4">
          {/* Progress indicator */}
          {isCrossReferencing ? (
            <Card
              data-ocid="cross_reference.progress"
              className="gap-3 border-primary/30"
            >
              <CardContent className="flex flex-col gap-3 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="relative flex size-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
                    </span>
                    <span className="font-display text-sm font-semibold text-foreground">
                      Aligning datasets by timestamp…
                    </span>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-primary">
                    working
                  </span>
                </div>
                <Progress
                  data-ocid="cross_reference.progress_bar"
                  className="h-1.5"
                />
                <p className="text-xs text-muted-foreground">
                  Detecting threshold-based events on the selected columns and
                  finding moments where conditions across datasets coincide.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* Summary line */}
          {hasRun && !isCrossReferencing && hasResults ? (
            <div
              data-ocid="cross_reference.summary"
              className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5"
            >
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              <p className="text-sm text-foreground">
                <span className="font-mono tabular-nums font-semibold text-primary">
                  {crossReferenceResults.length.toLocaleString()}
                </span>{" "}
                coincident moment
                {crossReferenceResults.length === 1 ? "" : "s"} found across{" "}
                <span className="font-mono tabular-nums font-semibold text-foreground">
                  {selectedDatasetIds.length}
                </span>{" "}
                datasets and{" "}
                <span className="font-mono tabular-nums font-semibold text-foreground">
                  {selectedColumns.length}
                </span>{" "}
                column
                {selectedColumns.length === 1 ? "" : "s"}.
              </p>
            </div>
          ) : null}

          {/* Results table, pre-run empty state, or post-run empty state */}
          {hasResults && !isCrossReferencing ? (
            <CrossReferenceResultsTable results={crossReferenceResults} />
          ) : !isCrossReferencing && !hasRun ? (
            <EmptyState
              icon={GitCompareArrows}
              title="Ready to cross-reference"
              description="Pick two or more datasets on the left and the columns you want to analyze, then run. The engine aligns threshold-based events by timestamp and surfaces moments where conditions on different timeframes line up."
              hint="Original column names are preserved verbatim throughout the analysis."
              actionLabel="Run cross-reference"
              onAction={handleRun}
            />
          ) : !isCrossReferencing && hasRun && !hasResults ? (
            <EmptyState
              icon={GitCompareArrows}
              title="No coincident moments found"
              description="The engine ran but found no timestamps where threshold-based events on the selected columns lined up across the chosen datasets. Try selecting different columns or additional datasets."
              actionLabel="Run cross-reference again"
              onAction={handleRun}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}

function PageHeading() {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <GitCompareArrows
            className="size-4 text-primary"
            aria-hidden="true"
          />
          <h1 className="font-display text-xl font-semibold text-foreground md:text-2xl">
            Cross-Reference
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Align threshold-based events across two or more datasets by timestamp
          and surface moments where conditions on different timeframes line up —
          ranked by correlation strength and confidence.
        </p>
      </div>
    </div>
  );
}

/**
 * Results table for cross-reference coincidences. Rows that share a
 * contributing dataset get the `.correlation-row-linked` accent stripe.
 * Numeric values use font-mono tabular-nums for the terminal aesthetic.
 */
function CrossReferenceResultsTable({
  results,
}: {
  results: CrossReferenceResult[];
}) {
  // Map each dataset id to a stable index so we can stripe rows that share
  // a contributing dataset (visual cue for "linked" coincidences).
  const datasetIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of results) {
      for (const c of r.contributingDatasets) {
        if (!map.has(c.datasetId)) map.set(c.datasetId, map.size);
      }
    }
    return map;
  }, [results]);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardTitle className="font-display text-sm font-semibold uppercase tracking-wide">
          Coincident Moments
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 py-0">
        <div className="overflow-x-auto">
          <table
            data-ocid="cross_reference.results_table"
            className="w-full border-collapse text-sm"
          >
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Aligned Timestamp</th>
                <th className="px-4 py-3 font-medium">Contributing Datasets</th>
                <th className="px-4 py-3 font-medium">Detected Conditions</th>
                <th className="px-4 py-3 text-right font-medium">
                  Correlation
                </th>
                <th className="px-5 py-3 text-right font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, idx) => {
                // Stripe rows where 2+ contributing datasets share the same
                // dataset index bucket (i.e. same dataset appears twice —
                // rare but possible). More commonly, mark rows whose first
                // contributing dataset index is even, to visually group
                // linked coincidences sharing that dataset.
                const firstIdx = datasetIndex.get(
                  r.contributingDatasets[0]?.datasetId ?? "",
                );
                const linked = firstIdx !== undefined && firstIdx % 2 === 1;
                return (
                  <tr
                    key={r.id}
                    data-ocid={`cross_reference.results_table.row.${idx + 1}`}
                    className={cn(
                      "border-b border-border/60 transition-smooth hover:bg-muted/30",
                      linked && "correlation-row-linked",
                    )}
                  >
                    {/* Aligned timestamp */}
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-xs tabular-nums text-foreground">
                      {formatTimestamp(r.timestamp)}
                    </td>
                    {/* Contributing datasets */}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.contributingDatasets.map((c, ci) => (
                          <span
                            key={`${c.datasetId}-${ci}`}
                            data-ocid={`cross_reference.results_table.row.${idx + 1}.dataset.${ci + 1}`}
                            className="column-chip px-1.5 py-0.5 font-mono text-[11px] tabular-nums"
                          >
                            {c.datasetLabel}
                          </span>
                        ))}
                      </div>
                    </td>
                    {/* Detected conditions */}
                    <td className="px-4 py-3">
                      <ul className="flex flex-col gap-1.5">
                        {r.contributingDatasets.map((c, ci) => (
                          <li
                            key={`${c.datasetId}-${ci}`}
                            data-ocid={`cross_reference.results_table.row.${idx + 1}.condition.${ci + 1}`}
                            className="flex flex-col gap-1 text-xs leading-relaxed text-foreground"
                          >
                            <span>
                              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                {c.datasetLabel} · {c.column}:
                              </span>{" "}
                              {c.condition}
                            </span>
                            <ContributionMeta
                              eventOrder={c.eventOrder}
                              reconstructingTimeframe={
                                c.reconstructingTimeframe
                              }
                              rowOcid={`cross_reference.results_table.row.${idx + 1}.condition.${ci + 1}`}
                            />
                          </li>
                        ))}
                      </ul>
                    </td>
                    {/* Correlation strength (0-1) */}
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums text-foreground">
                      {r.correlationStrength.toFixed(3)}
                    </td>
                    {/* Confidence badge */}
                    <td className="px-5 py-3 text-right">
                      <ConfidenceBadge
                        confidence={r.confidence}
                        dataOcid={`cross_reference.results_table.row.${idx + 1}.confidence`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ConfidenceBadge({
  confidence,
  dataOcid,
}: {
  confidence: string;
  dataOcid: string;
}) {
  const normalized = confidence.toLowerCase();
  const tone =
    normalized === "high"
      ? "border-primary/40 bg-primary/10 text-primary"
      : normalized === "medium"
        ? "border-border bg-muted text-foreground"
        : "border-border bg-muted/50 text-muted-foreground";
  return (
    <span
      data-ocid={dataOcid}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] tabular-nums uppercase tracking-wide",
        tone,
      )}
    >
      {confidence}
    </span>
  );
}

/**
 * Per-contribution metadata: the resolved intrabar event order (when the
 * engine could reconstruct it) and the lower timeframe used for that
 * reconstruction. Both are optional — non-intrabar contributions render
 * nothing here so the row stays clean.
 */
function ContributionMeta({
  eventOrder,
  reconstructingTimeframe,
  rowOcid,
}: {
  eventOrder?: string;
  reconstructingTimeframe?: string | null;
  rowOcid: string;
}) {
  const hasOrder = typeof eventOrder === "string" && eventOrder.length > 0;
  const hasTf =
    typeof reconstructingTimeframe === "string" &&
    reconstructingTimeframe.length > 0;
  if (!hasOrder && !hasTf) return null;

  const unknown =
    hasOrder && eventOrder === "order unknown at available resolution";

  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-1">
      {hasOrder ? (
        <span
          data-ocid={`${rowOcid}.event_order`}
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums leading-tight",
            unknown
              ? "border-amber-500/40 bg-amber-500/10 italic text-amber-600 dark:text-amber-400"
              : "border-border bg-muted/60 text-muted-foreground",
          )}
        >
          {unknown ? (
            <>
              <Sparkles
                className="mr-1 size-2.5 opacity-70"
                aria-hidden="true"
              />
              {eventOrder}
            </>
          ) : (
            <>
              <span className="mr-1 text-muted-foreground/70">order:</span>
              {eventOrder}
            </>
          )}
        </span>
      ) : null}
      {hasTf ? (
        <span
          data-ocid={`${rowOcid}.reconstructing_timeframe`}
          className="inline-flex items-center rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums leading-tight text-primary"
        >
          <Layers className="mr-1 size-2.5 opacity-80" aria-hidden="true" />
          {reconstructingTimeframe}
        </span>
      ) : null}
    </div>
  );
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} ${time}`;
}
