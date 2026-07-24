import type { Backend } from "@/backend";
import { runCrossReference } from "@/lib/crossReference";
import { runDiscovery } from "@/lib/discovery";
import {
  type FeatureOverride,
  type FeatureOverrides,
  computeFeatureValues,
  generateFeatures,
} from "@/lib/features";
import {
  buildMultiTimeframeResearchSpace,
  datasetIntervalMs,
} from "@/lib/multiTimeframe";
import { generateReport } from "@/lib/report";
import { getSampleDataset } from "@/lib/sampleData";
import { deriveSemanticColumnFeatures } from "@/lib/semanticColumns";
import { validatePatterns } from "@/lib/validation";
import { BUILTIN_CATEGORIES } from "@/types";
import type {
  CompletedStep,
  CompletedSteps,
  CrossReferenceConfig,
  CrossReferenceResult,
  Dataset,
  DiscoveryConfig,
  DiscoveryProgress,
  Feature,
  FeatureCategory,
  FeatureMatrix,
  Pattern,
  Report,
  SavedRun,
  SavedRunSummary,
  TabId,
  ValidationResult,
} from "@/types";
import { Principal } from "@icp-sdk/core/principal";
import { create } from "zustand";

// ---------------------------------------------------------------------------
// Engine store — single source of truth for the Trading Discovery Engine.
// All computation is client-side. No sample dataset is force-loaded; the
// user must explicitly load data via the Data Intake panel.
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: DiscoveryConfig = {
  maxDepth: 3,
  minSampleSize: 30,
  minWinRate: 55,
  enabledCategories: [...BUILTIN_CATEGORIES],
  horizon: 12, // 1 hour on 5m bars
  maxCombinations: 50000,
  mfeMaeWindow: 12,
  minMfeMaeRatio: 1.5,
  mfeMaeRatioEnabled: true, // legacy, kept for backward compat
  mfeMaeRatioMode: "positive",
  holdWindowAutoFind: false,
  outcomeTargetsPct: [0.1, 0.25, 0.5, 1],
  outcomeStopsPct: [0.1, 0.25, 0.5, 1],
  walkForwardFolds: 4,
};

const DEFAULT_PROGRESS: DiscoveryProgress = {
  total: 0,
  tested: 0,
  current: "",
  isRunning: false,
  estimatedRemainingMs: 0,
};

interface EngineState {
  // ---- State ----
  /**
   * Active dataset, derived from `datasets` + `activeDatasetId`.
   * Existing consumers read `useEngineStore((s) => s.dataset)` and continue
   * to work without changes.
   */
  dataset: Dataset | null;
  /** All uploaded datasets in this session. */
  datasets: Dataset[];
  /** Id of the currently active dataset, or null if none. */
  activeDatasetId: string | null;
  /** Test one explicit outcome timeline or every selected dataset in turn. */
  targetMode: "all" | "single";
  /** Datasets included in discovery, validation, and timeframe alignment. */
  selectedDatasetIds: string[];
  features: Feature[];
  featureValues: FeatureMatrix | null;
  /** Generated feature catalogs and matrices retained for every dataset. */
  featuresByDataset: Record<string, Feature[]>;
  featureValuesByDataset: Record<string, FeatureMatrix>;
  /** Causally aligned design matrix actually supplied to discovery. */
  researchFeatures: Feature[];
  researchFeatureValues: FeatureMatrix | null;
  researchContextDatasetIds: string[];
  researchTotalBars: number;
  patterns: Pattern[];
  validationResults: ValidationResult[];
  /** Cross-timeframe correlation results across multiple datasets. */
  crossReferenceResults: CrossReferenceResult[];
  /** True while a cross-reference run is in progress. */
  isCrossReferencing: boolean;
  report: Report | null;
  discoveryConfig: DiscoveryConfig;
  discoveryProgress: DiscoveryProgress;
  activeTab: TabId;
  completedSteps: CompletedSteps;
  isComputing: boolean;
  lastError: string | null;

  // ---- Feature overrides ----
  featureOverrides: FeatureOverrides;
  setFeatureOverride: (featureId: string, override: FeatureOverride) => void;
  clearFeatureOverride: (featureId: string) => void;
  clearAllOverrides: () => void;

  // ---- Saved runs (backend persistence) ----
  savedRuns: SavedRunSummary[];
  savedRunsLoading: boolean;
  savedRunsError: string | null;
  saveRunLoading: boolean;
  saveRunError: string | null;
  saveRunAction: (actor: Backend | null, name: string) => Promise<void>;
  loadSavedRunsAction: (actor: Backend | null) => Promise<void>;
  loadRunAction: (actor: Backend | null, runId: number) => Promise<void>;
  deleteRunAction: (actor: Backend | null, runId: number) => Promise<void>;

  // ---- Actions ----
  /** Append a dataset, set it active, and reset downstream computation. */
  addDataset: (dataset: Dataset) => void;
  /** Remove a dataset by id; adjusts active selection. */
  removeDataset: (id: string) => void;
  /** Set the active dataset by id. */
  setActiveDataset: (id: string) => void;
  setTargetMode: (mode: "all" | "single") => void;
  /** Include or exclude a dataset from multi-dataset research. */
  toggleDatasetSelected: (id: string) => void;
  /** Rename a dataset's user-facing label. */
  renameDataset: (id: string, label: string) => void;
  /** Backward-compatible: equivalent to addDataset. */
  loadDataset: (dataset: Dataset) => void;
  loadSampleDataset: () => void;
  generateFeaturesAction: () => void;
  setFeatureEnabled: (featureId: string, enabled: boolean) => void;
  setFeatureCategoryEnabled: (
    category: FeatureCategory,
    enabled: boolean,
  ) => void;
  runDiscoveryAction: () => Promise<void>;
  validateAction: () => void;
  generateReportAction: () => void;
  /** Run cross-timeframe correlation across the selected datasets. */
  runCrossReferenceAction: (config: CrossReferenceConfig) => Promise<void>;
  /** Clear stored cross-reference results. */
  clearCrossReferenceResults: () => void;
  setActiveTab: (tab: TabId) => void;
  updateConfig: (patch: Partial<DiscoveryConfig>) => void;
  cancelDiscovery: () => void;
  resetSession: () => void;
}

