import { DataPreview } from "@/components/DataPreview";
import { DefinitionManager } from "@/components/DefinitionManager";
import { EmptyState } from "@/components/EmptyState";
import { FeatureCatalog } from "@/components/FeatureCatalog";
import { FeatureStats } from "@/components/FeatureStats";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { buildResearchUniverse } from "@/lib/researchUniverse";
import { useEngineStore } from "@/store/engineStore";
import type { Feature, FeatureCategory } from "@/types";
import {
  BarChart3,
  Braces,
  Database,
  Files,
  GitBranch,
  ListTree,
  Sparkles,
  Zap,
} from "lucide-react";
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
  const featuresByDataset = useEngineStore((s) => s.featuresByDataset);
  const featureValues = useEngineStore((s) => s.featureValues);
  const targetMode = useEngineStore((s) => s.targetMode);
  const isComputing = useEngineStore((s) => s.isComputing);
  const lastError = useEngineStore((s) => s.lastError);
  const completedSteps = useEngineStore((s) => s.completedSteps);
  const generateFeaturesAction = useEngineStore(
    (s) => s.generateFeaturesAction,
  );
  const setFeatureEnabled = useEngineStore((s) => s.setFeatureEnabled);
  const setFeatureCategoryEnabled = useEngineStore(
    (s) => s.setFeatureCategoryEnabled,
  );

  const featuresGenerated = completedSteps.has("featuresGenerated");
  const includedDatasets = datasets.filter((candidate) =>
    targetMode === "all"
      ? selectedDatasetIds.includes(candidate.id)
      : candidate.id === dataset?.id ||
        selectedDatasetIds.includes(candidate.id),
  );
  const includedBars = includedDatasets.reduce(
    (sum, candidate) => sum + candidate.rowCount,
    0,
  );
  const universe = useMemo(
    () => buildResearchUniverse(includedDatasets),
    [includedDatasets],
  );
  const displayFeatures = useMemo(() => {
    if (targetMode === "single") return features;
    const unique = new Map<string, Feature>();
    for (const candidate of includedDatasets) {
      for (const feature of featuresByDataset[candidate.id] ?? []) {
        const key = `${feature.category}:${feature.id}`;
        if (!unique.has(key)) unique.set(key, feature);
      }
    }
    return [...unique.values()];
  }, [features, featuresByDataset, includedDatasets, targetMode]);

  // The catalog reflects the store directly so these switches control the
  // exact feature set supplied to discovery, including matching features in
  // the selected context datasets.
  const effectiveEnabledMap = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const f of displayFeatures) {
      out[f.id] = f.enabled;
    }
    return out;
  }, [displayFeatures]);

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
          description="Load a time-indexed CSV with one or more numeric fields. The engine begins empty and activates only measurements supported by the fields you provide."
          hint="Use Sample is optional and loads a demonstration market dataset; it is not built into your own research."
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
            Deriving schema-supported relationships from{" "}
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
  if (!featuresGenerated || displayFeatures.length === 0) {
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
              The engine will inspect the fields present across your{" "}
              <span className="font-mono text-foreground tabular-nums">
                {includedBars.toLocaleString()}
              </span>{" "}
              observations in {includedDatasets.length} selected dataset
              {includedDatasets.length === 1 ? "" : "s"} and activate only
              supported relationships. OHLC data can produce structure, pivots,
              sequences, and relative level context; imported indicators receive
              semantic, stationary transformations. During discovery, selected
              timelines are causally aligned, including developing
              higher-timeframe candles reconstructed from completed
              same-instrument lower-timeframe observations when available.
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
          {lastError ? (
            <p className="text-sm text-destructive" role="alert">
              {lastError}
            </p>
          ) : null}
        </div>
        <div className="mx-auto max-w-5xl">
          <DefinitionManager />
        </div>
      </div>
    );
  }

  // ---- Generated: catalog + stats ----
  const categories = new Set<FeatureCategory>(
    displayFeatures.map((f) => f.category),
  );
  const enabledCount = displayFeatures.filter(
    (f) => effectiveEnabledMap[f.id] ?? f.enabled,
  ).length;

  return (
    <div
      data-ocid="page.feature_generator"
      className="flex flex-col gap-6 px-4 py-6 md:px-6"
    >
      {targetMode === "all" ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <Files className="mb-2 size-4 text-primary" aria-hidden="true" />
              <div className="font-mono text-lg text-foreground">
                {universe.datasets.length}
              </div>
              <div className="text-xs text-muted-foreground">
                included source files
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <Database
                className="mb-2 size-4 text-primary"
                aria-hidden="true"
              />
              <div className="font-mono text-lg text-foreground">
                {universe.totalRows.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">
                observations in the research universe
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <GitBranch
                className="mb-2 size-4 text-primary"
                aria-hidden="true"
              />
              <div className="font-mono text-lg text-foreground">
                {universe.instruments.length} · {universe.hierarchyLinks}
              </div>
              <div className="text-xs text-muted-foreground">
                instruments · timeframe hierarchy links
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <Braces className="mb-2 size-4 text-primary" aria-hidden="true" />
              <div className="font-mono text-lg text-foreground">
                {universe.inputColumns.length}
              </div>
              <div className="text-xs text-muted-foreground">
                unique uploaded fields
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 sm:col-span-2 xl:col-span-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground">
                Canonical hierarchy
              </div>
              <div className="flex flex-wrap gap-2">
                {universe.instruments.map((instrument) => (
                  <span
                    key={instrument.instrumentKey}
                    className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-muted-foreground"
                  >
                    {instrument.instrumentKey}:{" "}
                    {instrument.timeframeLabels.join(" → ")}
                  </span>
                ))}
              </div>
            </div>
          </section>
          <CausalAlignmentAudit datasets={includedDatasets} />
        </>
      ) : (
        <section
          data-ocid="page.feature_generator.data_preview_section"
          className="flex flex-col gap-2"
        >
          <div className="flex items-center gap-2">
            <Database className="size-4 text-primary" aria-hidden="true" />
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-foreground">
              Explicitly focused dataset
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            This preview is shown only because single-target mode is active.
          </p>
          <DataPreview dataset={dataset} />
        </section>
      )}

      {/* Summary header */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-subtle sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md border border-primary/30 bg-primary/10">
            <ListTree className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <h2 className="font-display text-base font-semibold text-foreground">
              <span className="font-mono tabular-nums text-primary">
                {displayFeatures.length}
              </span>{" "}
              features generated across{" "}
              <span className="font-mono tabular-nums text-primary">
                {categories.size}
              </span>{" "}
              {categories.size === 1 ? "category" : "categories"}
            </h2>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{enabledCount}</span> of{" "}
              <span className="font-mono tabular-nums">
                {displayFeatures.length}
              </span>{" "}
              schema-supported capabilities enabled
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
      <DefinitionManager />

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
          features={displayFeatures}
          enabledMap={effectiveEnabledMap}
          onToggle={handleToggle}
          onSetCategoryEnabled={handleSetCategoryEnabled}
        />
      </section>

      {/* Stats section */}
      {targetMode === "single" && featureValues ? (
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
import { CausalAlignmentAudit } from "@/components/CausalAlignmentAudit";
