import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { datasetIntervalMs } from "@/lib/multiTimeframe";
import {
  type OpeningReversalOptimization,
  openingReversalRecipe,
  optimizeOpeningReversal,
} from "@/lib/openingReversalOptimizer";
import { useEngineStore } from "@/store/engineStore";
import type { Dataset } from "@/types";
import { Download, FlaskConical, ShieldAlert, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function dailySourceFor(execution: Dataset, datasets: Dataset[]) {
  return datasets
    .filter(
      (dataset) =>
        dataset.instrumentKey === execution.instrumentKey &&
        datasetIntervalMs(dataset) >= 20 * 60 * 60_000,
    )
    .sort(
      (left, right) => datasetIntervalMs(left) - datasetIntervalMs(right),
    )[0];
}

function intrabarSourceFor(execution: Dataset, datasets: Dataset[]) {
  return datasets
    .filter(
      (dataset) =>
        dataset.instrumentKey === execution.instrumentKey &&
        datasetIntervalMs(dataset) < datasetIntervalMs(execution),
    )
    .sort(
      (left, right) => datasetIntervalMs(left) - datasetIntervalMs(right),
    )[0];
}

export function OpeningReversalResearchPanel() {
  const datasets = useEngineStore((state) => state.datasets);
  const selectedIds = useEngineStore((state) => state.selectedDatasetIds);
  const session = useEngineStore((state) => state.marketSessionConfig);
  const roundTripCostBps = useEngineStore(
    (state) => state.discoveryConfig.roundTripCostBps ?? 0,
  );
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<OpeningReversalOptimization[]>([]);
  const [error, setError] = useState("");
  const selected = useMemo(
    () => datasets.filter((dataset) => selectedIds.includes(dataset.id)),
    [datasets, selectedIds],
  );
  const eligibleExecutions = useMemo(
    () =>
      selected.filter(
        (dataset) =>
          dataset.hasOHLC &&
          datasetIntervalMs(dataset) === 5 * 60_000 &&
          dailySourceFor(dataset, selected) != null,
      ),
    [selected],
  );

  const run = async () => {
    if (running || eligibleExecutions.length === 0) return;
    setRunning(true);
    setError("");
    const next: OpeningReversalOptimization[] = [];
    try {
      for (const execution of eligibleExecutions) {
        const daily = dailySourceFor(execution, selected);
        if (!daily) continue;
        next.push(
          optimizeOpeningReversal({
            instrumentKey: execution.instrumentKey,
            executionTimeframe: execution.timeframe,
            executionBars: execution.bars,
            intrabarBars: intrabarSourceFor(execution, selected)?.bars,
            dailyBars: daily.bars,
            session: { ...session, openingRangeMinutes: 15 },
            roundTripCostBps,
          }),
        );
        setResults([...next]);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The opening-reversal research run could not finish.",
      );
    } finally {
      setRunning(false);
    }
  };

  const exportResult = (result: OpeningReversalOptimization) => {
    const recipe = openingReversalRecipe(result);
    const markdown = [
      "# Opening Manipulation Reversal Research",
      "",
      `Instrument: ${result.instrumentKey}`,
      `Execution timeframe: ${result.executionTimeframe}`,
      `Sessions examined: ${result.sessionsExamined}`,
      `Parameter sets tested: ${result.candidatesTested}`,
      "",
      result.recommended
        ? "## Safeguard-clearing candidate"
        : "## No safeguard-clearing candidate",
      "",
      recipe,
      "",
      result.recommended
        ? `Development: ${result.recommended.development.trades} trades, ${result.recommended.development.expectancyR.toFixed(2)}R expectancy, ${result.recommended.development.profitFactor?.toFixed(2) ?? "∞"} profit factor.`
        : result.failureSummary,
      result.recommended
        ? `Sealed final segment: ${result.recommended.sealedHoldout.trades} trades, ${result.recommended.sealedHoldout.expectancyR.toFixed(2)}R expectancy, ${result.recommended.sealedHoldout.profitFactor?.toFixed(2) ?? "∞"} profit factor.`
        : "",
      "",
      "## Method",
      "",
      ...result.methodology.map((item) => `- ${item}`),
      "",
      "Research only. Confirm on a later untouched CSV before paper trading.",
    ].join("\n");
    downloadText(
      `${result.instrumentKey}-opening-reversal-research.md`,
      markdown,
      "text/markdown",
    );
  };

  return (
    <Card data-ocid="page.discovery.opening_reversal_lab">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FlaskConical className="size-4 text-primary" aria-hidden="true" />
          Opening manipulation hypothesis lab
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Tests the exact 15-minute setup → 5-minute rejection workflow,
            searches 20–50% of prior completed daily ATR plus objective
            wick/body/close parameters, then checks chronological folds, a
            sealed final segment, doubled costs, and nearby parameter values. It
            does not assume the claim is true.
          </p>
          <Button
            onClick={() => void run()}
            disabled={running || eligibleExecutions.length === 0}
          >
            <FlaskConical className="size-4" aria-hidden="true" />
            {running ? "Testing parameters…" : "Find Robust Parameters"}
          </Button>
        </div>
        {eligibleExecutions.length === 0 ? (
          <p className="mt-3 rounded border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
            Select matching 5-minute and daily OHLC files for at least one
            symbol. Add a matching 1-minute file to resolve target/stop order
            inside ambiguous 5-minute candles.
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Ready:{" "}
            {eligibleExecutions
              .map((dataset) => dataset.label ?? dataset.name)
              .join(", ")}
          </p>
        )}
        {error ? (
          <p className="mt-3 rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {results.map((result) => {
          const candidate = result.recommended;
          return (
            <div
              key={result.instrumentKey}
              className="mt-4 rounded border border-border bg-background p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {candidate ? (
                      <ShieldCheck
                        className="size-4 text-primary"
                        aria-hidden="true"
                      />
                    ) : (
                      <ShieldAlert
                        className="size-4 text-warning"
                        aria-hidden="true"
                      />
                    )}
                    {result.instrumentKey} ·{" "}
                    {candidate
                      ? "Safeguard-clearing candidate"
                      : "No dependable candidate yet"}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {result.sessionsExamined} sessions ·{" "}
                    {result.candidatesTested.toLocaleString()} parameter sets ·
                    final {result.sealedHoldoutPct}% kept sealed
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => exportResult(result)}
                >
                  <Download className="size-4" aria-hidden="true" />
                  Export Recipe
                </Button>
              </div>
              {candidate ? (
                <>
                  <pre className="mt-3 whitespace-pre-wrap rounded bg-muted/40 p-3 font-sans text-xs leading-relaxed">
                    {openingReversalRecipe(result)}
                  </pre>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <span className="text-muted-foreground">ATR trigger</span>
                      <div className="font-mono">
                        {candidate.parameters.manipulationAtrPct}%
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Dev trades</span>
                      <div className="font-mono">
                        {candidate.development.trades}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Walk-forward
                      </span>
                      <div className="font-mono">
                        {candidate.walkForward.profitableFolds}/
                        {candidate.walkForward.folds}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Final trades
                      </span>
                      <div className="font-mono">
                        {candidate.sealedHoldout.trades}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Final exp.</span>
                      <div className="font-mono">
                        {candidate.sealedHoldout.expectancyR.toFixed(2)}R
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Stable neighbors
                      </span>
                      <div className="font-mono">
                        {candidate.stableNeighbors}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-3 rounded bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                  {result.failureSummary}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
