import type { CandidateSystemOptimization } from "@/lib/candidateSystemOptimizer";
import type {
  CompletedStep,
  CrossReferenceResult,
  Dataset,
  DiscoveryConfig,
  DiscoverySearchAudit,
  MarketSessionConfig,
  Pattern,
  Report,
  TabId,
  ValidationResult,
} from "@/types";

const DATABASE_NAME = "trading-discovery-recovery";
const STORE_NAME = "workspace";
const CHECKPOINT_KEY = "active";
const VERSION = 1;

export interface WorkspaceCheckpoint {
  version: number;
  savedAt: number;
  datasets: Dataset[];
  activeDatasetId: string | null;
  selectedDatasetIds: string[];
  targetMode: "all" | "single";
  discoveryConfig: DiscoveryConfig;
  marketSessionConfig?: MarketSessionConfig;
  featureOverrides: Record<string, unknown>;
  patterns: Pattern[];
  validationResults: ValidationResult[];
  discoverySearchAudits: DiscoverySearchAudit[];
  crossReferenceResults: CrossReferenceResult[];
  report: Report | null;
  systemOptimizations?: Record<string, CandidateSystemOptimization>;
  completedSteps: CompletedStep[];
  activeTab: TabId;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkspaceCheckpoint(
  checkpoint: WorkspaceCheckpoint,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(checkpoint, CHECKPOINT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

export async function loadWorkspaceCheckpoint(): Promise<WorkspaceCheckpoint | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  const checkpoint = await new Promise<WorkspaceCheckpoint | null>(
    (resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(CHECKPOINT_KEY);
      request.onsuccess = () =>
        resolve((request.result as WorkspaceCheckpoint | undefined) ?? null);
      request.onerror = () => reject(request.error);
    },
  );
  database.close();
  return checkpoint?.version === VERSION ? checkpoint : null;
}

export async function clearWorkspaceCheckpoint(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(CHECKPOINT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
