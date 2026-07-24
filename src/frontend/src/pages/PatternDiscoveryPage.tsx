import { createActor } from "@/backend";
import type { Backend } from "@/backend";
import { CrossReferenceResultsTable } from "@/components/CrossReferencePage";
import { DatasetSelector } from "@/components/DatasetSelector";
import { DiscoveryControls } from "@/components/DiscoveryControls";
import { EmptyState } from "@/components/EmptyState";
import { PatternDetailModal } from "@/components/PatternDetailModal";
import { PatternResultsTable } from "@/components/PatternResultsTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { computeCrossSymbolCoverage } from "@/lib/discovery";
import { useEngineStore } from "@/store/engineStore";
import type { Feature, FeatureMatrix, Pattern, SavedRunSummary } from "@/types";
import { useActor, useInternetIdentity } from "@caffeineai/core-infrastructure";
import {
  ChevronDown,
  ListFilter,
  Play,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Telescope,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/**
 * Pattern Discovery tab — the core of the engine. Hosts the controls panel,
 * a progress indicator while discovery runs, a ranked results table, and
 * empty states that guide the user when features are missing or no run
 * has happened yet.
 */
export default function PatternDiscoveryPage() {
  const features = useEngineStore((s) => s.features);
  const patterns = useEngineStore((s) => s.patterns);
  const discoveryProgress = useEngineStore((s) => s.discoveryProgress);
  const isComputing = useEngineStore((s) => s.isComputing);
  const completedSteps = useEngineStore((s) => s.completedSteps);
  const setActiveTab = useEngineStore((s) => s.setActiveTab);
  const runDiscoveryAction = useEngineStore((s) => s.runDiscoveryAction);
  const runCrossReferenceAction = useEngineStore(
    (s) => s.runCrossReferenceAction,
  );
  const crossReferenceResults = useEngineStore((s) => s.crossReferenceResults);
  const isCrossReferencing = useEngineStore((s) => s.isCrossReferencing);
  const datasets = useEngineStore((s) => s.datasets);
  const activeDatasetId = useEngineStore((s) => s.activeDatasetId);
  const selectedDatasetIds = useEngineStore((s) => s.selectedDatasetIds);
  const toggleDatasetSelected = useEngineStore((s) => s.toggleDatasetSelected);
  const setActiveDataset = useEngineStore((s) => s.setActiveDataset);
  const featureValues = useEngineStore((s) => s.featureValues);
  const featuresByDataset = useEngineStore((s) => s.featuresByDataset);
  const featureValuesByDataset = useEngineStore(
    (s) => s.featureValuesByDataset,
  );

  // ---- Save / Load Run state ----
  const savedRuns = useEngineStore((s) => s.savedRuns);
  const savedRunsLoading = useEngineStore((s) => s.savedRunsLoading);
  const savedRunsError = useEngineStore((s) => s.savedRunsError);
  const saveRunLoading = useEngineStore((s) => s.saveRunLoading);
  const saveRunError = useEngineStore((s) => s.saveRunError);
  const saveRunAction = useEngineStore((s) => s.saveRunAction);
  const loadSavedRunsAction = useEngineStore((s) => s.loadSavedRunsAction);
  const loadRunAction = useEngineStore((s) => s.loadRunAction);
  const deleteRunAction = useEngineStore((s) => s.deleteRunAction);

  const { actor } = useActor<Backend>(createActor);
  const { identity, login, isLoggingIn } = useInternetIdentity();
  const isSignedIn = identity !== null && actor !== null;

  const [selected, setSelected] = useState<Pattern | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [runName, setRunName] = useState("");
  const [runsOpen, setRunsOpen] = useState(false);
  const [loadingRunId, setLoadingRunId] = useState<number | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const featuresAvailable = features.length > 0;
  const isRunning = discoveryProgress.isRunning || isComputing;
  const hasRun = completedSteps.has("discoveryComplete");
  const hasResults = patterns.length > 0;

  const handleDiscoveryRun = async (): Promise<void> => {
    await runDiscoveryAction();
    if (!useEngineStore.getState().completedSteps.has("discoveryComplete")) {
      return;
    }
    const selectedDatasets = datasets.filter((dataset) =>
      selectedDatasetIds.includes(dataset.id),
    );
    if (selectedDatasets.length < 2) return;

    const columns = Array.from(
      new Set(
        selectedDatasets.flatMap((dataset) =>
          dataset.columns
            .filter(
              (column) => column.type === "numeric" || column.type === "ohlcv",
            )
            .map((column) => column.label),
        ),
      ),
    );
    if (columns.length === 0) return;
    await runCrossReferenceAction({
      datasetIds: selectedDatasets.map((dataset) => dataset.id),
      columns,
    });
  };

  const pct =
    discoveryProgress.total > 0
      ? Math.min(
          100,
          (discoveryProgress.tested / discoveryProgress.total) * 100,
        )
      : 0;

  // ---- Cross-symbol coverage enrichment ----
  // After a discovery run, if 2+ datasets are loaded, re-evaluate each
  // discovered pattern across every selected dataset using the retained
  // per-dataset feature matrices. With one selected dataset, coverage remains
  // dataset-specific.
  const enrichedPatterns = useMemo<Pattern[]>(() => {
    if (patterns.length === 0) return patterns;
    if (datasets.length < 2) return patterns;
    if (!activeDatasetId || !features.length || !featureValues) {
      return patterns;
    }
    const featuresPerDataset = new Map<string, Feature[]>();
    const matrixPerDataset = new Map<string, FeatureMatrix>();
    for (const datasetId of selectedDatasetIds) {
      const datasetFeatures = featuresByDataset[datasetId];
      const datasetMatrix = featureValuesByDataset[datasetId];
      if (datasetFeatures && datasetMatrix) {
        featuresPerDataset.set(datasetId, datasetFeatures);
        matrixPerDataset.set(datasetId, datasetMatrix);
      }
    }
    const minSampleSize =
      useEngineStore.getState().discoveryConfig.minSampleSize;
    const out: Pattern[] = [];
    for (const p of patterns) {
      // Guard computeCrossSymbolCoverage: if it throws (e.g. undefined
      // datasets or malformed coverage data), fall back to the unenriched
      // pattern so the page renders instead of crashing.
      try {
        const coverage = computeCrossSymbolCoverage(
          p,
          datasets.filter((dataset) => selectedDatasetIds.includes(dataset.id)),
          featuresPerDataset,
          matrixPerDataset,
          minSampleSize,
          activeDatasetId,
        );
        out.push(coverage ? { ...p, coverage } : p);
      } catch (err) {
        console.error(
          "[PatternDiscoveryPage] computeCrossSymbolCoverage failed for pattern",
          p.id,
          err,
        );
        out.push(p);
      }
    }
    return out;
  }, [
    patterns,
    datasets,
    activeDatasetId,
    features,
    featureValues,
    featuresByDataset,
    featureValuesByDataset,
    selectedDatasetIds,
  ]);

  // Toast when a run finishes with results.
  const justFinished = !isRunning && hasRun;
  useEffect(() => {
    if (justFinished && hasResults) {
      toast.success(
        `Discovery complete — ${patterns.length.toLocaleString()} patterns found from ${discoveryProgress.tested.toLocaleString()} combinations tested.`,
      );
    } else if (justFinished && !hasResults) {
      toast.info(
        "Discovery finished but no patterns met your filters. Try lowering the minimum win rate or sample size.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justFinished, hasResults, patterns.length, discoveryProgress.tested]);

  // Auto-fetch the saved runs list when the user is signed in.
  useEffect(() => {
    if (isSignedIn && actor !== null) {
      loadSavedRunsAction(actor);
    }
  }, [isSignedIn, actor, loadSavedRunsAction]);

  const handleSave = async (): Promise<void> => {
    if (actor === null) return;
    const name = runName.trim();
    if (name === "") {
      setActionError("Please enter a name for the run.");
      return;
    }
    setActionError(null);
    try {
      await saveRunAction(actor, name);
      setRunName("");
      toast.success(`Run "${name}" saved.`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to save run.",
      );
    }
  };

  const handleLoad = async (run: SavedRunSummary): Promise<void> => {
    if (actor === null) return;
    setActionError(null);
    setLoadingRunId(run.id);
    try {
      await loadRunAction(actor, run.id);
      toast.success(`Loaded run "${run.name}".`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to load run.",
      );
    } finally {
      setLoadingRunId(null);
    }
  };

  const handleDelete = async (run: SavedRunSummary): Promise<void> => {
    if (actor === null) return;
    if (!window.confirm(`Delete run "${run.name}"? This cannot be undone.`)) {
      return;
    }
    setActionError(null);
    setDeletingRunId(run.id);
    try {
      await deleteRunAction(actor, run.id);
      toast.success(`Deleted run "${run.name}".`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to delete run.",
      );
    } finally {
      setDeletingRunId(null);
    }
  };

  const handleRefresh = (): void => {
    if (actor === null) return;
    setActionError(null);
    loadSavedRunsAction(actor);
  };

  const sortedRuns = useMemo<SavedRunSummary[]>(() => {
    return [...savedRuns].sort((a, b) => b.savedAtNs - a.savedAtNs);
  }, [savedRuns]);

  const handleRowClick = (p: Pattern) => {
    setSelected(p);
    setModalOpen(true);
  };

  // ---- Empty: no features generated yet ----
  if (!featuresAvailable) {
    return (
      <div
        data-ocid="page.discovery"
        className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6 md:py-10"
      >
        <PageHeading />
        <EmptyState
          icon={Telescope}
          title="Generate features first"
          description="Pattern discovery searches combinations of features. Head to the Feature Generator tab to build features from your loaded data, then come back here to run discovery."
          hint="The sample dataset is already loaded — generating features takes a second."
          actionLabel="Go to Feature Generator"
          onAction={() => setActiveTab("features")}
        />
      </div>
    );
  }

  return (
    <div
      data-ocid="page.discovery"
      className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10"
    >
      <PageHeading />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]">
        {/* ---- Controls panel ---- */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b border-border px-5 py-4">
              <CardTitle className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide">
                <ListFilter
                  className="size-4 text-primary"
                  aria-hidden="true"
                />
                Discovery Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 py-5">
              <DiscoveryControls
                isRunning={isRunning}
                featuresAvailable={featuresAvailable}
                onRun={() => void handleDiscoveryRun()}
              />
            </CardContent>
          </Card>
        </aside>

        {/* ---- Main column: dataset selector + progress + results ---- */}
        <section className="flex min-w-0 flex-col gap-4">
          {/* Active dataset selector — lets the user switch which dataset
              feeds discovery without leaving the page. */}
          <DatasetSelector
            datasets={datasets}
            activeDatasetId={activeDatasetId}
            onSelect={setActiveDataset}
            selectedDatasetIds={selectedDatasetIds}
            onToggleSelected={toggleDatasetSelected}
          />

          {/* Progress indicator */}
          {isRunning ? (
            <Card
              data-ocid="page.discovery.progress"
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
                      Discovering patterns…
                    </span>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-primary">
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <Progress
                  data-ocid="page.discovery.progress_bar"
                  value={pct}
                  className="h-1.5"
                />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">Tested</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {discoveryProgress.tested.toLocaleString()} /{" "}
                      {discoveryProgress.total.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">Found</span>
                    <span className="font-mono tabular-nums text-primary">
                      {patterns.length.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">
                      Est. remaining
                    </span>
                    <span className="font-mono tabular-nums text-foreground">
                      {formatDuration(discoveryProgress.estimatedRemainingMs)}
                    </span>
                  </div>
                  <div className="flex flex-col col-span-2 sm:col-span-1 min-w-0">
                    <span className="text-muted-foreground">Current</span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {discoveryProgress.current || "Working…"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Summary line */}
          {hasRun && !isRunning ? (
            <div
              data-ocid="page.discovery.summary"
              className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5"
            >
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              <p className="text-sm text-foreground">
                <span className="font-mono tabular-nums font-semibold text-primary">
                  {patterns.length.toLocaleString()}
                </span>{" "}
                pattern{patterns.length === 1 ? "" : "s"} discovered from{" "}
                <span className="font-mono tabular-nums font-semibold text-foreground">
                  {discoveryProgress.tested.toLocaleString()}
                </span>{" "}
                combination{discoveryProgress.tested === 1 ? "" : "s"} tested.
              </p>
            </div>
          ) : null}

          {/* Results table or pre-run empty state */}
          {hasResults ? (
            <PatternResultsTable
              patterns={enrichedPatterns}
              onRowClick={handleRowClick}
            />
          ) : !isRunning && !hasRun ? (
            <EmptyState
              icon={Search}
              title="Ready to discover patterns"
              description="Set your filters on the left, then run discovery. The engine will test thousands of condition combinations, require lift over the matching baseline, and automatically validate the strongest candidates out of sample and across selected datasets."
              hint="Runtime scales with the number of bars, features, and combinations selected."
              actionLabel="Run discovery"
              onAction={() => void handleDiscoveryRun()}
            />
          ) : !isRunning && hasRun && !hasResults ? (
            <EmptyState
              icon={Search}
              title="No patterns matched your filters"
              description="Discovery ran but nothing cleared your minimum win rate and sample size. Try lowering the minimum win rate, reducing the minimum sample size, or enabling more feature categories."
              actionLabel="Run discovery again"
              onAction={() => void handleDiscoveryRun()}
            />
          ) : null}

          {isCrossReferencing ? (
            <Card className="border-primary/30">
              <CardContent className="px-5 py-4 text-sm text-muted-foreground">
                Automatically aligning all selected datasets and numeric fields
                by timestamp…
              </CardContent>
            </Card>
          ) : crossReferenceResults.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-md border border-border bg-card px-4 py-2.5 text-sm">
                <span className="font-mono font-semibold text-primary">
                  {crossReferenceResults.length.toLocaleString()}
                </span>{" "}
                cross-timeframe coincidences found automatically across{" "}
                {selectedDatasetIds.length} selected datasets.
              </div>
              <CrossReferenceResultsTable results={crossReferenceResults} />
            </div>
          ) : null}
        </section>
      </div>

      {/* ---- Save / Load Runs (collapsible) ---- */}
      <Collapsible
        open={runsOpen}
        onOpenChange={setRunsOpen}
        className="mt-6"
        data-ocid="page.discovery.saved-runs"
      >
        <Card className="gap-0 py-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 border-b border-border px-5 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-foreground">
                <Save className="size-4 text-primary" aria-hidden="true" />
                Save / Load Runs
              </span>
              <ChevronDown
                className={`size-4 text-muted-foreground transition-transform ${
                  runsOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-6 px-5 py-5">
              {actionError !== null && (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  <span className="font-mono">{actionError}</span>
                </div>
              )}

              {/* ---- Save Run section ---- */}
              <div className="space-y-3">
                <h3 className="font-display text-sm font-semibold text-foreground">
                  Save current run
                </h3>
                {isSignedIn ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <input
                      type="text"
                      value={runName}
                      onChange={(e) => setRunName(e.target.value)}
                      placeholder="Run name (e.g. ES 5m bullish sweep)"
                      disabled={saveRunLoading}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saveRunLoading || runName.trim() === ""}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saveRunLoading ? (
                        <>
                          <Spinner className="size-4" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <Save className="size-4" aria-hidden="true" />
                          Save
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 rounded-md border border-dashed border-border bg-card/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                      Sign in to save runs. No run data leaves your browser
                      until you authenticate.
                    </p>
                    <button
                      type="button"
                      onClick={login}
                      disabled={isLoggingIn}
                      className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isLoggingIn ? (
                        <>
                          <Spinner className="size-4" />
                          Connecting…
                        </>
                      ) : (
                        "Sign in with Internet Identity"
                      )}
                    </button>
                  </div>
                )}
                {saveRunError !== null && (
                  <p className="font-mono text-xs text-destructive">
                    {saveRunError}
                  </p>
                )}
              </div>

              {/* ---- Load Run section ---- */}
              <div className="space-y-3 border-t border-border pt-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-sm font-semibold text-foreground">
                    Saved runs
                  </h3>
                  {isSignedIn ? (
                    <button
                      type="button"
                      onClick={handleRefresh}
                      disabled={savedRunsLoading}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`size-3.5 ${savedRunsLoading ? "animate-spin" : ""}`}
                        aria-hidden="true"
                      />
                      Refresh
                    </button>
                  ) : null}
                </div>

                {!isSignedIn ? (
                  <p className="text-sm text-muted-foreground">
                    Sign in to view your saved runs.
                  </p>
                ) : savedRunsLoading && sortedRuns.length === 0 ? (
                  <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-card/50 px-4 py-6 text-sm text-muted-foreground">
                    <Spinner className="size-5" />
                    Loading saved runs…
                  </div>
                ) : savedRunsError !== null ? (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  >
                    <span className="font-mono">{savedRunsError}</span>
                  </div>
                ) : sortedRuns.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
                    No saved runs yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {sortedRuns.map((run) => (
                      <li
                        key={run.id}
                        className="flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="truncate font-display text-sm font-semibold text-foreground">
                              {run.name}
                            </span>
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              #{run.id}
                            </span>
                          </div>
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                            <div>
                              <dt className="text-muted-foreground">Saved</dt>
                              <dd>
                                <time
                                  dateTime={new Date(
                                    Number(run.savedAtNs) / 1_000_000,
                                  ).toISOString()}
                                  className="font-mono tabular-nums text-foreground"
                                >
                                  {new Date(
                                    Number(run.savedAtNs) / 1_000_000,
                                  ).toLocaleString()}
                                </time>
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Dataset</dt>
                              <dd className="truncate font-mono text-foreground">
                                {run.datasetName}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">
                                Patterns
                              </dt>
                              <dd className="font-mono tabular-nums text-foreground">
                                {run.patternCount.toLocaleString()}
                              </dd>
                            </div>
                            <div className="col-span-2 sm:col-span-3">
                              <dt className="text-muted-foreground">Config</dt>
                              <dd className="block font-mono text-[11px] leading-relaxed text-muted-foreground">
                                {run.configSummary}
                              </dd>
                            </div>
                          </dl>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleLoad(run)}
                            disabled={loadingRunId === run.id}
                            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {loadingRunId === run.id ? (
                              <>
                                <Spinner className="size-3.5" />
                                Loading…
                              </>
                            ) : (
                              "Load"
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(run)}
                            disabled={deletingRunId === run.id}
                            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingRunId === run.id ? (
                              <>
                                <Spinner className="size-3.5" />
                                Deleting…
                              </>
                            ) : (
                              <>
                                <Trash2
                                  className="size-3.5"
                                  aria-hidden="true"
                                />
                                Delete
                              </>
                            )}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <PatternDetailModal
        pattern={selected}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </div>
  );
}

function PageHeading() {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Play
            className="size-4 fill-primary text-primary"
            aria-hidden="true"
          />
          <h1 className="font-display text-xl font-semibold text-foreground md:text-2xl">
            Pattern Discovery
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Test thousands of condition combinations across your features and
          surface the strongest repeating patterns — ranked by win rate, sample
          size, and confidence.
        </p>
      </div>
    </div>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? ""}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
