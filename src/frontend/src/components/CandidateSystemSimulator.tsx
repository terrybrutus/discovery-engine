import { GeminiKeyAccess } from "@/components/GeminiKeyAccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type CandidateSimulationConfig,
  DEFAULT_SIMULATION_CONFIG,
  simulateCandidateSystem,
} from "@/lib/candidateSimulation";
import { useGeminiKey } from "@/lib/geminiKeyVault";
import { recommendSimulationWithGemini } from "@/lib/geminiSimulationAdvisor";
import { buildMultiTimeframeResearchSpace } from "@/lib/multiTimeframe";
import { useEngineStore } from "@/store/engineStore";
import type { Pattern } from "@/types";
import { FlaskConical, Play, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

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
                <option value="box-midpoint">Adjusted box midpoint</option>
              </select>
            </div>
            <NumericField
              label="Stop distance %"
              value={config.stopPct}
              step={0.01}
              onChange={(stopPct) => patch({ stopPct })}
            />
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
