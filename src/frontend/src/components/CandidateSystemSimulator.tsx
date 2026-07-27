import { GeminiKeyAccess } from "@/components/GeminiKeyAccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type CandidateSimulationConfig,
  DEFAULT_SIMULATION_CONFIG,
  simulateCandidateSystem,
} from "@/lib/candidateSimulation";
import {
  DEFAULT_SYSTEM_OPTIMIZER_CONFIG,
  type SystemOptimizerConfig,
  optimizeCandidateSystem,
} from "@/lib/candidateSystemOptimizer";
import { useGeminiKey } from "@/lib/geminiKeyVault";
import {
  type PlainSystemExplanation,
  explainOptimizedSystemWithGemini,
  recommendSimulationWithGemini,
} from "@/lib/geminiSimulationAdvisor";
import { buildMultiTimeframeResearchSpace } from "@/lib/multiTimeframe";
import { useEngineStore } from "@/store/engineStore";
import type { Pattern } from "@/types";
import { Download, FlaskConical, Gauge, Play, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function NumericField({
  label,
  value,
  onChange,
  min = 0,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export function CandidateSystemSimulator({ pattern }: { pattern: Pattern }) {
  const [expanded, setExpanded] = useState(false);
  const [config, setConfig] = useState<CandidateSimulationConfig>(() => ({
    ...DEFAULT_SIMULATION_CONFIG,
    maxHoldBars:
      pattern.horizonAnalysis?.recommendedHorizon ?? pattern.horizon ?? 12,
  }));
  const [resultRequested, setResultRequested] = useState(false);
  const [advisorMessage, setAdvisorMessage] = useState("");
  const [advisorError, setAdvisorError] = useState("");
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [systemExplanation, setSystemExplanation] =
    useState<PlainSystemExplanation>();
  const [optimizerRunning, setOptimizerRunning] = useState(false);
  const [optimizerConfig, setOptimizerConfig] = useState<SystemOptimizerConfig>(
    DEFAULT_SYSTEM_OPTIMIZER_CONFIG,
  );
  const [localOptimization, setLocalOptimization] = useState<
    ReturnType<typeof optimizeCandidateSystem> | undefined
  >();
  const apiKey = useGeminiKey();
  const datasets = useEngineStore((state) => state.datasets);
  const selectedIds = useEngineStore((state) => state.selectedDatasetIds);
  const featuresByDataset = useEngineStore((state) => state.featuresByDataset);
  const matricesByDataset = useEngineStore(
    (state) => state.featureValuesByDataset,
  );
  const session = useEngineStore((state) => state.marketSessionConfig);
  const discoveryCost = useEngineStore(
    (state) => state.discoveryConfig.roundTripCostBps ?? 0,
  );
  const savedOptimization = useEngineStore(
    (state) => state.systemOptimizations[pattern.id],
  );
  const saveSystemOptimization = useEngineStore(
    (state) => state.saveSystemOptimization,
  );
  const optimization = localOptimization ?? savedOptimization;

  useEffect(() => {
    if (savedOptimization) setExpanded(true);
  }, [savedOptimization]);

  const research = useMemo(() => {
    if (!expanded) return null;
    const target =
      datasets.find((dataset) => dataset.id === pattern.targetDatasetId) ??
      datasets[0];
    if (!target || target.bars.length === 0) return null;
    const selected = datasets.filter((dataset) =>
      selectedIds.includes(dataset.id),
    );
    return {
      target,
      space: buildMultiTimeframeResearchSpace(
        target,
        selected.length > 0 ? selected : [target],
        featuresByDataset,
        matricesByDataset,
        target.id,
      ),
    };
  }, [
    datasets,
    expanded,
    featuresByDataset,
    matricesByDataset,
    pattern.targetDatasetId,
    selectedIds,
  ]);

  const result = useMemo(() => {
    if (!resultRequested || !research) return null;
    return simulateCandidateSystem({
      pattern,
      bars: research.target.bars,
      matrix: research.space.matrix,
      config,
      session,
    });
  }, [config, pattern, research, resultRequested, session]);

  if (!expanded) {
    return (
      <Button variant="outline" onClick={() => setExpanded(true)}>
        <FlaskConical className="size-4" aria-hidden="true" />
        Simulate as Candidate System
      </Button>
    );
  }

  const patch = (value: Partial<CandidateSimulationConfig>) => {
    setConfig((current) => ({ ...current, ...value }));
    setResultRequested(false);
  };

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div>
        <h3 className="font-display text-sm font-semibold text-foreground">
          Candidate-system simulator
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Turn this discovered event into explicit entry, exit, cost, and risk
          assumptions. This is a deterministic replay over your uploaded bars;
          it does not change discovery or claim the pattern is a strategy.
        </p>
      </div>

      {!research ? (
        <div className="mt-4 rounded border border-warning/30 bg-warning/5 p-3 text-xs">
          Re-upload the source datasets to simulate this saved result. Saved
          research preserves findings and settings, but deliberately does not
          store raw market rows on-chain.
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Entry rule</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={config.entryMode}
                onChange={(event) =>
                  patch({
                    entryMode: event.target
                      .value as CandidateSimulationConfig["entryMode"],
                  })
                }
              >
                <option value="next-open">Next bar open</option>
                <option value="signal-close">Signal bar close</option>
                <option value="box-boundary-limit">
                  Adjusted box boundary limit
                </option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Stop rule</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={config.stopMode ?? "fixed-percent"}
                onChange={(event) =>
                  patch({
                    stopMode: event.target
                      .value as CandidateSimulationConfig["stopMode"],
                  })
                }
              >
                <option value="fixed-percent">Fixed protective %</option>
                <option value="atr-multiple">ATR-based protective stop</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Target rule</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={config.targetMode}
                onChange={(event) =>
                  patch({
                    targetMode: event.target
                      .value as CandidateSimulationConfig["targetMode"],
                  })
                }
              >
                <option value="risk-multiple">Reward:risk multiple</option>
                <option value="fixed-percent">Fixed favorable %</option>
                <option value="atr-multiple">ATR-based target</option>
                <option value="time-only">Time exit only</option>
                <option value="box-midpoint">Adjusted box midpoint</option>
              </select>
            </div>
            {(config.stopMode ?? "fixed-percent") === "atr-multiple" ? (
              <NumericField
                label="Stop ATR multiple"
                value={config.stopAtrMultiple ?? 1}
                step={0.1}
                onChange={(stopAtrMultiple) => patch({ stopAtrMultiple })}
              />
            ) : (
              <NumericField
                label="Stop distance %"
                value={config.stopPct}
                step={0.01}
                onChange={(stopPct) => patch({ stopPct })}
              />
            )}
            {config.targetMode === "risk-multiple" ? (
              <NumericField
                label="Reward:risk target"
                value={config.rewardRiskMultiple}
                step={0.1}
                onChange={(rewardRiskMultiple) => patch({ rewardRiskMultiple })}
              />
            ) : config.targetMode === "fixed-percent" ? (
              <NumericField
                label="Target distance %"
                value={config.targetPct}
                step={0.01}
                onChange={(targetPct) => patch({ targetPct })}
              />
            ) : config.targetMode === "atr-multiple" ? (
              <NumericField
                label="Target ATR multiple"
                value={config.targetAtrMultiple ?? 2}
                step={0.1}
                onChange={(targetAtrMultiple) => patch({ targetAtrMultiple })}
              />
            ) : config.targetMode === "time-only" ? (
              <div className="rounded border border-border bg-background p-3 text-xs text-muted-foreground">
                No profit target. The protective stop remains active and any
                surviving trade exits after the selected hold.
              </div>
            ) : (
              <NumericField
                label="Limit valid for bars"
                value={config.entryExpiryBars}
                min={1}
                step={1}
                onChange={(entryExpiryBars) => patch({ entryExpiryBars })}
              />
            )}
            <NumericField
              label="Maximum hold bars"
              value={config.maxHoldBars}
              min={1}
              step={1}
              onChange={(maxHoldBars) => patch({ maxHoldBars })}
            />
            <NumericField
              label="Round-trip cost (bps)"
              value={config.roundTripCostBps}
              step={0.5}
              onChange={(roundTripCostBps) => patch({ roundTripCostBps })}
            />
            <NumericField
              label="Starting capital"
              value={config.startingCapital}
              min={1}
              step={1000}
              onChange={(startingCapital) => patch({ startingCapital })}
            />
            <NumericField
              label="Risk per trade %"
              value={config.riskPerTradePct}
              min={0.01}
              step={0.1}
              onChange={(riskPerTradePct) => patch({ riskPerTradePct })}
            />
          </div>

          <label className="mt-4 flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={config.nonOverlapping}
              onChange={(event) =>
                patch({ nonOverlapping: event.target.checked })
              }
            />
            One position at a time; ignore signals until the active trade exits
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => setResultRequested(true)}>
              <Play className="size-4" aria-hidden="true" />
              Run Simulation
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                patch({
                  maxHoldBars:
                    pattern.horizonAnalysis?.recommendedHorizon ??
                    pattern.horizon,
                  roundTripCostBps: discoveryCost,
                  stopPct: Math.max(0.05, pattern.avgMAE || 0.25),
                  targetPct: Math.max(0.05, pattern.avgMFE || 0.5),
                });
              }}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Use Pattern-Informed Starting Values
            </Button>
          </div>

          {result ? (
            <div className="mt-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Executed trades", result.trades.length.toLocaleString()],
                  ["Win rate", `${result.winRate.toFixed(1)}%`],
                  ["Expectancy / trade", money(result.expectancy)],
                  ["Expectancy", `${result.expectancyR.toFixed(2)}R`],
                  [
                    "Profit factor",
                    result.profitFactor == null
                      ? "—"
                      : result.profitFactor.toFixed(2),
                  ],
                  ["Net profit", money(result.netProfit)],
                  [
                    "Maximum drawdown",
                    `${money(result.maxDrawdown)} · ${result.maxDrawdownPct.toFixed(1)}%`,
                  ],
                  ["Worst daily drawdown", money(result.maxDailyDrawdown)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded border border-border bg-background p-3"
                  >
                    <div className="font-mono text-sm font-semibold">
                      {value}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {label}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                {result.matchingSignals.toLocaleString()} statistical signals;{" "}
                {result.skippedOverlapping.toLocaleString()} skipped while a
                trade was open; {result.skippedUnfilled.toLocaleString()} limits
                or box targets were not executable. Same-bar target/stop
                collisions ({result.ambiguous}) are conservatively charged as
                stops unless lower-timeframe bars resolve their order.
              </p>
            </div>
          ) : null}

          <div className="mt-5 border-t border-border pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-display text-sm font-semibold text-foreground">
                  Find a robust trading system
                </h4>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                  Tests a deliberately small set of normal entries, stops,
                  targets, and holds. It ranks them before opening the final{" "}
                  {optimizerConfig.sealedHoldoutPct}% of history, requires
                  positive chronological folds, and gives simpler rules an
                  advantage.
                </p>
              </div>
              <Button
                disabled={optimizerRunning}
                onClick={() => {
                  if (!research) return;
                  setOptimizerRunning(true);
                  window.setTimeout(() => {
                    try {
                      const next = optimizeCandidateSystem({
                        pattern,
                        bars: research.target.bars,
                        matrix: research.space.matrix,
                        session,
                        baseConfig: {
                          ...config,
                          roundTripCostBps: config.roundTripCostBps,
                        },
                        optimizerConfig,
                      });
                      setLocalOptimization(next);
                      saveSystemOptimization(pattern.id, next);
                    } finally {
                      setOptimizerRunning(false);
                    }
                  }, 20);
                }}
              >
                <Gauge className="size-4" aria-hidden="true" />
                {optimizerRunning
                  ? "Testing candidate systems…"
                  : optimization
                    ? "Re-run Robustness Search"
                    : "Find Robust Trading Systems"}
              </Button>
            </div>

            <details className="mt-3 rounded border border-border bg-background/70 p-3">
              <summary className="cursor-pointer text-xs font-medium text-foreground">
                Research safeguards and limits
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <NumericField
                  label="Final sealed history %"
                  value={optimizerConfig.sealedHoldoutPct}
                  min={10}
                  step={5}
                  onChange={(sealedHoldoutPct) =>
                    setOptimizerConfig((current) => ({
                      ...current,
                      sealedHoldoutPct,
                    }))
                  }
                />
                <NumericField
                  label="Minimum final expectancy (R)"
                  value={optimizerConfig.minHoldoutExpectancyR}
                  min={0}
                  step={0.05}
                  onChange={(minHoldoutExpectancyR) =>
                    setOptimizerConfig((current) => ({
                      ...current,
                      minHoldoutExpectancyR,
                    }))
                  }
                />
                <NumericField
                  label="Minimum final profit factor"
                  value={optimizerConfig.minHoldoutProfitFactor}
                  min={1}
                  step={0.1}
                  onChange={(minHoldoutProfitFactor) =>
                    setOptimizerConfig((current) => ({
                      ...current,
                      minHoldoutProfitFactor,
                    }))
                  }
                />
                <NumericField
                  label="Cost stress multiplier"
                  value={optimizerConfig.costStressMultiplier}
                  min={1}
                  step={0.5}
                  onChange={(costStressMultiplier) =>
                    setOptimizerConfig((current) => ({
                      ...current,
                      costStressMultiplier,
                    }))
                  }
                />
                <NumericField
                  label="Walk-forward folds"
                  value={optimizerConfig.walkForwardFolds}
                  min={2}
                  step={1}
                  onChange={(walkForwardFolds) =>
                    setOptimizerConfig((current) => ({
                      ...current,
                      walkForwardFolds,
                    }))
                  }
                />
                <NumericField
                  label="Minimum development trades"
                  value={optimizerConfig.minDevelopmentTrades}
                  min={5}
                  step={5}
                  onChange={(minDevelopmentTrades) =>
                    setOptimizerConfig((current) => ({
                      ...current,
                      minDevelopmentTrades,
                    }))
                  }
                />
                <NumericField
                  label="Minimum final-test trades"
                  value={optimizerConfig.minHoldoutTrades}
                  min={1}
                  step={1}
                  onChange={(minHoldoutTrades) =>
                    setOptimizerConfig((current) => ({
                      ...current,
                      minHoldoutTrades,
                    }))
                  }
                />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Re-running after viewing the final segment weakens its status as
                a sealed test. Lock a chosen recipe, then upload later data for
                the strongest confirmation.
              </p>
            </details>

            {optimization ? (
              <>
                <OptimizationResults optimization={optimization} />
                {optimization.recommendedCandidateId ? (
                  <div className="mt-4 rounded border border-border bg-background p-3">
                    <Button
                      variant="outline"
                      disabled={!apiKey || advisorLoading}
                      onClick={async () => {
                        setAdvisorLoading(true);
                        setAdvisorError("");
                        try {
                          setSystemExplanation(
                            await explainOptimizedSystemWithGemini({
                              apiKey,
                              pattern,
                              optimization,
                            }),
                          );
                        } catch (error) {
                          setAdvisorError(
                            error instanceof Error
                              ? error.message
                              : "Gemini system explanation failed.",
                          );
                        } finally {
                          setAdvisorLoading(false);
                        }
                      }}
                    >
                      <Sparkles className="size-4" aria-hidden="true" />
                      Explain Winning System in Plain Language
                    </Button>
                    {systemExplanation ? (
                      <div className="mt-3 space-y-3 text-xs">
                        <h5 className="text-sm font-semibold">
                          {systemExplanation.title}
                        </h5>
                        <ol className="list-decimal space-y-1 pl-5">
                          {systemExplanation.plainSteps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                        <details>
                          <summary className="cursor-pointer font-medium">
                            Why it passed and Pine Script build brief
                          </summary>
                          <p className="mt-2 leading-relaxed text-muted-foreground">
                            {systemExplanation.whyItPassed}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                            {systemExplanation.pineBuildBrief}
                          </p>
                          {systemExplanation.warnings.length ? (
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-warning">
                              {systemExplanation.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                            </ul>
                          ) : null}
                        </details>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-xs text-muted-foreground">
              Optional: connect Gemini to recommend assumptions from the stored
              recipe. Gemini receives metadata—not your rows—and never
              calculates the results.
            </p>
            <GeminiKeyAccess idPrefix={`simulator-${pattern.id}`} compact />
            <Button
              className="mt-2"
              variant="outline"
              disabled={!apiKey || advisorLoading}
              onClick={async () => {
                setAdvisorLoading(true);
                setAdvisorError("");
                try {
                  const recommendation = await recommendSimulationWithGemini({
                    apiKey,
                    pattern,
                    currentConfig: config,
                  });
                  setConfig(recommendation.config);
                  setResultRequested(false);
                  setAdvisorMessage(
                    [
                      recommendation.summary,
                      ...recommendation.cautions.map(
                        (caution) => `Caution: ${caution}`,
                      ),
                    ].join(" "),
                  );
                } catch (error) {
                  setAdvisorError(
                    error instanceof Error
                      ? error.message
                      : "Gemini recommendation failed.",
                  );
                } finally {
                  setAdvisorLoading(false);
                }
              }}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              {advisorLoading
                ? "Asking Gemini…"
                : "Recommend Simulation Assumptions"}
            </Button>
            {advisorMessage ? (
              <p className="mt-2 text-xs leading-relaxed text-foreground">
                {advisorMessage}
              </p>
            ) : null}
            {advisorError ? (
              <p className="mt-2 text-xs text-destructive">{advisorError}</p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function downloadRecipe(
  optimization: ReturnType<typeof optimizeCandidateSystem>,
): void {
  const recommended = optimization.candidates.find(
    (candidate) => candidate.id === optimization.recommendedCandidateId,
  );
  if (!recommended) return;
  const blob = new Blob(
    [
      JSON.stringify(
        {
          optimization,
          executableRecipe: recommended.recipe.machineReadable,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${optimization.patternId}-executable-system.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function OptimizationResults({
  optimization,
}: {
  optimization: ReturnType<typeof optimizeCandidateSystem>;
}) {
  const recommended = optimization.candidates.find(
    (candidate) => candidate.id === optimization.recommendedCandidateId,
  );
  return (
    <div className="mt-4 space-y-4">
      <div
        className={
          recommended
            ? "rounded border border-primary/30 bg-primary/5 p-4"
            : "rounded border border-warning/30 bg-warning/5 p-4"
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {recommended
                ? "Robust research candidate"
                : "No candidate cleared every safeguard"}
            </div>
            <p className="mt-1 text-sm font-medium text-foreground">
              {recommended
                ? recommended.recipe.oneSentenceRule
                : "Keep the discoveries as research ideas; do not force a trading system from this pattern yet."}
            </p>
          </div>
          {recommended ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadRecipe(optimization)}
            >
              <Download className="size-3.5" aria-hidden="true" />
              Export Exact Recipe
            </Button>
          ) : null}
        </div>
        {recommended ? (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-foreground">
            {recommended.recipe.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {optimization.integrityWarning}
        </p>
      </div>

      <div className="overflow-x-auto rounded border border-border bg-background">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left">Development rank</th>
              <th className="px-2 py-2 text-left">Execution</th>
              <th className="px-2 py-2 text-right">Dev trades</th>
              <th className="px-2 py-2 text-right">Dev exp.</th>
              <th className="px-2 py-2 text-right">WF folds</th>
              <th className="px-2 py-2 text-right">Final trades</th>
              <th className="px-2 py-2 text-right">Final exp.</th>
              <th className="px-2 py-2 text-right">Final PF</th>
              <th className="px-2 py-2 text-right">Stress-cost exp.</th>
              <th className="px-2 py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {optimization.candidates.slice(0, 8).map((candidate) => (
              <tr key={candidate.id} className="border-t border-border">
                <td className="px-2 py-2 font-mono">
                  {candidate.developmentRank}
                  {candidate.labels.length
                    ? ` · ${candidate.labels.join(", ")}`
                    : ""}
                </td>
                <td className="px-2 py-2">
                  {candidate.config.entryMode} · {candidate.config.targetMode} ·{" "}
                  {candidate.config.maxHoldBars} bars
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {candidate.development.trades.length}
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {candidate.development.expectancyR.toFixed(2)}R
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {candidate.walkForward.profitableFolds}/
                  {candidate.walkForward.folds}
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {candidate.sealedHoldout.trades.length}
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {candidate.sealedHoldout.expectancyR.toFixed(2)}R
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {candidate.sealedHoldout.profitFactor?.toFixed(2) ?? "—"}
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {candidate.costStressHoldout
                    ? `${candidate.costStressHoldout.expectancyR.toFixed(2)}R`
                    : "—"}
                </td>
                <td
                  className={
                    candidate.eligible
                      ? "px-2 py-2 text-right font-semibold text-primary"
                      : "px-2 py-2 text-right text-muted-foreground"
                  }
                >
                  {candidate.eligible ? "Robust candidate" : "Rejected"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Tested {optimization.candidatesTested} constrained configurations. The
        final holdout never changes the development rank shown above.
      </p>
    </div>
  );
}
