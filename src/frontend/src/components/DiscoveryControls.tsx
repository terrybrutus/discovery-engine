import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  HOLD_WINDOW_CANDIDATES,
  isFeatureEligibleForDiscovery,
  runDiscovery,
} from "@/lib/discovery";
import type { FeatureOverride, FeatureOverrides } from "@/lib/features";
import { MULTI_TIMEFRAME_CATEGORY } from "@/lib/researchCategories";
import { cn } from "@/lib/utils";
import { selectFeatureCategories, useEngineStore } from "@/store/engineStore";
import type { DiscoveryConfig, FeatureCategory } from "@/types";
import {
  ArrowRight,
  Filter,
  Play,
  RotateCcw,
  Sparkles,
  Square,
} from "lucide-react";
import { useMemo, useState } from "react";

// Depth options extend to 6 so deeper feature stacking is available beyond
// the previous cap of 4. The depths are split into two labeled ranges:
//   - Light (2-4): fewer conditions, faster, broader patterns
//   - Deep  (5-6): more conditions, sharper but exponentially more combos
// Each entry carries its range label so the UI can group them visually.
const DEPTHS = [2, 3, 4, 5, 6] as const;
type DepthRange = "light" | "deep";
interface DepthOption {
  value: number;
  range: DepthRange;
  label: string;
}
const DEPTH_OPTIONS: DepthOption[] = DEPTHS.map((d) => ({
  value: d,
  range: d <= 4 ? "light" : "deep",
  label:
    d === 2
      ? "Simple"
      : d === 3
        ? "Balanced"
        : d === 4
          ? "Deep"
          : d === 5
            ? "Deeper"
            : "Maximal",
}));

const LENS_DESCRIPTIONS: Record<string, string> = {
  "Market Structure": "Pivots, HH/HL/LH/LL, BOS, and liquidity sweeps",
  Sequences: "Ordered sweep/reclaim, break/retest, and swing progressions",
  "Levels & Sessions": "Previous-day levels, session relationships, and boxes",
  Bollinger: "%B, relative bandwidth, squeeze, and expansion context",
  "Imported Signals": "Semantically transformed uploaded indicators and levels",
  "Multi-Timeframe": "Latest causally completed state from every selected file",
};

/**
 * MFE/MAE ratio filter mode — three-mode segmented control.
 * Mirrors DiscoveryConfig.mfeMaeRatioMode. The selected mode is the single
 * source of truth for ratio filtering; the legacy mfeMaeRatioEnabled flag is
 * kept in sync for backward compatibility with persisted runs.
 */
type MfeMaeMode = "off" | "positive" | "auto";
const MFE_MAE_MODES: ReadonlyArray<{
  value: MfeMaeMode;
  label: string;
  hint: string;
}> = [
  { value: "off", label: "Off", hint: "No ratio filter" },
  { value: "positive", label: "Positive-only", hint: "Ratio > threshold" },
  { value: "auto", label: "Auto-find", hint: "Grid-search threshold" },
];

interface DiscoveryControlsProps {
  /** True while a discovery run is in progress — disables inputs, swaps Run for Cancel. */
  isRunning: boolean;
  /** When no features have been generated yet, controls are disabled with a hint. */
  featuresAvailable: boolean;
  /** Optional page-level runner used when discovery includes extra analysis. */
  onRun?: () => void;
}

/** Result of a Max Data probe — the loosest viable filter settings. */
interface MaxDataSuggestion {
  minWinRate: number;
  minSampleSize: number;
  maxDepth: number;
  patternCount: number;
}