/**
 * Derive the full category list from the currently generated features.
 * Returns the union of built-in categories and any categories introduced by
 * generated (including uploaded-column-derived) features, so the UI can show
 * dynamic counts even when categories grow beyond the built-in set.
 * The result is cached by the features-array reference. Zustand selectors
 * used through React's external-store API must return the same reference when
 * their source state has not changed; returning a fresh array on every read
 * causes an infinite render loop in React 19.
 */
let cachedCategoryFeatures: Feature[] | null = null;
let cachedCategoryCatalogs: Record<string, Feature[]> | null = null;
let cachedFeatureCategories: FeatureCategory[] = [];

export function selectFeatureCategories(state: EngineState): FeatureCategory[] {
  if (
    state.features === cachedCategoryFeatures &&
    state.featuresByDataset === cachedCategoryCatalogs
  ) {
    return cachedFeatureCategories;
  }

  const catalogs = Object.values(state.featuresByDataset);
  const availableFeatures =
    catalogs.length > 0 ? catalogs.flat() : state.features;
  const categorySet = new Set<FeatureCategory>();
  for (const feature of availableFeatures) {
    categorySet.add(feature.category);
  }
  cachedCategoryFeatures = state.features;
  cachedCategoryCatalogs = state.featuresByDataset;
  cachedFeatureCategories = [...categorySet];
  return cachedFeatureCategories;
}

// Cancellation flag held outside React state to avoid re-renders.
let cancelFlag = { cancelled: false };

/** Read-only prefix view used for the in-sample discovery window. It avoids
 * copying every causally aligned feature into another large array. */
function prefixSeries(
  source: FeatureMatrix[string],
  length: number,
): FeatureMatrix[string] {
  const target = new Array<number | string | undefined>(length);
  return new Proxy(target, {
    get(array, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) {
        return source[Number(property)];
      }
      return Reflect.get(array, property, receiver);
    },
    has(array, property) {
      if (typeof property === "string" && /^\d+$/.test(property)) {
        const index = Number(property);
        return index >= 0 && index < length;
      }
      return Reflect.has(array, property);
    },
    set() {
      return false;
    },
  });
}

function buildDatasetFeatures(
  dataset: Dataset,
  overrides: FeatureOverrides,
): { features: Feature[]; matrix: FeatureMatrix } {
  const priceCategories = new Set<FeatureCategory>([
    "Candle Structure",
    "Market Structure",
    "Sequences",
    "Volatility",
    "Location",
    "Levels & Sessions",
    "Gap",
    "Opening Range",
    "Bollinger",
    "Trend",
  ]);
  const volumeCategories = new Set<FeatureCategory>(["VWAP", "Volume"]);
  const allGenerated = generateFeatures(dataset.bars, [], overrides);
  const generated = dataset.hasOHLC
    ? allGenerated.filter(
        (feature) =>
          priceCategories.has(feature.category) ||
          (dataset.hasVolume && volumeCategories.has(feature.category)) ||
          feature.category === "Time" ||
          feature.category === "Calendar",
      )
    : [];
  // The built-in calculator is a single optimized OHLC pass. Indicator-only
  // uploads skip it entirely and receive only semantic transformations of the
  // fields actually present.
  const computed = dataset.hasOHLC
    ? computeFeatureValues(dataset.bars, allGenerated)
    : {};
  const features = [...generated];
  const matrix: FeatureMatrix = Object.fromEntries(
    generated.map((feature) => [feature.id, computed[feature.id] ?? []]),
  );
  const semantic = deriveSemanticColumnFeatures(dataset);
  for (const column of dataset.columns) {
    column.semantic = semantic.semantics[column.key] ?? column.semantic;
  }
  features.push(...semantic.features);
  Object.assign(matrix, semantic.matrix);
  const informative = features.filter((feature) => {
    const values = matrix[feature.id] ?? [];
    const distinct = new Set<string | number>();
    let present = 0;
    for (const value of values) {
      if (
        value == null ||
        (typeof value === "number" && !Number.isFinite(value))
      ) {
        continue;
      }
      present++;
      if (distinct.size < 3) distinct.add(value);
    }
    return (
      present >= Math.max(5, Math.floor(dataset.rowCount * 0.01)) &&
      distinct.size >= 2
    );
  });
  const informativeMatrix: FeatureMatrix = Object.fromEntries(
    informative.map((feature) => [feature.id, matrix[feature.id]]),
  );
  return { features: informative, matrix: informativeMatrix };
}

function timeframeMinutes(dataset: Dataset): number {
  return datasetIntervalMs(dataset) / 60_000;
}

function resultIsProfitable(
  result: ValidationResult,
  pattern: Pattern,
): boolean {
  const move = result.outOfSampleMetrics.avgMove;
  return (
    (pattern.direction === "bullish" && move > 0) ||
    (pattern.direction === "bearish" && move < 0) ||
    (pattern.direction === "neutral" && move !== 0)
  );
}

/**
 * Validate against one additional timeline at a time and retain only scalar
 * survival totals. This preserves cross-dataset survival without keeping an
 * O(dataset × aligned-feature) collection of matrices alive.
 */
