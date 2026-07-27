import { Button } from "@/components/ui/button";
import {
  type CandidateSimulationConfig,
  DEFAULT_SIMULATION_CONFIG,
} from "@/lib/candidateSimulation";
import {
  type CandidateSystemOptimization,
  DEFAULT_SYSTEM_OPTIMIZER_CONFIG,
  type OptimizedSystemCandidate,
  optimizeCandidateSystem,
} from "@/lib/candidateSystemOptimizer";
import { buildMultiTimeframeResearchSpace } from "@/lib/multiTimeframe";
import { useEngineStore } from "@/store/engineStore";
import type { Pattern } from "@/types";
import { Gauge, ShieldCheck, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

interface EvaluatedPattern {
  pattern: Pattern;
  optimization: CandidateSystemOptimization;
  candidate: OptimizedSystemCandidate | null;
}

const MAX_PATTERNS_TO_OPTIMIZE = 8;

function researchPriority(pattern: Pattern): number {
  const independentTrades =
    pattern.executionComparison?.nonOverlapping.sampleSize ?? 0;
  return (
    pattern.score +
    Math.log10(pattern.sampleSize + 1) +
    Math.log10(independentTrades + 1) +
    Math.max(0, pattern.liftVsBaseline ?? 0) / 20 -
    pattern.conditions.length * 0.08
  );
}

function baseSimulationConfig(
  pattern: Pattern,
  roundTripCostBps: number,
): CandidateSimulationConfig {
  return {
    ...DEFAULT_SIMULATION_CONFIG,
    maxHoldBars:
      pattern.horizonAnalysis?.recommendedHorizon ?? pattern.horizon ?? 12,
    roundTripCostBps,
    stopMode: "fixed-percent",
    stopPct: Math.max(0.05, pattern.avgMAE || 0.25),
    targetPct: Math.max(0.05, pattern.avgMFE || 0.5),
    nonOverlapping: true,
  };
}

function failureReason(evaluation: EvaluatedPattern): string {
  const candidate = evaluation.optimization.candidates[0];
  if (!candidate) return "too few development trades";
  if (!candidate.walkForwardPassed) {
    return `${candidate.walkForward.profitableFolds}/${candidate.walkForward.folds} profitable walk-forward folds`;
  }
  if (!candidate.sealedHoldoutPassed) {
    return `${candidate.sealedHoldout.trades.length} final trades, ${candidate.sealedHoldout.expectancyR.toFixed(2)}R final expectancy`;
  }
  return "did not clear every safeguard";
}

export function SystemRecommendationPanel({
  patterns,
  onOpenPattern,
}: {
  patterns: Pattern[];
  onOpenPattern: (pattern: Pattern) => void;
}) {
  const datasets = useEngineStore((state) => state.datasets);
  const selectedIds = useEngineStore((state) => state.selectedDatasetIds);
  const featuresByDataset = useEngineStore((state) => state.featuresByDataset);
  const matricesByDataset = useEngineStore(
    (state) => state.featureValuesByDataset,
  );
  const session = useEngineStore((state) => state.marketSessionConfig);
  const roundTripCostBps = useEngineStore(
    (state) => state.discoveryConfig.roundTripCostBps ?? 0,
  );
  const saveSystemOptimization = useEngineStore(
    (state) => state.saveSystemOptimization,
  );
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [evaluations, setEvaluations] = useState<EvaluatedPattern[]>([]);
  const [error, setError] = useState("");

  const shortlist = useMemo(
    () =>
      [...patterns]
        .filter(
          (pattern) =>
            pattern.validationStatus !== "degraded" &&
            pattern.sampleSize >=
              DEFAULT_SYSTEM_OPTIMIZER_CONFIG.minDevelopmentTrades,
        )
        .sort((left, right) => researchPriority(right) - researchPriority(left))
        .slice(0, MAX_PATTERNS_TO_OPTIMIZE),
    [patterns],
  );

  const eligible = evaluations
    .filter(
      (
        evaluation,
      ): evaluation is EvaluatedPattern & {
        candidate: OptimizedSystemCandidate;
      } => evaluation.candidate != null,
    )
    // The sealed holdout remains pass/fail only. Cross-pattern ranking uses
    // information available before that holdout was opened.
    .sort(
      (left, right) =>
        right.candidate.scoreBeforeHoldout - left.candidate.scoreBeforeHoldout,
    );
  const recommended = eligible[0] ?? null;

  const run = async () => {
    if (running || shortlist.length === 0) return;
    setRunning(true);
    setCompleted(0);
    setEvaluations([]);
    setError("");
    const next: EvaluatedPattern[] = [];
    try {
      const selected = datasets.filter((dataset) =>
        selectedIds.includes(dataset.id),
      );
      for (let index = 0; index < shortlist.length; index++) {
        const pattern = shortlist[index];
        const target =
          datasets.find((dataset) => dataset.id === pattern.targetDatasetId) ??
          datasets[0];
        if (!target) continue;
        const space = buildMultiTimeframeResearchSpace(
          target,
          selected.length > 0 ? selected : [target],
          featuresByDataset,
          matricesByDataset,
          target.id,
        );
        const optimization = optimizeCandidateSystem({
          pattern,
          bars: target.bars,
          matrix: space.matrix,
          session,
          baseConfig: baseSimulationConfig(pattern, roundTripCostBps),
          optimizerConfig: DEFAULT_SYSTEM_OPTIMIZER_CONFIG,
        });
        saveSystemOptimization(pattern.id, optimization);
        const candidate =
          optimization.candidates.find((item) => item.eligible) ?? null;
        next.push({ pattern, optimization, candidate });
        setEvaluations([...next]);
        setCompleted(index + 1);
        // Allow progress and cancellation-friendly browser rendering between
        // patterns instead of blocking the page for the entire batch.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The automatic recommendation could not finish.",
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold text-foreground">
            Automatic system recommendation
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Tests the strongest {shortlist.length} non-degraded discoveries with
            costs, non-overlapping trades, walk-forward folds, and a sealed
            final segment. It recommends nothing when nothing survives.
          </p>
        </div>
        <Button disabled={running || shortlist.length === 0} onClick={run}>
          <Gauge className="size-4" aria-hidden="true" />
          {running
            ? `Evaluating ${completed + 1}/${shortlist.length}…`
            : evaluations.length > 0
              ? "Re-run System Search"
              : "Recommend Best System"}
        </Button>
      </div>

      {error ? (
        <p className="mt-3 rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {!running && evaluations.length > 0 && recommended ? (
        <div className="mt-4 rounded border border-primary/30 bg-background p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Best robust research candidate
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">
            {recommended.candidate.recipe.oneSentenceRule}
          </p>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-5">
            <div>
              <span className="text-muted-foreground">Walk-forward</span>
              <div className="font-mono">
                {recommended.candidate.walkForward.profitableFolds}/
                {recommended.candidate.walkForward.folds} folds
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Final trades</span>
              <div className="font-mono">
                {recommended.candidate.sealedHoldout.trades.length}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Final expectancy</span>
              <div className="font-mono">
                {recommended.candidate.sealedHoldout.expectancyR.toFixed(2)}R
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Final profit factor</span>
              <div className="font-mono">
                {recommended.candidate.sealedHoldout.profitFactor?.toFixed(2) ??
                  "—"}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">
                Stress-cost expectancy
              </span>
              <div className="font-mono">
                {recommended.candidate.costStressHoldout.expectancyR.toFixed(2)}
                R
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenPattern(recommended.pattern)}
            >
              Open complete recipe
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Research recommendation only. Confirm it on a later, untouched CSV
              before paper trading.
            </p>
          </div>
        </div>
      ) : null}

      {!running && evaluations.length > 0 && !recommended ? (
        <div className="mt-4 rounded border border-warning/30 bg-warning/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-warning">
            <TriangleAlert className="size-4" aria-hidden="true" />
            No robust system found
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            None of the shortlisted discoveries survived every safeguard. The
            engine will not manufacture a recommendation from weak evidence.
          </p>
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {evaluations.slice(0, 3).map((evaluation) => (
              <li key={evaluation.pattern.id}>
                {evaluation.pattern.label}: {failureReason(evaluation)}.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