export function DiscoveryControls({
  isRunning,
  featuresAvailable,
  onRun,
}: DiscoveryControlsProps) {
  const config = useEngineStore((s) => s.discoveryConfig);
  const updateConfig = useEngineStore((s) => s.updateConfig);
  const runDiscoveryAction = useEngineStore((s) => s.runDiscoveryAction);
  const cancelDiscovery = useEngineStore((s) => s.cancelDiscovery);
  const dataset = useEngineStore((s) => s.dataset);
  const features = useEngineStore((s) => s.features);
  const featureValues = useEngineStore((s) => s.featureValues);
  const featureOverrides = useEngineStore((s) => s.featureOverrides);
  const setFeatureOverride = useEngineStore((s) => s.setFeatureOverride);
  const clearFeatureOverride = useEngineStore((s) => s.clearFeatureOverride);
  const targetMode = useEngineStore((s) => s.targetMode);
  const datasets = useEngineStore((s) => s.datasets);
  const selectedDatasetIds = useEngineStore((s) => s.selectedDatasetIds);
  const activeDatasetId = useEngineStore((s) => s.activeDatasetId);

  // Categories exist only when the uploaded schema supports them.
  const categories = useEngineStore(selectFeatureCategories);
  const multiSourceRequired =
    datasets.filter((item) =>
      targetMode === "all"
        ? selectedDatasetIds.includes(item.id)
        : item.id === activeDatasetId || selectedDatasetIds.includes(item.id),
    ).length > 1;

  const disabled = isRunning || !featuresAvailable;

  // Resolve the effective MFE/MAE mode. `mfeMaeRatioMode` takes precedence
  // when set; otherwise fall back to the legacy `mfeMaeRatioEnabled` flag
  // (true → "positive", false → "off") for backward compatibility.
  const mfeMaeMode: MfeMaeMode = config.mfeMaeRatioMode
    ? config.mfeMaeRatioMode
    : config.mfeMaeRatioEnabled
      ? "positive"
      : "off";

  const setMfeMaeMode = (mode: MfeMaeMode) => {
    // Keep both the new mode and the legacy flag in sync so persisted runs
    // and the simplified backend config shape stay consistent.
    updateConfig({
      mfeMaeRatioMode: mode,
      mfeMaeRatioEnabled: mode !== "off",
    });
  };

  // Numeric features only — categorical features have buckets, not ranges,
  // so manual range overrides only apply to numeric features.
  const numericFeatures = useMemo(
    () =>
      features.filter(
        (feature) =>
          feature.type === "numeric" && isFeatureEligibleForDiscovery(feature),
      ),
    [features],
  );

  // Max Data probe state.
  const [maxDataScanning, setMaxDataScanning] = useState(false);
  const [maxDataSuggestion, setMaxDataSuggestion] =
    useState<MaxDataSuggestion | null>(null);
  const [maxDataError, setMaxDataError] = useState<string | null>(null);

  const toggleCategory = (cat: FeatureCategory, on: boolean) => {
    if (cat === MULTI_TIMEFRAME_CATEGORY && multiSourceRequired && !on) return;
    const next = on
      ? [...config.enabledCategories, cat]
      : config.enabledCategories.filter((c) => c !== cat);
    updateConfig({ enabledCategories: next });
  };

  const enabledCount = categories.filter(
    (category) =>
      config.enabledCategories.includes(category) ||
      (category === MULTI_TIMEFRAME_CATEGORY && multiSourceRequired),
  ).length;

  // Split the depth options into Light (2-4) and Deep (5-6) groups for
  // clear labeling. The two groups render side by side with a visual divider
  // so users can tell lighter stacking apart from deeper stacking.
  const lightOptions = useMemo(
    () => DEPTH_OPTIONS.filter((o) => o.range === "light"),
    [],
  );
  const deepOptions = useMemo(
    () => DEPTH_OPTIONS.filter((o) => o.range === "deep"),
    [],
  );

  const renderDepthButton = (opt: DepthOption) => {
    const active = config.maxDepth === opt.value;
    return (
      <button
        key={opt.value}
        type="button"
        aria-checked={active}
        data-ocid={`discovery_controls.depth.${opt.value}`}
        disabled={disabled}
        onClick={() => updateConfig({ maxDepth: opt.value })}
        className={cn(
          "flex flex-col items-center gap-0.5 rounded-md border px-3 py-2.5 text-sm transition-smooth outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          active
            ? opt.range === "deep"
              ? "border-primary bg-primary/15 text-primary"
              : "border-primary bg-primary/10 text-primary"
            : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-border/80",
          disabled && "cursor-not-allowed",
        )}
      >
        <span className="font-mono text-lg tabular-nums leading-none">
          {opt.value}
        </span>
        <span className="text-[10px] leading-tight">{opt.label}</span>
      </button>
    );
  };

  /**
   * Max Data probe: scan a few candidate configs from loosest to tighter and
   * find the floor that still returns at least one pattern. Uses a small
   * maxCombinations cap and shallow depths so the probe stays quick. Reports
   * the loosest viable settings inline; the user can Apply them.
   */
  const runMaxDataProbe = async () => {
    if (!dataset || !features.length || !featureValues) {
      setMaxDataError("Load a dataset and generate features first.");
      return;
    }
    setMaxDataScanning(true);
    setMaxDataError(null);
    setMaxDataSuggestion(null);
    try {
      // Candidate grid: walk win rate from 50 up, sample size from 10 up, and
      // depth from 2 up. We probe the loosest end first and stop at the first
      // config that yields >= 1 pattern — that is the floor.
      const winRateCandidates = [50, 52, 55, 60];
      const sampleCandidates = [10, 15, 20, 30];
      const depthCandidates = [2, 3, 4];
      const probeConfig = (override: Partial<DiscoveryConfig>) =>
        runDiscovery(
          dataset.bars,
          features,
          featureValues,
          {
            ...config,
            maxCombinations: 2000,
            mfeMaeRatioEnabled: false,
            ...override,
          },
          () => {},
          () => false,
        );

      let found: MaxDataSuggestion | null = null;
      // Iterate from loosest (low win rate, low sample, low depth) upward.
      outer: for (const wr of winRateCandidates) {
        for (const ss of sampleCandidates) {
          for (const d of depthCandidates) {
            const patterns = await probeConfig({
              minWinRate: wr,
              minSampleSize: ss,
              maxDepth: d,
            });
            if (patterns.length > 0) {
              found = {
                minWinRate: wr,
                minSampleSize: ss,
                maxDepth: d,
                patternCount: patterns.length,
              };
              break outer;
            }
          }
        }
      }
      if (!found) {
        setMaxDataError(
          "No patterns found even at the loosest settings. Try a larger dataset or more features.",
        );
      } else {
        setMaxDataSuggestion(found);
      }
    } catch (e) {
      setMaxDataError(
        e instanceof Error ? e.message : "Max Data scan failed unexpectedly.",
      );
    } finally {
      setMaxDataScanning(false);
    }
  };

  const applyMaxData = () => {
    if (!maxDataSuggestion) return;
    updateConfig({
      minWinRate: maxDataSuggestion.minWinRate,
      minSampleSize: maxDataSuggestion.minSampleSize,
      maxDepth: maxDataSuggestion.maxDepth,
    });
  };

  return (
    <div data-ocid="discovery_controls" className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Filter className="size-4 text-primary" aria-hidden="true" />
        <h2 className="font-display text-sm font-semibold tracking-wide text-foreground uppercase">
          Discovery Settings
        </h2>
      </div>

      {/* ---- Min sample size ---- */}
      <div className={cn("flex flex-col gap-2", disabled && "opacity-60")}>
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="min-sample-slider"
            className="text-sm font-medium text-foreground"
          >
            Minimum sample size
          </label>
          <span className="font-mono text-sm tabular-nums text-primary">
            {config.minSampleSize} bars
          </span>
        </div>
        <Slider
          id="min-sample-slider"
          data-ocid="discovery_controls.min_sample_slider"
          min={30}
          max={500}
          step={5}
          value={[config.minSampleSize]}
          disabled={disabled}
          onValueChange={(v) => updateConfig({ minSampleSize: v[0] ?? 30 })}
          aria-label="Minimum sample size in bars"
        />
        <p className="text-xs text-muted-foreground">
          Patterns must match at least this many bars to be reported. Higher
          means fewer but more reliable results.
        </p>
      </div>

      <Separator />

      {/* ---- Min win rate ---- */}
      <div className={cn("flex flex-col gap-2", disabled && "opacity-60")}>
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="min-winrate-slider"
            className="text-sm font-medium text-foreground"
          >
            Minimum win rate
          </label>
          <span className="font-mono text-sm tabular-nums text-primary">
            {config.minWinRate}%
          </span>
        </div>
        <Slider
          id="min-winrate-slider"
          data-ocid="discovery_controls.min_winrate_slider"
          min={50}
          max={80}
          step={1}
          value={[config.minWinRate]}
          disabled={disabled}
          onValueChange={(v) => updateConfig({ minWinRate: v[0] ?? 50 })}
          aria-label="Minimum win rate percentage"
        />
        <p className="text-xs text-muted-foreground">
          Only keep patterns that win at least this often in the dominant
          direction. 55% is a balanced starting point.
        </p>
      </div>

      <Separator />

      {/* ---- Hold period (horizon) ---- */}
      <div className={cn("flex flex-col gap-2", disabled && "opacity-60")}>
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="hold-period-slider"
            className="text-sm font-medium text-foreground"
          >
            Hold period (bars)
          </label>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm tabular-nums text-primary">
              {config.horizon} bars
            </span>
            <label
              htmlFor="hold-window-autofind-switch"
              className="flex cursor-pointer items-center gap-1.5"
            >
              <span className="text-xs text-muted-foreground">Auto-find</span>
              <Switch
                id="hold-window-autofind-switch"
                data-ocid="discovery_controls.hold_window_autofind_switch"
                checked={config.holdWindowAutoFind === true}
                disabled={disabled}
                onCheckedChange={(v) =>
                  updateConfig({ holdWindowAutoFind: v === true })
                }
                aria-label="Auto-find hold window length"
              />
            </label>
          </div>
        </div>
        <Slider
          id="hold-period-slider"
          data-ocid="discovery_controls.hold_period_slider"
          min={1}
          max={50}
          step={1}
          value={[config.horizon]}
          disabled={disabled || config.holdWindowAutoFind === true}
          onValueChange={(v) => updateConfig({ horizon: v[0] ?? 12 })}
          aria-label="Hold period in bars"
        />
        <p className="text-xs text-muted-foreground">
          {config.holdWindowAutoFind ? (
            <span className="text-primary">
              Auto-find compares {HOLD_WINDOW_CANDIDATES.join(", ")} bars for
              every pattern and recommends its strongest executable hold.
            </span>
          ) : (
            "Number of bars forward used to measure pattern outcome."
          )}
        </p>
      </div>

      <Separator />

      {/* ---- MFE/MAE proxy ---- */}
      <div className={cn("flex flex-col gap-3", disabled && "opacity-60")}>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-foreground">
            MFE/MAE proxy
          </span>
          <span className="text-[11px] text-muted-foreground">
            direction-adjusted ratio
          </span>
        </div>

        {/* Three-mode segmented control: Off / Positive-only / Auto-find */}
        <div
          role="radiogroup"
          aria-label="MFE/MAE ratio filter mode"
          className="grid grid-cols-3 gap-1.5 rounded-md border border-border bg-muted/30 p-1"
        >
          {MFE_MAE_MODES.map((mode) => {
            const active = mfeMaeMode === mode.value;
            const inputId = `mfe-mae-mode-${mode.value}`;
            return (
              <div key={mode.value} className="contents">
                <input
                  type="radio"
                  id={inputId}
                  name="mfe-mae-mode"
                  value={mode.value}
                  checked={active}
                  disabled={disabled}
                  onChange={() => setMfeMaeMode(mode.value)}
                  className="sr-only"
                  data-ocid={`discovery_controls.mfe_mae_mode.${mode.value}`}
                />
                <label
                  htmlFor={inputId}
                  title={mode.hint}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-[5px] px-2 py-1.5 text-xs font-medium transition-smooth outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    active
                      ? "border border-primary bg-primary/15 text-primary"
                      : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60",
                    disabled && "cursor-not-allowed",
                  )}
                >
                  <span className="leading-tight">{mode.label}</span>
                </label>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {MFE_MAE_MODES.find((m) => m.value === mfeMaeMode)?.hint ?? ""}
        </p>

        {/* MFE/MAE window */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <label
              htmlFor="mfe-mae-window-slider"
              className="text-sm text-foreground"
            >
              MFE/MAE window (bars)
            </label>
            <span className="font-mono text-sm tabular-nums text-primary">
              {config.mfeMaeWindow} bars
            </span>
          </div>
          <Slider
            id="mfe-mae-window-slider"
            data-ocid="discovery_controls.mfe_mae_window_slider"
            min={1}
            max={50}
            step={1}
            value={[config.mfeMaeWindow]}
            disabled={disabled}
            onValueChange={(v) => updateConfig({ mfeMaeWindow: v[0] ?? 12 })}
            aria-label="MFE/MAE window in bars"
          />
          <p className="text-xs text-muted-foreground">
            Forward window for the MFE/MAE proxy excursion measurement.
          </p>
        </div>

        {/* Min MFE:MAE ratio — visible in positive & auto modes, hidden in off.
            In auto mode the slider is read-only since the grid search overrides it. */}
        {mfeMaeMode !== "off" ? (
          <div
            className={cn(
              "flex flex-col gap-2",
              mfeMaeMode === "auto" && "opacity-60",
            )}
          >
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="min-mfe-mae-ratio-slider"
                className="text-sm text-foreground"
              >
                Min MFE:MAE ratio
                {mfeMaeMode === "auto" ? (
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    (auto-searched)
                  </span>
                ) : null}
              </label>
              <span className="font-mono text-sm tabular-nums text-primary">
                {config.minMfeMaeRatio.toFixed(1)}
              </span>
            </div>
            <Slider
              id="min-mfe-mae-ratio-slider"
              data-ocid="discovery_controls.min_mfe_mae_ratio_slider"
              min={1.0}
              max={5.0}
              step={0.1}
              value={[config.minMfeMaeRatio]}
              disabled={disabled || mfeMaeMode === "auto"}
              onValueChange={(v) =>
                updateConfig({ minMfeMaeRatio: v[0] ?? 1.5 })
              }
              aria-label="Minimum MFE to MAE ratio"
            />
            <p className="text-xs text-muted-foreground">
              {mfeMaeMode === "auto"
                ? "Auto-find iterates this threshold across a viable range and selects the best setting."
                : "Patterns must reach at least this favorable-to-adverse excursion ratio. Higher is stricter."}
            </p>
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          These are proxy settings (direction-adjusted excursion), not strategy
          metrics.
        </p>
      </div>

      <Separator />

      {/* ---- Max condition depth ---- */}
      <div className={cn("flex flex-col gap-2", disabled && "opacity-60")}>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-foreground">
            Pattern complexity
          </span>
          <span className="text-xs text-muted-foreground">
            conditions per pattern
          </span>
        </div>

        {/* Light range (2-4): fewer conditions, faster, broader patterns */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Light (2–4)
          </span>
          <div
            role="radiogroup"
            aria-label="Light pattern depth: 2 to 4 conditions"
            className="grid grid-cols-3 gap-2"
          >
            {lightOptions.map(renderDepthButton)}
          </div>
        </div>

        {/* Deep range (5-6): more conditions, sharper but exponentially more combos */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-primary/80">
            Deep (5–6)
          </span>
          <div
            role="radiogroup"
            aria-label="Deep pattern depth: 5 to 6 conditions"
            className="grid grid-cols-2 gap-2"
          >
            {deepOptions.map(renderDepthButton)}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          More conditions find sharper patterns but test exponentially more
          combinations. Light (2–4) is fast and broad; Deep (5–6) is sharper but
          slower and needs a larger dataset.
        </p>
      </div>

      <Separator />

      {/* ---- Schema-supported relationships ---- */}
      <div className={cn("flex flex-col gap-3", disabled && "opacity-60")}>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-foreground">
            Available relationships
          </span>
          <span
            className="font-mono text-xs tabular-nums text-muted-foreground"
            data-ocid="discovery_controls.categories_count"
          >
            {enabledCount}/{categories.length} on
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Generated only from fields present in your uploads. The engine does
          not assume VWAP, volume, price, or any other missing measurement.
        </p>
        <div className="flex flex-col gap-2">
          {categories.map((cat) => {
            const required =
              cat === MULTI_TIMEFRAME_CATEGORY && multiSourceRequired;
            const checked = config.enabledCategories.includes(cat) || required;
            const checkboxId = `discovery_controls.category.${cat.replace(/\s+/g, "_").toLowerCase()}`;
            return (
              <label
                key={cat}
                htmlFor={checkboxId}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm text-foreground select-none",
                  disabled && "cursor-not-allowed",
                )}
              >
                <Checkbox
                  id={checkboxId}
                  data-ocid={checkboxId}
                  checked={checked}
                  disabled={disabled || required}
                  onCheckedChange={(value) =>
                    toggleCategory(cat, value === true)
                  }
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="leading-tight font-medium">{cat}</span>
                  {LENS_DESCRIPTIONS[cat] ? (
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      {LENS_DESCRIPTIONS[cat]}
                    </span>
                  ) : null}
                  {required ? (
                    <span className="text-[11px] leading-snug text-primary">
                      Required while multiple datasets are selected.
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
          {categories.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No supported relationships have been generated yet.
            </p>
          ) : null}
        </div>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            data-ocid="discovery_controls.categories_all"
            disabled={disabled}
            onClick={() => updateConfig({ enabledCategories: [...categories] })}
            className="text-xs text-primary hover:underline disabled:opacity-50"
          >
            Select all
          </button>
          <button
            type="button"
            data-ocid="discovery_controls.categories_none"
            disabled={disabled}
            onClick={() =>
              updateConfig({
                enabledCategories: multiSourceRequired
                  ? [MULTI_TIMEFRAME_CATEGORY]
                  : [],
              })
            }
            className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
          >
            Clear all
          </button>
        </div>
      </div>

      {targetMode === "single" ? (
        <>
          <Separator />

          {/* ---- Max Data probe ---- */}
          <div className={cn("flex flex-col gap-2", disabled && "opacity-60")}>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground">
                Max Data
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Scan the explicitly focused dataset and find the loosest filter
              settings that still return at least one pattern.
            </p>
            <Button
              type="button"
              variant="secondary"
              data-ocid="discovery_controls.max_data_button"
              disabled={disabled || maxDataScanning}
              onClick={() => void runMaxDataProbe()}
            >
              {maxDataScanning ? "Scanning…" : "Find loosest viable settings"}
            </Button>
            {maxDataError ? (
              <p
                className="text-xs text-destructive"
                data-ocid="discovery_controls.max_data_error"
              >
                {maxDataError}
              </p>
            ) : null}
            {maxDataSuggestion ? (
              <div
                className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3"
                data-ocid="discovery_controls.max_data_result"
              >
                <p className="text-xs text-foreground">
                  Loosest viable: win rate ≥{" "}
                  <span className="font-mono tabular-nums">
                    {maxDataSuggestion.minWinRate}%
                  </span>
                  , sample ≥{" "}
                  <span className="font-mono tabular-nums">
                    {maxDataSuggestion.minSampleSize}
                  </span>
                  , depth{" "}
                  <span className="font-mono tabular-nums">
                    {maxDataSuggestion.maxDepth}
                  </span>{" "}
                  —{" "}
                  <span className="font-mono tabular-nums text-primary">
                    {maxDataSuggestion.patternCount}
                  </span>{" "}
                  patterns found
                </p>
                <Button
                  type="button"
                  size="sm"
                  data-ocid="discovery_controls.max_data_apply_button"
                  disabled={disabled}
                  onClick={applyMaxData}
                  className="self-start"
                >
                  Apply settings
                </Button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <Separator />

      {/* ---- Actions ---- */}
      <div className="flex items-center gap-2">
        {isRunning ? (
          <Button
            data-ocid="discovery_controls.cancel_button"
            variant="destructive"
            className="flex-1"
            onClick={cancelDiscovery}
          >
            <Square className="size-4 fill-current" aria-hidden="true" />
            Cancel discovery
          </Button>
        ) : (
          <Button
            data-ocid="discovery_controls.run_button"
            className="flex-1"
            disabled={!featuresAvailable || enabledCount === 0}
            onClick={() => (onRun ? onRun() : void runDiscoveryAction())}
          >
            <Play className="size-4 fill-current" aria-hidden="true" />
            Run discovery
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      {!featuresAvailable ? (
        <p className="text-xs text-muted-foreground">
          Generate features on the Feature Generator tab first.
        </p>
      ) : enabledCount === 0 ? (
        <p className="text-xs text-muted-foreground">
          Select at least one feature category to search.
        </p>
      ) : null}

      <Separator />

      {/* ---- Per-feature manual range overrides ---- */}
      {targetMode === "single" ? (
        <div className={cn("flex flex-col gap-3", disabled && "opacity-60")}>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-foreground">
              Manual threshold search bounds
            </span>
            <span className="text-[11px] text-muted-foreground">
              empirical quantiles by default
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            By default, thresholds come from the feature’s actual 20th, 40th,
            60th, and 80th percentiles. Editing min/max replaces those empirical
            thresholds with four evenly spaced thresholds inside your manual
            bounds and can materially change the discovered patterns. Reset
            restores empirical quantiles.
          </p>
          {numericFeatures.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No numeric features available yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {numericFeatures.map((f) => {
                const override = featureOverrides[f.id];
                const observed = (featureValues?.[f.id] ?? []).filter(
                  (value): value is number =>
                    typeof value === "number" && Number.isFinite(value),
                );
                const autoRange: [number, number] =
                  observed.length > 0
                    ? [
                        observed.reduce(
                          (minimum, value) => Math.min(minimum, value),
                          Number.POSITIVE_INFINITY,
                        ),
                        observed.reduce(
                          (maximum, value) => Math.max(maximum, value),
                          Number.NEGATIVE_INFINITY,
                        ),
                      ]
                    : (f.range ?? [0, 1]);
                const effective: [number, number] =
                  override?.range ?? autoRange;
                const isOverridden = Boolean(override);
                return (
                  <div
                    key={f.id}
                    data-ocid={`discovery_controls.feature_override.${f.id}`}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-md border border-border bg-muted/20 p-2.5",
                      isOverridden && "border-primary/40 bg-primary/5",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-foreground">
                        {f.name}
                      </span>
                      {isOverridden ? (
                        <Badge
                          variant="secondary"
                          className="h-4 shrink-0 px-1.5 text-[9px] font-medium uppercase tracking-wide"
                        >
                          Manual
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>observed:</span>
                      <span className="font-mono tabular-nums">
                        {autoRange[0].toFixed(2)} – {autoRange[1].toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        aria-label={`Minimum override for ${f.name}`}
                        data-ocid={`discovery_controls.feature_override.${f.id}.min`}
                        disabled={disabled}
                        value={
                          Number.isFinite(effective[0]) ? effective[0] : ""
                        }
                        onChange={(e) => {
                          const minRaw = e.target.value;
                          const min =
                            minRaw === "" ? autoRange[0] : Number(minRaw);
                          if (!Number.isFinite(min)) return;
                          setFeatureOverride(f.id, {
                            featureId: f.id,
                            range: [min, effective[1]],
                          });
                        }}
                        className="h-7 font-mono text-xs tabular-nums"
                      />
                      <span className="text-xs text-muted-foreground">–</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        aria-label={`Maximum override for ${f.name}`}
                        data-ocid={`discovery_controls.feature_override.${f.id}.max`}
                        disabled={disabled}
                        value={
                          Number.isFinite(effective[1]) ? effective[1] : ""
                        }
                        onChange={(e) => {
                          const maxRaw = e.target.value;
                          const max =
                            maxRaw === "" ? autoRange[1] : Number(maxRaw);
                          if (!Number.isFinite(max)) return;
                          setFeatureOverride(f.id, {
                            featureId: f.id,
                            range: [effective[0], max],
                          });
                        }}
                        className="h-7 font-mono text-xs tabular-nums"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Reset override for ${f.name}`}
                        data-ocid={`discovery_controls.feature_override.${f.id}.reset`}
                        disabled={disabled || !isOverridden}
                        onClick={() => clearFeatureOverride(f.id)}
                        className="h-7 shrink-0 px-2"
                      >
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Unified discovery uses empirical thresholds independently on every
          target timeline. Manual per-file bounds are available only in
          explicit-target mode.
        </p>
      )}
    </div>
  );
}