async function validateMemoryBounded(
  target: Dataset,
  selectedDatasets: Dataset[],
  featuresByDataset: Record<string, Feature[]>,
  featureValuesByDataset: Record<string, FeatureMatrix>,
  patterns: Pattern[],
  horizon: number,
): Promise<ValidationResult[]> {
  const primaryResearch = buildMultiTimeframeResearchSpace(
    target,
    selectedDatasets,
    featuresByDataset,
    featureValuesByDataset,
  );
  const baseResults = validatePatterns(
    target,
    primaryResearch.features,
    primaryResearch.matrix,
    patterns,
    [],
  );
  const patternById = new Map(patterns.map((pattern) => [pattern.id, pattern]));
  const totals = new Map(
    baseResults.map((result) => {
      return [
        result.patternId,
        {
          symbolEvaluated: 0,
          symbolProfitable: 0,
          timeframeEvaluated: 0,
          timeframeProfitable: 0,
        },
      ];
    }),
  );
  const targetMinutes = timeframeMinutes(target);

  for (const candidate of selectedDatasets) {
    if (candidate.id === target.id || !featureValuesByDataset[candidate.id]) {
      continue;
    }
    const candidateMatrix = buildMultiTimeframeResearchSpace(
      candidate,
      selectedDatasets,
      featuresByDataset,
      featureValuesByDataset,
      target.id,
    ).matrix;
    const candidateResults = validatePatterns(
      target,
      primaryResearch.features,
      primaryResearch.matrix,
      patterns,
      [
        {
          dataset: candidate,
          matrix: candidateMatrix,
          horizon: Math.max(
            1,
            Math.round((horizon * targetMinutes) / timeframeMinutes(candidate)),
          ),
        },
      ],
    );
    for (const pairResult of candidateResults) {
      const baseResult = baseResults.find(
        (result) => result.patternId === pairResult.patternId,
      );
      const pattern = patternById.get(pairResult.patternId);
      const total = totals.get(pairResult.patternId);
      if (!baseResult || !pattern || !total) continue;
      const primaryEvaluated =
        baseResult.outOfSampleMetrics.sampleSize > 0 ? 1 : 0;
      const primaryProfitable =
        primaryEvaluated > 0 && resultIsProfitable(baseResult, pattern) ? 1 : 0;
      const pairEvaluated = primaryEvaluated + 1;
      const pairProfitable = Math.round(
        (pairResult.crossSymbolSurvival ?? 0) * pairEvaluated,
      );
      const candidateProfitable = Math.max(
        0,
        Math.min(1, pairProfitable - primaryProfitable),
      );
      if (candidate.instrumentKey !== target.instrumentKey) {
        total.symbolEvaluated += 1;
        total.symbolProfitable += candidateProfitable;
      }
      if (candidate.timeframe !== target.timeframe) {
        total.timeframeEvaluated += 1;
        total.timeframeProfitable += candidateProfitable;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return baseResults.map((result) => {
    const total = totals.get(result.patternId);
    return {
      ...result,
      crossSymbolSurvival:
        total && total.symbolEvaluated > 0
          ? total.symbolProfitable / total.symbolEvaluated
          : null,
      crossTimeframeSurvival:
        total && total.timeframeEvaluated > 0
          ? total.timeframeProfitable / total.timeframeEvaluated
          : null,
    };
  });
}

export const useEngineStore = create<EngineState>((set, get) => ({
  dataset: null,
  datasets: [],
  activeDatasetId: null,
  targetMode: "all",
  selectedDatasetIds: [],
  features: [],
  featureValues: null,
  featuresByDataset: {},
  featureValuesByDataset: {},
  researchFeatures: [],
  researchFeatureValues: null,
  researchContextDatasetIds: [],
  researchTotalBars: 0,
  patterns: [],
  validationResults: [],
  crossReferenceResults: [],
  isCrossReferencing: false,
  report: null,
  discoveryConfig: DEFAULT_CONFIG,
  discoveryProgress: DEFAULT_PROGRESS,
  activeTab: "features",
  completedSteps: new Set<CompletedStep>(),
  isComputing: false,
  lastError: null,

  featureOverrides: {},
  savedRuns: [],
  savedRunsLoading: false,
  savedRunsError: null,
  saveRunLoading: false,
  saveRunError: null,

  addDataset: (dataset) => {
    cancelFlag = { cancelled: false };
    set((state) => {
      const datasets = [...state.datasets, dataset];
      return {
        datasets,
        activeDatasetId: dataset.id,
        selectedDatasetIds: [...state.selectedDatasetIds, dataset.id],
        dataset,
        features: [],
        featureValues: null,
        researchFeatures: [],
        researchFeatureValues: null,
        researchContextDatasetIds: [],
        researchTotalBars: 0,
        patterns: [],
        validationResults: [],
        crossReferenceResults: [],
        report: null,
        discoveryProgress: DEFAULT_PROGRESS,
        completedSteps: new Set<CompletedStep>(["dataLoaded"]),
        activeTab: "features",
        lastError: null,
      };
    });
  },

  removeDataset: (id) => {
    set((state) => {
      const datasets = state.datasets.filter((d) => d.id !== id);
      const selectedDatasetIds = state.selectedDatasetIds.filter(
        (datasetId) => datasetId !== id,
      );
      const featuresByDataset = { ...state.featuresByDataset };
      const featureValuesByDataset = { ...state.featureValuesByDataset };
      delete featuresByDataset[id];
      delete featureValuesByDataset[id];
      let activeDatasetId = state.activeDatasetId;
      let dataset = state.dataset;
      if (activeDatasetId === id) {
        activeDatasetId =
          datasets.length > 0 ? datasets[datasets.length - 1].id : null;
        dataset = activeDatasetId
          ? (datasets.find((d) => d.id === activeDatasetId) ?? null)
          : null;
      }
      const cachedFeatures = activeDatasetId
        ? (featuresByDataset[activeDatasetId] ?? [])
        : [];
      const cachedValues = activeDatasetId
        ? (featureValuesByDataset[activeDatasetId] ?? null)
        : null;
      const completedSteps = dataset
        ? new Set<CompletedStep>(["dataLoaded"])
        : new Set<CompletedStep>();
      if (cachedFeatures.length > 0 && cachedValues) {
        completedSteps.add("featuresGenerated");
      }
      return {
        datasets,
        selectedDatasetIds,
        featuresByDataset,
        featureValuesByDataset,
        activeDatasetId,
        dataset,
        features: cachedFeatures,
        featureValues: cachedValues,
        researchFeatures: [],
        researchFeatureValues: null,
        researchContextDatasetIds: [],
        researchTotalBars: 0,
        patterns: [],
        validationResults: [],
        crossReferenceResults: [],
        report: null,
        completedSteps,
      };
    });
  },

  setActiveDataset: (id) => {
    set((state) => {
      const dataset = state.datasets.find((d) => d.id === id) ?? null;
      if (!dataset || id === state.activeDatasetId) return {};
      const cachedFeatures = state.featuresByDataset[id] ?? [];
      const cachedValues = state.featureValuesByDataset[id] ?? null;
      const completedSteps = new Set<CompletedStep>(["dataLoaded"]);
      if (cachedFeatures.length > 0 && cachedValues) {
        completedSteps.add("featuresGenerated");
      }
      return {
        activeDatasetId: id,
        dataset,
        selectedDatasetIds: state.selectedDatasetIds.includes(id)
          ? state.selectedDatasetIds
          : [...state.selectedDatasetIds, id],
        features: cachedFeatures,
        featureValues: cachedValues,
        researchFeatures: [],
        researchFeatureValues: null,
        researchContextDatasetIds: [],
        researchTotalBars: 0,
        patterns: [],
        validationResults: [],
        report: null,
        discoveryProgress: DEFAULT_PROGRESS,
        completedSteps,
        activeTab: cachedFeatures.length > 0 ? "discovery" : "features",
        lastError: null,
      };
    });
  },

  setTargetMode: (targetMode) => {
    set((state) => ({
      targetMode,
      selectedDatasetIds:
        targetMode === "single" &&
        state.activeDatasetId &&
        !state.selectedDatasetIds.includes(state.activeDatasetId)
          ? [...state.selectedDatasetIds, state.activeDatasetId]
          : state.selectedDatasetIds,
      patterns: [],
      validationResults: [],
      report: null,
      discoveryProgress: DEFAULT_PROGRESS,
    }));
  },

  toggleDatasetSelected: (id) =>
    set((state) => {
      if (state.targetMode === "single" && id === state.activeDatasetId) {
        return {};
      }
      if (
        state.targetMode === "all" &&
        state.selectedDatasetIds.includes(id) &&
        state.selectedDatasetIds.length === 1
      ) {
        return {};
      }
      const completedSteps = new Set<CompletedStep>(["dataLoaded"]);
      if (state.features.length > 0 && state.featureValues) {
        completedSteps.add("featuresGenerated");
      }
      return {
        selectedDatasetIds: state.selectedDatasetIds.includes(id)
          ? state.selectedDatasetIds.filter((datasetId) => datasetId !== id)
          : [...state.selectedDatasetIds, id],
        patterns: [],
        validationResults: [],
        crossReferenceResults: [],
        report: null,
        completedSteps,
      };
    }),

  renameDataset: (id, label) => {
    set((state) => {
      const datasets = state.datasets.map((d) =>
        d.id === id ? { ...d, label } : d,
      );
      const dataset =
        state.activeDatasetId === id
          ? (datasets.find((d) => d.id === id) ?? state.dataset)
          : state.dataset;
      return { datasets, dataset };
    });
  },

  loadDataset: (dataset) => {
    get().addDataset(dataset);
  },

  loadSampleDataset: () => {
    const sample = getSampleDataset();
    get().addDataset(sample);
  },

  generateFeaturesAction: () => {
    const { dataset, datasets, selectedDatasetIds, targetMode } = get();
    if (!dataset) return;
    set({ isComputing: true, lastError: null });
    // Defer to next tick so the UI can show a loading state.
    setTimeout(() => {
      try {
        const included = datasets.filter((candidate) =>
          selectedDatasetIds.includes(candidate.id),
        );
        if (
          targetMode === "single" &&
          !included.some((candidate) => candidate.id === dataset.id)
        ) {
          included.unshift(dataset);
        }
        if (included.length === 0) included.push(dataset);
        const featuresByDataset: Record<string, Feature[]> = {};
        const featureValuesByDataset: Record<string, FeatureMatrix> = {};
        for (const candidate of included) {
          const generated = buildDatasetFeatures(
            candidate,
            get().featureOverrides,
          );
          featuresByDataset[candidate.id] = generated.features;
          featureValuesByDataset[candidate.id] = generated.matrix;
        }
        const features = featuresByDataset[dataset.id] ?? [];
        const featureValues = featureValuesByDataset[dataset.id] ?? null;
        const availableCategories = [
          ...new Set(
            Object.values(featuresByDataset)
              .flat()
              .map((feature) => feature.category),
          ),
        ];
        const completed = new Set<CompletedStep>(get().completedSteps);
        completed.add("dataLoaded");
        completed.add("featuresGenerated");
        set({
          features,
          featureValues,
          featuresByDataset,
          featureValuesByDataset,
          discoveryConfig: {
            ...get().discoveryConfig,
            enabledCategories: availableCategories,
          },
          isComputing: false,
          completedSteps: completed,
          // Clear downstream results since features changed.
          patterns: [],
          researchFeatures: [],
          researchFeatureValues: null,
          researchContextDatasetIds: [],
          researchTotalBars: included.reduce(
            (sum, candidate) => sum + candidate.bars.length,
            0,
          ),
          validationResults: [],
          crossReferenceResults: [],
          report: null,
        });
      } catch (e) {
        set({
          isComputing: false,
          lastError:
            e instanceof Error ? e.message : "Failed to generate features.",
        });
      }
    }, 10);
  },

  setFeatureEnabled: (featureId, enabled) => {
    set((state) => {
      const update = (catalog: Feature[]) =>
        catalog.map((feature) =>
          feature.id === featureId ? { ...feature, enabled } : feature,
        );
      return {
        features: update(state.features),
        featuresByDataset: Object.fromEntries(
          Object.entries(state.featuresByDataset).map(
            ([datasetId, catalog]) => [datasetId, update(catalog)],
          ),
        ),
        researchFeatures: [],
        researchFeatureValues: null,
        researchContextDatasetIds: [],
        patterns: [],
        validationResults: [],
        report: null,
      };
    });
  },

  setFeatureCategoryEnabled: (category, enabled) => {
    set((state) => {
      const update = (catalog: Feature[]) =>
        catalog.map((feature) =>
          feature.category === category ? { ...feature, enabled } : feature,
        );
      return {
        features: update(state.features),
        featuresByDataset: Object.fromEntries(
          Object.entries(state.featuresByDataset).map(
            ([datasetId, catalog]) => [datasetId, update(catalog)],
          ),
        ),
        researchFeatures: [],
        researchFeatureValues: null,
        researchContextDatasetIds: [],
        patterns: [],
        validationResults: [],
        report: null,
      };
    });
  },

  runDiscoveryAction: async () => {
    const {
      dataset,
      discoveryConfig,
      datasets,
      selectedDatasetIds,
      featuresByDataset,
      featureValuesByDataset,
      targetMode,
    } = get();
    if (!dataset) return;
    if (
      targetMode === "single" &&
      (!featuresByDataset[dataset.id]?.length ||
        !featureValuesByDataset[dataset.id])
    ) {
      return;
    }
    if (
      targetMode === "all" &&
      !selectedDatasetIds.some(
        (id) =>
          (featuresByDataset[id]?.length ?? 0) > 0 &&
          featureValuesByDataset[id],
      )
    ) {
      return;
    }
    const selectedDatasets = datasets.filter((candidate) =>
      targetMode === "all"
        ? selectedDatasetIds.includes(candidate.id)
        : candidate.id === dataset.id ||
          selectedDatasetIds.includes(candidate.id),
    );
    const targets =
      targetMode === "all" && selectedDatasets.length > 1
        ? selectedDatasets
        : [dataset];
    cancelFlag = { cancelled: false };
    set({
      isComputing: true,
      lastError: null,
      discoveryProgress: { ...DEFAULT_PROGRESS, isRunning: true },
      patterns: [],
      researchFeatures: [],
      researchFeatureValues: null,
      researchContextDatasetIds: selectedDatasets
        .filter((candidate) => candidate.id !== targets[0].id)
        .map((candidate) => candidate.id),
      researchTotalBars: selectedDatasets.reduce(
        (sum, candidate) => sum + candidate.rowCount,
        0,
      ),
    });

    try {
      const allPatterns: Pattern[] = [];
      const allValidationResults: ValidationResult[] = [];
      const budgetPerTarget = Math.max(
        1,
        Math.floor(discoveryConfig.maxCombinations / targets.length),
      );
      let completedBudget = 0;
      for (const target of targets) {
        const research = buildMultiTimeframeResearchSpace(
          target,
          selectedDatasets,
          featuresByDataset,
          featureValuesByDataset,
        );
        const targetLabel = target.label ?? target.name;
        // Discovery is trained strictly on the oldest 70%. Candidate
        // thresholds, combinations, direction, and ranking cannot see the
        // newest 30%, which remains genuinely untouched until validation.
        const discoveryEnd = Math.max(
          discoveryConfig.horizon + 2,
          Math.floor(target.bars.length * 0.7),
        );
        const discoveryBars = target.bars.slice(0, discoveryEnd);
        const discoveryMatrix: FeatureMatrix = Object.fromEntries(
          Object.entries(research.matrix).map(([featureId, values]) => [
            featureId,
            prefixSeries(values, discoveryEnd),
          ]),
        );
        const discovered = await runDiscovery(
          discoveryBars,
          research.features,
          discoveryMatrix,
          { ...discoveryConfig, maxCombinations: budgetPerTarget },
          (progress) => {
            set({
              discoveryProgress: {
                ...progress,
                tested: completedBudget + progress.tested,
                total: budgetPerTarget * targets.length,
                current: `[${target.timeframe} · ${targetLabel}] ${progress.current}`,
              },
            });
          },
          () => cancelFlag.cancelled,
          get().featureOverrides,
          target.outcomeLabel,
        );
        if (cancelFlag.cancelled) break;
        const tagged = discovered.map((pattern) => ({
          ...pattern,
          id: `${target.id}__${pattern.id}`,
          targetDatasetId: target.id,
          targetDatasetLabel: targetLabel,
          targetTimeframe: target.timeframe,
          coverage: pattern.coverage
            ? {
                ...pattern.coverage,
                occurrencesPerSymbol: {
                  [target.instrumentKey || targetLabel]:
                    pattern.coverage.totalOccurrences,
                },
                occurrencesPerTimeframe: {
                  [target.timeframe]: pattern.coverage.totalOccurrences,
                },
              }
            : undefined,
        }));
        // Unified mode already makes every selected timeline a target pass.
        // Explicit-target mode additionally computes cross-source survival,
        // but does so one aligned timeline at a time.
        const validation =
          targetMode === "single"
            ? await validateMemoryBounded(
                target,
                selectedDatasets,
                featuresByDataset,
                featureValuesByDataset,
                tagged.slice(0, 20),
                discoveryConfig.horizon,
              )
            : validatePatterns(
                target,
                research.features,
                research.matrix,
                tagged.slice(0, 20),
                [],
              );
        const validationByPattern = new Map(
          validation.map((result) => [result.patternId, result]),
        );
        allPatterns.push(
          ...tagged.map((pattern) => {
            const result = validationByPattern.get(pattern.id);
            return {
              ...pattern,
              validationStatus: result
                ? result.degraded
                  ? ("degraded" as const)
                  : ("held" as const)
                : ("not-tested" as const),
              confidence: result?.degraded
                ? ("low" as const)
                : pattern.confidence,
            };
          }),
        );
        allValidationResults.push(...validation);
        completedBudget += budgetPerTarget;
      }
      if (cancelFlag.cancelled) {
        set({
          isComputing: false,
          discoveryProgress: { ...get().discoveryProgress, isRunning: false },
        });
        return;
      }
      const completed = new Set<CompletedStep>(get().completedSteps);
      completed.add("discoveryComplete");
      completed.add("validationComplete");
      set({
        patterns: allPatterns.sort((a, b) => b.score - a.score).slice(0, 100),
        validationResults: allValidationResults,
        isComputing: false,
        discoveryProgress: { ...get().discoveryProgress, isRunning: false },
        completedSteps: completed,
      });
    } catch (e) {
      set({
        isComputing: false,
        lastError:
          e instanceof Error
            ? e.message
            : "Discovery failed unexpectedly. The run was stopped.",
        discoveryProgress: { ...get().discoveryProgress, isRunning: false },
      });
    } finally {
      // Defensive: guarantee isComputing is never left true regardless of
      // which path (success / error / early return) the try/catch took.
      if (get().isComputing) {
        set({ isComputing: false });
      }
    }
  },

  validateAction: async () => {
    const {
      dataset,
      datasets,
      selectedDatasetIds,
      featuresByDataset,
      featureValuesByDataset,
      patterns,
      discoveryConfig,
      targetMode,
    } = get();
    if (!dataset || !patterns.length) return;
    set({ isComputing: true, lastError: null });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      const topPatterns = patterns.slice(0, 20);
      const selectedDatasets = datasets.filter((candidate) =>
        targetMode === "all"
          ? selectedDatasetIds.includes(candidate.id)
          : candidate.id === dataset.id ||
            selectedDatasetIds.includes(candidate.id),
      );
      const patternsByTarget = new Map<string, Pattern[]>();
      for (const pattern of topPatterns) {
        const targetId = pattern.targetDatasetId ?? dataset.id;
        const group = patternsByTarget.get(targetId) ?? [];
        group.push(pattern);
        patternsByTarget.set(targetId, group);
      }
      const results: ValidationResult[] = [];
      for (const [targetId, targetPatterns] of patternsByTarget) {
        const target =
          selectedDatasets.find((candidate) => candidate.id === targetId) ??
          dataset;
        results.push(
          ...(await validateMemoryBounded(
            target,
            selectedDatasets,
            featuresByDataset,
            featureValuesByDataset,
            targetPatterns,
            discoveryConfig.horizon,
          )),
        );
      }
      const completed = new Set<CompletedStep>(get().completedSteps);
      completed.add("validationComplete");
      const validationByPattern = new Map(
        results.map((result) => [result.patternId, result]),
      );
      set({
        validationResults: results,
        patterns: patterns.map((pattern) => {
          const validation = validationByPattern.get(pattern.id);
          if (!validation) return pattern;
          return {
            ...pattern,
            validationStatus: validation.degraded
              ? ("degraded" as const)
              : ("held" as const),
            confidence: validation.degraded
              ? ("low" as const)
              : pattern.confidence,
          };
        }),
        isComputing: false,
        completedSteps: completed,
      });
    } catch (e) {
      set({
        isComputing: false,
        lastError: e instanceof Error ? e.message : "Validation failed.",
      });
    }
  },

  generateReportAction: () => {
    const {
      dataset,
      features,
      patterns,
      validationResults,
      crossReferenceResults,
      datasets,
      selectedDatasetIds,
      researchFeatures,
    } = get();
    if (!dataset || !features.length) return;
    try {
      const report = generateReport(
        dataset,
        researchFeatures.length > 0 ? researchFeatures : features,
        patterns,
        validationResults,
        crossReferenceResults,
        datasets.filter((candidate) =>
          selectedDatasetIds.includes(candidate.id),
        ),
      );
      const completed = new Set<CompletedStep>(get().completedSteps);
      completed.add("reportReady");
      set({ report, completedSteps: completed });
    } catch (e) {
      set({
        lastError: e instanceof Error ? e.message : "Report generation failed.",
      });
    }
  },

  runCrossReferenceAction: async (config) => {
    const { datasets } = get();
    if (config.datasetIds.length < 2) return;
    set({
      isCrossReferencing: true,
      lastError: null,
      crossReferenceResults: [],
    });
    try {
      const results = await runCrossReference(datasets, config);
      const completed = new Set<CompletedStep>(get().completedSteps);
      completed.add("crossReferenceComplete");
      set({ crossReferenceResults: results, completedSteps: completed });
    } catch (e) {
      set({
        lastError:
          e instanceof Error
            ? e.message
            : "Cross-reference failed unexpectedly. The run was stopped.",
      });
    } finally {
      // Defensive: guarantee isCrossReferencing is never left true.
      if (get().isCrossReferencing) {
        set({ isCrossReferencing: false });
      }
    }
  },

  clearCrossReferenceResults: () => {
    set({ crossReferenceResults: [] });
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  updateConfig: (patch) => {
    set({
      discoveryConfig: { ...get().discoveryConfig, ...patch },
    });
  },

  cancelDiscovery: () => {
    cancelFlag.cancelled = true;
    set({
      discoveryProgress: { ...get().discoveryProgress, isRunning: false },
      isComputing: false,
    });
  },

  resetSession: () => {
    cancelFlag = { cancelled: false };
    set({
      dataset: null,
      datasets: [],
      activeDatasetId: null,
      selectedDatasetIds: [],
      features: [],
      featureValues: null,
      featuresByDataset: {},
      featureValuesByDataset: {},
      researchFeatures: [],
      researchFeatureValues: null,
      researchContextDatasetIds: [],
      researchTotalBars: 0,
      patterns: [],
      validationResults: [],
      crossReferenceResults: [],
      isCrossReferencing: false,
      report: null,
      discoveryConfig: DEFAULT_CONFIG,
      discoveryProgress: DEFAULT_PROGRESS,
      activeTab: "features",
      completedSteps: new Set<CompletedStep>(),
      isComputing: false,
      lastError: null,
    });
    // No sample dataset is force-loaded here. The user must explicitly load
    // data via the Data Intake panel (per user preference).
  },

  // ---- Feature override actions ----
  setFeatureOverride: (featureId, override) =>
    set((state) => ({
      featureOverrides: { ...state.featureOverrides, [featureId]: override },
    })),

  clearFeatureOverride: (featureId) =>
    set((state) => {
      const next = { ...state.featureOverrides };
      delete next[featureId];
      return { featureOverrides: next };
    }),

  clearAllOverrides: () => set({ featureOverrides: {} }),

  // ---- Saved runs actions ----
  saveRunAction: async (actor, name) => {
    if (!actor) {
      set({ saveRunError: "Please sign in to save runs." });
      return;
    }
    set({ saveRunLoading: true, saveRunError: null });
    try {
      const state = get();
      const config = state.discoveryConfig;
      const datasets = state.datasets || [];
      const patterns = state.patterns || [];
      const validationResults = state.validationResults || [];
      const report = state.report;
      const serializedConfig = {
        minMfeMaeRatio: config.minMfeMaeRatio,
        horizon: BigInt(config.horizon),
        mfeMaeWindow: BigInt(config.mfeMaeWindow),
        mfeMaeRatioEnabled: config.mfeMaeRatioEnabled ?? true,
        minSampleSize: BigInt(config.minSampleSize),
        maxDepth: BigInt(config.maxDepth),
        minWinRate: config.minWinRate,
      };
      const serializedPatterns = patterns.map((p, i) => ({
        id: String(p.id ?? i),
        name: p.label ?? "",
        mfeMaeRatio: p.mfeMaeRatio ?? 0,
        plainEnglishSentence: p.plainEnglishSentence ?? "",
        coverage: p.coverage?.percentOfHistoryContainingOccurrences ?? 0,
        winRate: p.winRate ?? 0,
      }));
      const serializedDatasets = datasets.map((d) => ({
        id: d.id ?? d.name,
        name: d.name,
      }));
      const serializedValidation =
        validationResults.length > 0
          ? {
              outOfSampleWinRate:
                validationResults[0].outOfSampleMetrics?.winRate ?? 0,
              inSampleWinRate:
                validationResults[0].inSampleMetrics?.winRate ?? 0,
              byMarketCondition: [],
            }
          : {
              outOfSampleWinRate: 0,
              inSampleWinRate: 0,
              byMarketCondition: [],
            };
      const serializedReport = {
        summary: report?.summary ?? "",
        generatedAtNs: BigInt(Date.now() * 1_000_000),
      };
      const savedRun = {
        id: BigInt(0),
        owner: Principal.anonymous(),
        name,
        savedAtNs: BigInt(Date.now() * 1_000_000),
        config: serializedConfig,
        datasets: serializedDatasets,
        patterns: serializedPatterns,
        validation: serializedValidation,
        report: serializedReport,
      };
      await actor.saveRun(savedRun);
      set({ saveRunLoading: false });
    } catch (e) {
      set({
        saveRunLoading: false,
        saveRunError: e instanceof Error ? e.message : "Failed to save run",
      });
    }
  },

  loadSavedRunsAction: async (actor) => {
    if (!actor) {
      set({ savedRunsError: "Please sign in to view saved runs." });
      return;
    }
    set({ savedRunsLoading: true, savedRunsError: null });
    try {
      const result = await actor.listMyRunSummaries();
      const mapped = result.map((r) => ({
        id: Number(r.id),
        name: r.name,
        savedAtNs: Number(r.savedAtNs),
        datasetName: r.datasetName,
        patternCount: Number(r.patternCount),
        configSummary: r.configSummary,
      }));
      set({ savedRuns: mapped, savedRunsLoading: false });
    } catch (e) {
      set({
        savedRunsLoading: false,
        savedRunsError: e instanceof Error ? e.message : "Failed to load runs",
      });
    }
  },

  loadRunAction: async (actor, runId) => {
    if (!actor) {
      set({ savedRunsError: "Please sign in to load runs." });
      return;
    }
    try {
      const result = await actor.getMyRun(BigInt(runId));
      if (!result) {
        set({ savedRunsError: "Run not found." });
        return;
      }

      // ---- Config: merge with defaults and coerce bigint fields to numbers ----
      const restoredConfig: DiscoveryConfig = {
        ...DEFAULT_CONFIG,
        ...result.config,
        horizon: Number(result.config.horizon),
        mfeMaeWindow: Number(result.config.mfeMaeWindow),
        minSampleSize: Number(result.config.minSampleSize),
        maxDepth: Number(result.config.maxDepth),
      };

      // ---- Datasets: restore metadata only (bars stay empty — the backend
      // does not persist full OHLCV data). The active dataset is the first
      // restored dataset, if any. ----
      const restoredDatasets: Dataset[] = result.datasets.map((d) => ({
        id: d.id,
        name: d.name,
        bars: [],
        originalColumns: [],
        columns: [],
        timeframe: "unknown" as const,
        intervalMs: 0,
        instrumentKey: d.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        hasOHLC: false,
        hasVolume: false,
        outcomeColumnKey: "",
        outcomeLabel: "uploaded value",
        dateRange: { start: 0, end: 0 },
        rowCount: 0,
      }));
      const activeDataset =
        restoredDatasets.length > 0 ? restoredDatasets[0] : null;

      // ---- Patterns: restore directly from the backend SavedRun.patterns
      // array instead of re-running discovery on empty bars (which would
      // produce zero patterns). The backend Pattern only persists a subset
      // of the frontend Pattern fields (id, name, mfeMaeRatio,
      // plainEnglishSentence, coverage, winRate); the missing fields
      // (conditions, matches, etc.) are set to empty/null and the
      // null-safe guards in PatternResultsTable / PatternDetailModal render
      // "—" for them. ----
      const restoredPatterns: Pattern[] = (result.patterns ?? []).map(
        (p, i) => ({
          id: p.id ?? String(i),
          conditions: [],
          label: p.name ?? "",
          direction: "neutral",
          winRate: p.winRate ?? 0,
          avgMove: 0,
          avgMAE: 0,
          avgMFE: 0,
          sampleSize: 0,
          confidence: "low",
          score: 0,
          horizon: restoredConfig.horizon,
          mfeMaeRatio: p.mfeMaeRatio ?? 0,
          plainEnglishSentence: p.plainEnglishSentence ?? "",
          coverage: {
            earliestTimestamp: 0,
            latestTimestamp: 0,
            totalBarsExamined: 0,
            totalOccurrences: 0,
            occurrencesPerSymbol: {},
            occurrencesPerTimeframe: {},
            occurrencesByPeriod: [],
            firstOccurrence: 0,
            mostRecentOccurrence: 0,
            percentOfHistoryContainingOccurrences: p.coverage ?? 0,
            performanceConsistentAcrossSpan: false,
            concentrationFlags: [],
            isBroadlyValidated: false,
            pooledResult: { winRate: 0, avgMove: 0, sampleSize: 0 },
            equalSymbolResult: { winRate: 0, avgMove: 0, sampleSize: 0 },
          },
        }),
      );

      // ---- Validation: the backend persists a single ValidationResult
      // (outOfSampleWinRate, inSampleWinRate, byMarketCondition) which does
      // not map cleanly onto the richer frontend ValidationResult shape
      // (per-pattern inSample/outOfSample metrics, byYear, condition
      // breakdowns, etc.). Rather than fabricate partial metrics, leave
      // validationResults empty — the Validation page has empty-state
      // handling. ----
      const restoredValidationResults: ValidationResult[] = [];

      // ---- Report: the backend Report only persists summary and
      // generatedAtNs, while the frontend Report requires sections,
      // datasetName, and topDiscoveries. Set to null when the backend
      // summary is empty — the Report page has empty-state handling. ----
      const backendReport = result.report;
      const restoredReport: Report | null = backendReport?.summary
        ? {
            generatedAt: Number(backendReport.generatedAtNs),
            sections: [],
            summary: backendReport.summary,
            datasetName: activeDataset?.name ?? "",
            topDiscoveries: [],
          }
        : null;

      // ---- Completed steps: unlock the discovery/validation/report tabs so
      // the user can navigate to the restored patterns without re-running
      // discovery. ----
      const completed = new Set<CompletedStep>([
        "dataLoaded",
        "featuresGenerated",
        "discoveryComplete",
      ]);

      set({
        discoveryConfig: restoredConfig,
        datasets: restoredDatasets,
        activeDatasetId: activeDataset?.id ?? null,
        selectedDatasetIds: restoredDatasets.map((dataset) => dataset.id),
        dataset: activeDataset,
        // Features are not persisted by the backend; clear them so the
        // Features tab reflects the (empty) restored state rather than a
        // stale prior session's features.
        features: [],
        featureValues: null,
        featuresByDataset: {},
        featureValuesByDataset: {},
        researchFeatures: [],
        researchFeatureValues: null,
        researchContextDatasetIds: [],
        researchTotalBars: 0,
        patterns: restoredPatterns,
        validationResults: restoredValidationResults,
        report: restoredReport,
        crossReferenceResults: [],
        discoveryProgress: DEFAULT_PROGRESS,
        completedSteps: completed,
        activeTab: "discovery",
        lastError: null,
      });
    } catch (e) {
      set({
        savedRunsError: e instanceof Error ? e.message : "Failed to load run",
      });
    }
  },

  deleteRunAction: async (actor, runId) => {
    if (!actor) {
      set({ savedRunsError: "Please sign in to delete runs." });
      return;
    }
    try {
      await actor.deleteMyRun(BigInt(runId));
      await get().loadSavedRunsAction(actor);
    } catch (e) {
      set({
        savedRunsError: e instanceof Error ? e.message : "Failed to delete run",
      });
    }
  },
}));

// No module-init sample-dataset preload. The app starts on an empty state
// and the user loads data explicitly via the Data Intake panel.
