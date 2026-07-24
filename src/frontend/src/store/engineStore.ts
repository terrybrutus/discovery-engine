import type { Backend } from "@/backend";
import { runCrossReference } from "@/lib/crossReference";
import { runDiscovery } from "@/lib/discovery";
import {
  type FeatureOverride,
  type FeatureOverrides,
  computeFeatureValues,
  generateFeatures,
} from "@/lib/features";
import type { CustomColumn } from "@/lib/features";
import { generateReport } from "@/lib/report";
import { getSampleDataset } from "@/lib/sampleData";
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
  features: Feature[];
  featureValues: FeatureMatrix | null;
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
  /** Rename a dataset's user-facing label. */
  renameDataset: (id: string, label: string) => void;
  /** Backward-compatible: equivalent to addDataset. */
  loadDataset: (dataset: Dataset) => void;
  loadSampleDataset: () => void;
  generateFeaturesAction: () => void;
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
let cachedFeatureCategories: FeatureCategory[] = [...BUILTIN_CATEGORIES];

export function selectFeatureCategories(state: EngineState): FeatureCategory[] {
  if (state.features === cachedCategoryFeatures) {
    return cachedFeatureCategories;
  }

  const categorySet = new Set<FeatureCategory>(BUILTIN_CATEGORIES);
  for (const feature of state.features) {
    categorySet.add(feature.category);
  }
  cachedCategoryFeatures = state.features;
  cachedFeatureCategories = [...categorySet];
  return cachedFeatureCategories;
}

// Cancellation flag held outside React state to avoid re-renders.
let cancelFlag = { cancelled: false };

export const useEngineStore = create<EngineState>((set, get) => ({
  dataset: null,
  datasets: [],
  activeDatasetId: null,
  features: [],
  featureValues: null,
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
        dataset,
        features: [],
        featureValues: null,
        patterns: [],
        validationResults: [],
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
      let activeDatasetId = state.activeDatasetId;
      let dataset = state.dataset;
      if (activeDatasetId === id) {
        activeDatasetId =
          datasets.length > 0 ? datasets[datasets.length - 1].id : null;
        dataset = activeDatasetId
          ? (datasets.find((d) => d.id === activeDatasetId) ?? null)
          : null;
      }
      // If the active dataset changed, clear downstream computation.
      const clearedDownstream =
        activeDatasetId !== state.activeDatasetId
          ? {
              features: [] as Feature[],
              featureValues: null as FeatureMatrix | null,
              patterns: [] as Pattern[],
              validationResults: [] as ValidationResult[],
              report: null as Report | null,
              completedSteps: dataset
                ? new Set<CompletedStep>(["dataLoaded"])
                : new Set<CompletedStep>(),
            }
          : {};
      return { datasets, activeDatasetId, dataset, ...clearedDownstream };
    });
  },

  setActiveDataset: (id) => {
    set((state) => {
      const dataset = state.datasets.find((d) => d.id === id) ?? null;
      if (!dataset || id === state.activeDatasetId) return {};
      return {
        activeDatasetId: id,
        dataset,
        features: [],
        featureValues: null,
        patterns: [],
        validationResults: [],
        report: null,
        discoveryProgress: DEFAULT_PROGRESS,
        completedSteps: new Set<CompletedStep>(["dataLoaded"]),
        activeTab: "features",
        lastError: null,
      };
    });
  },

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
    const { dataset } = get();
    if (!dataset) return;
    set({ isComputing: true, lastError: null });
    // Defer to next tick so the UI can show a loading state.
    setTimeout(() => {
      try {
        // Build the list of custom uploaded numeric columns (excluding the
        // standard OHLCV/time columns) so they flow into the feature catalog
        // as their own "Custom Columns" features. `label` is the original
        // header (preserved verbatim per user preference); `key` is the
        // normalized key matching Dataset.columnValues.
        const customColumns: CustomColumn[] = (dataset.columns ?? [])
          .filter((c) => c.type === "numeric")
          .map((c) => ({ label: c.label, key: c.key }));
        const features = generateFeatures(
          dataset.bars,
          customColumns,
          get().featureOverrides,
        );
        const featureValues = computeFeatureValues(
          dataset.bars,
          features,
          dataset.columnValues ?? {},
        );
        const completed = new Set<CompletedStep>(get().completedSteps);
        completed.add("dataLoaded");
        completed.add("featuresGenerated");
        set({
          features,
          featureValues,
          isComputing: false,
          completedSteps: completed,
          // Clear downstream results since features changed.
          patterns: [],
          validationResults: [],
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

  runDiscoveryAction: async () => {
    const { dataset, features, featureValues, discoveryConfig } = get();
    if (!dataset || !features.length || !featureValues) return;

    cancelFlag = { cancelled: false };
    set({
      isComputing: true,
      lastError: null,
      discoveryProgress: { ...DEFAULT_PROGRESS, isRunning: true },
      patterns: [],
    });

    try {
      // runDiscovery yields to the main thread between chunks via real
      // setTimeout(0) awaits, so the browser stays responsive on large
      // datasets. Any throw here is caught below and resets isComputing.
      const patterns = await runDiscovery(
        dataset.bars,
        features,
        featureValues,
        discoveryConfig,
        (progress) => {
          set({ discoveryProgress: progress });
        },
        () => cancelFlag.cancelled,
        get().featureOverrides,
      );

      const completed = new Set<CompletedStep>(get().completedSteps);
      completed.add("discoveryComplete");
      set({
        patterns,
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

  validateAction: () => {
    const { dataset, features, featureValues, patterns } = get();
    if (!dataset || !features.length || !featureValues || !patterns.length)
      return;
    set({ isComputing: true, lastError: null });
    setTimeout(() => {
      try {
        const topPatterns = patterns.slice(0, 20);
        const results = validatePatterns(
          dataset,
          features,
          featureValues,
          topPatterns,
        );
        const completed = new Set<CompletedStep>(get().completedSteps);
        completed.add("validationComplete");
        set({
          validationResults: results,
          isComputing: false,
          completedSteps: completed,
        });
      } catch (e) {
        set({
          isComputing: false,
          lastError: e instanceof Error ? e.message : "Validation failed.",
        });
      }
    }, 10);
  },

  generateReportAction: () => {
    const {
      dataset,
      features,
      patterns,
      validationResults,
      crossReferenceResults,
    } = get();
    if (!dataset || !features.length) return;
    try {
      const report = generateReport(
        dataset,
        features,
        patterns,
        validationResults,
        crossReferenceResults,
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
      features: [],
      featureValues: null,
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
        dataset: activeDataset,
        // Features are not persisted by the backend; clear them so the
        // Features tab reflects the (empty) restored state rather than a
        // stale prior session's features.
        features: [],
        featureValues: null,
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
