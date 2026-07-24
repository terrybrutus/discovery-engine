import { DataPreview } from "@/components/DataPreview";
import { EmptyState } from "@/components/EmptyState";
import { FeatureCatalog } from "@/components/FeatureCatalog";
import { FeatureStats } from "@/components/FeatureStats";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useEngineStore } from "@/store/engineStore";
import type { Feature, FeatureCategory } from "@/types";
import { BarChart3, Database, ListTree, Sparkles, Zap } from "lucide-react";
import { useMemo } from "react";

/**
 * Feature Generator tab — the first step in the four-tab flow.
 *
 * Shows a "Generate Features" button that triggers feature computation on the
 * loaded dataset, a progress indicator while computing, then the feature
 * catalog grouped by category and summary stats for the generated features.
 * Empty state when no dataset is loaded.
 */
export default function FeatureGeneratorPage() {
  const dataset = useEngineStore((s) => s.dataset);
  const datasets = useEngineStore((s) => s.datasets);
  const selectedDatasetIds = useEngineStore((s) => s.selectedDatasetIds);
  const features = useEngineStore((s) => s.features);
  const featureValues = useEngineStore((s) => s.featureValues);
  const isComputing = useEngineStore((s) => s.isComputing);
  const completedSteps = useEngineStore((s) => s.completedSteps);
  const generateFeaturesAction = useEngineStore(
    (s) => s.generateFeaturesAction,
  );
  const setFeatureEnabled = useEngineStore((s) => s.setFeatureEnabled);
  const setFeatureCategoryEnabled = useEngineStore(
    (s) => s.setFeatureCategoryEnabled,
  );

  const featuresGenerated = completedSteps.has("featuresGenerated");
  const includedDatasets =
    selectedDatasetIds.length > 0
      ? datasets.filter((candidate) =>
          selectedDatasetIds.includes(candidate.id),
        )
      : datasets;
  const includedBars = includedDatasets.reduce(
    (sum, candidate) => sum + candidate.rowCount,
    0,
  );

  // The catalog reflects the store directly so these switches control the
  // exact feature set supplied to discovery, including matching features in
  // the selected context datasets.
  const effectiveEnabledMap = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const f of features) {
      out[f.id] = f.enabled;
    }
    return out;
  }, [features]);

  const handleToggle = (featureId: string, enabled: boolean) => {
    setFeatureEnabled(featureId, enabled);
  };

  const handleSetCategoryEnabled = (
    category: FeatureCategory,
    enabled: boolean,
  ) => {
    setFeatureCategoryEnabled(category, enabled);
  };

  // ---- No dataset loaded ----
  if (!dataset) {
    return (
      <div data-ocid="page.feature_generator" className="px-4 py-8 md:px-6">
        <EmptyState
          icon={Database}
          title="No data loaded yet"
          description="Load a CSV of OHLCV bars (or use the built-in sample dataset) to start generating features. The engine derives hundreds of measurable characteristics from each bar — candle shape, VWAP distance, time of day, volume behavior, and more."
          hint="Tip: click “Use Sample” in the header to load one year of realistic intraday data instantly."
        />
      </div>
    );
  }

  // ---- Computing ----
  if (isComputing && !featuresGenerated) {
    return (
      <div
        data-ocid="page.feature_generator.loading_state"
        className="flex flex-col items-center justify-center gap-6 px-4 py-20 md:px-6"
      >
        <div className="flex size-16 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
          <Sparkles
            className="size-7 animate-pulse-soft text-primary"
            aria-hidden="true"
          />
        </div>
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h2 className="font-display text-lg font-semibold text-foreground">
            Generating features…
          </h2>
          <p className="text-sm text-muted-foreground">
            Deriving hundreds of measurable characteristics from{" "}
            <span className="font-mono text-foreground tabular-nums">
              {includedBars.toLocaleString()}
            </span>{" "}
            bars across {includedDatasets.length} selected dataset
            {includedDatasets.length === 1 ? "" : "s"}. This runs entirely in
            your browser.
          </p>
          <div className="w-full max-w-sm">
            <Progress
              data-ocid="page.feature_generator.progress"
              value={62}
              className="h-1.5"
            />
            <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Computing</span>
              <span className="font-mono tabular-nums">in progress</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Not yet generated ----
  if (!featuresGenerated || features.length === 0) {
    return (
      <div data-ocid="page.feature_generator" className="px-4 py-8 md:px-6">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-12 text-center">
          <div className="flex size-16 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
            <Zap className="size-7 text-primary" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-xl font-semibold text-foreground">
              Generate features from your data
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The engine will derive hundreds of measurable features from your{" "}
              <span className="font-mono text-foreground tabular-nums">
                {includedBars.toLocaleString()}
              </span>{" "}
              bars in {includedDatasets.length} selected dataset
              {includedDatasets.length === 1 ? "" : "s"}. It builds
              timeframe-aware market structure, pivots, HH/HL/LH/LL sequences,
              previous-session levels, rolling boxes, relative Bollinger/VWAP
              context, and semantic transformations for imported columns. During
              discovery, completed higher- and lower-timeframe states are
              causally aligned to the active prediction target.
            </p>
          </div>
          <Button
            data-ocid="page.feature_generator.generate_button"
            size="lg"
            onClick={generateFeaturesAction}
            disabled={isComputing}
          >
            <Sparkles className="size-4" aria-hidden="true" />
            Generate Features
          </Button>
        </div>
      </div>
    );
  }

  // ---- Generated: catalog + stats ----
  const categories = new Set<FeatureCategory>(features.map((f) => f.category));
  const enabledCount = features.filter(
    (f) => effectiveEnabledMap[f.id] ?? f.enabled,
  ).length;

  return (
    <div
      data-ocid="page.feature_generator"
      className="flex flex-col gap-6 px-4 py-6 md:px-6"
    >
      {/* Data preview — show the loaded dataset's columns + first rows so
          the user can verify what was loaded before generating features. */}
      <section
        data-ocid="page.feature_generator.data_preview_section"
        className="flex flex-col gap-2"
      >
        <div className="flex items-center gap-2">
          <Database className="size-4 text-primary" aria-hidden="true" />
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-foreground">
            Loaded Dataset
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Preview the first rows of your dataset with original column names
          preserved. Custom indicator columns (non-OHLCV) are shown alongside
          OHLCV fields.
        </p>
        <DataPreview dataset={dataset} />
      </section>

      {/* Summary header */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-subtle sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md border border-primary/30 bg-primary/10">
            <ListTree className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <h2 className="font-display text-base font-semibold text-foreground">
              <span className="font-mono tabular-nums text-primary">
                {features.length}
              </span>{" "}
              features generated across{" "}
              <span className="font-mono tabular-nums text-primary">
                {categories.size}
              </span>{" "}
              categories
            </h2>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{enabledCount}</span> of{" "}
              <span className="font-mono tabular-nums">{features.length}</span>{" "}
              enabled for pattern testing ·{" "}
              <span className="font-mono">{dataset.name}</span>
            </p>
          </div>
        </div>
        <Button
          data-ocid="page.feature_generator.regenerate_button"
          variant="outline"
          size="sm"
          onClick={generateFeaturesAction}
          disabled={isComputing}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          Regenerate
        </Button>
      </div>

      {/* Catalog section */}
      <section
        data-ocid="page.feature_generator.catalog_section"
        className="flex flex-col gap-2"
      >
        <div className="flex items-center gap-2">
          <ListTree className="size-4 text-primary" aria-hidden="true" />
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-foreground">
            Feature Catalog
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Browse every generated feature by category — this is the feature
          glossary. Each card shows a plain-English definition, a source badge
          (Built-in vs Custom for uploaded columns), and an expandable Formula
          section with the exact computation. Toggle features on or off to
          control which ones the discovery engine will test, filter by source,
          or use search to find a specific feature by name.
        </p>
        <FeatureCatalog
          features={features}
          enabledMap={effectiveEnabledMap}
          onToggle={handleToggle}
          onSetCategoryEnabled={handleSetCategoryEnabled}
        />
      </section>

      {/* Stats section */}
      {featureValues ? (
        <section
          data-ocid="page.feature_generator.stats_section"
          className="flex flex-col gap-2"
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" aria-hidden="true" />
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-foreground">
              Summary Statistics
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Understand the shape of your data. Numeric features show min, max,
            mean, and percentile distribution. Categorical features show how
            often each bucket occurs.
          </p>
          <FeatureStats
            features={features}
            featureValues={featureValues}
            enabledMap={effectiveEnabledMap}
          />
        </section>
      ) : null}
    </div>
  );
}
