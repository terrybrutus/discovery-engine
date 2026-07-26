import { GeminiKeyAccess } from "@/components/GeminiKeyAccess";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type DiscoveryRecommendation,
  recommendDiscoverySettingsWithGemini,
} from "@/lib/geminiDiscoveryAdvisor";
import { useGeminiKey } from "@/lib/geminiKeyVault";
import { selectFeatureCategories, useEngineStore } from "@/store/engineStore";
import { BrainCircuit, Check, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

export function DiscoveryAdvisor({
  disabled,
}: {
  disabled: boolean;
}) {
  const apiKey = useGeminiKey();
  const datasets = useEngineStore((state) => state.datasets);
  const selectedDatasetIds = useEngineStore(
    (state) => state.selectedDatasetIds,
  );
  const activeDatasetId = useEngineStore((state) => state.activeDatasetId);
  const features = useEngineStore((state) => state.features);
  const featuresByDataset = useEngineStore((state) => state.featuresByDataset);
  const config = useEngineStore((state) => state.discoveryConfig);
  const categories = useEngineStore(selectFeatureCategories);
  const setActiveDataset = useEngineStore((state) => state.setActiveDataset);
  const setTargetMode = useEngineStore((state) => state.setTargetMode);
  const updateConfig = useEngineStore((state) => state.updateConfig);
  const [goal, setGoal] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const [recommendation, setRecommendation] =
    useState<DiscoveryRecommendation | null>(null);
  const selectedFeatures = useMemo(() => {
    const catalogs = selectedDatasetIds
      .map((id) => featuresByDataset[id])
      .filter((catalog): catalog is typeof features => catalog != null);
    return catalogs.length > 0 ? catalogs.flat() : features;
  }, [features, featuresByDataset, selectedDatasetIds]);

  const recommend = async () => {
    setRunning(true);
    setError("");
    setApplied(false);
    try {
      setRecommendation(
        await recommendDiscoverySettingsWithGemini({
          apiKey,
          datasets,
          selectedDatasetIds,
          activeDatasetId,
          categories,
          features: selectedFeatures,
          currentConfig: config,
          researchGoal: goal,
        }),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Settings recommendation failed.",
      );
    } finally {
      setRunning(false);
    }
  };

  const apply = () => {
    if (!recommendation) return;
    if (
      recommendation.targetMode === "single" &&
      recommendation.targetDatasetId
    ) {
      setActiveDataset(recommendation.targetDatasetId);
    }
    setTargetMode(recommendation.targetMode);
    updateConfig({
      enabledCategories: recommendation.enabledCategories,
      minSampleSize: recommendation.minSampleSize,
      minWinRate: recommendation.minWinRate,
      maxDepth: recommendation.maxDepth,
      holdWindowAutoFind: recommendation.holdWindowAutoFind,
      roundTripCostBps: recommendation.roundTripCostBps,
      mfeMaeRatioMode: recommendation.mfeMaeRatioMode,
      mfeMaeRatioEnabled: recommendation.mfeMaeRatioMode !== "off",
      mfeMaeWindow: recommendation.mfeMaeWindow,
      executionView: recommendation.executionView,
    });
    setApplied(true);
  };

  return (
    <section className="rounded-lg border border-primary/25 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <BrainCircuit className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">Recommend my settings</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Gemini reviews only your file names, timeframes, column metadata,
            definitions, and available relationships. It suggests what to
            enable; the engine still performs every calculation.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <GeminiKeyAccess idPrefix="discovery-advisor" compact />
      </div>

      <Input
        className="mt-2"
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        placeholder="Optional: e.g. find 5m entries with daily confluence"
        aria-label="Research goal for Gemini settings recommendation"
        disabled={disabled || running}
      />
      <Button
        type="button"
        className="mt-2 w-full"
        size="sm"
        onClick={() => void recommend()}
        disabled={disabled || running || !apiKey}
      >
        <Sparkles className="size-3.5" />
        {running ? "Reviewing uploads…" : "Analyze uploads & recommend"}
      </Button>

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      {recommendation ? (
        <div className="mt-3 space-y-3 rounded-md border border-border bg-card p-3">
          <p className="text-xs leading-relaxed">{recommendation.summary}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">
              {recommendation.targetMode === "all"
                ? "All selected targets"
                : `Target: ${
                    datasets.find(
                      (dataset) =>
                        dataset.id === recommendation.targetDatasetId,
                    )?.label ?? recommendation.targetDatasetId
                  }`}
            </Badge>
            <Badge variant="secondary">
              sample {recommendation.minSampleSize}
            </Badge>
            <Badge variant="secondary">win {recommendation.minWinRate}%</Badge>
            <Badge variant="secondary">depth {recommendation.maxDepth}</Badge>
            <Badge variant="secondary">
              {recommendation.holdWindowAutoFind
                ? "Auto-find holds"
                : "Fixed hold"}
            </Badge>
            <Badge variant="secondary">
              {recommendation.roundTripCostBps} bps
            </Badge>
          </div>
          <div>
            <div className="text-[11px] font-medium">Relationships</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {recommendation.enabledCategories.join(", ")}
            </p>
          </div>
          {recommendation.reasons.length ? (
            <details>
              <summary className="cursor-pointer text-[11px] font-medium">
                Why Gemini chose these settings
              </summary>
              <ul className="mt-2 space-y-2">
                {recommendation.reasons.map((reason) => (
                  <li
                    key={`${reason.setting}-${reason.recommendation}`}
                    className="text-[11px] leading-relaxed text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">
                      {reason.setting}: {reason.recommendation}.
                    </span>{" "}
                    {reason.why}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {recommendation.cautions.length ? (
            <ul className="list-disc space-y-1 pl-4 text-[11px] text-warning">
              {recommendation.cautions.map((caution) => (
                <li key={caution}>{caution}</li>
              ))}
            </ul>
          ) : null}
          <Button type="button" size="sm" className="w-full" onClick={apply}>
            {applied ? (
              <>
                <Check className="size-3.5" /> Applied
              </>
            ) : (
              "Apply recommended settings"
            )}
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Estimated Gemini request cost: $
            {recommendation.usage.estimatedCostUsd.toFixed(4)}. Review the
            instrument-specific cost estimate before running.
          </p>
        </div>
      ) : null}
    </section>
  );
}
