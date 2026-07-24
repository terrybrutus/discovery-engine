import { createActor } from "@/backend";
import type { Backend } from "@/backend";
import { useEngineStore } from "@/store/engineStore";
import type { SavedRunSummary } from "@/types";
import { useActor, useInternetIdentity } from "@caffeineai/core-infrastructure";
import { type ReactNode, useEffect, useMemo, useState } from "react";

/**
 * Format a nanosecond timestamp (from the IC canister `Time.now()`) into a
 * readable local date/time string.
 */
function formatTimestamp(ns: number): string {
  const ms = Number(ns) / 1_000_000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * SavedRunsPage — lists every discovery run the signed-in user has persisted.
 * Users can load a run back into the discovery page or delete it. Unauthenticated
 * visitors see a sign-in prompt; no run data leaves the browser until login.
 */
export function SavedRunsPage() {
  const { actor } = useActor<Backend>(createActor);
  const { login, isLoggingIn, isAuthenticated } = useInternetIdentity();

  const savedRuns = useEngineStore((s) => s.savedRuns);
  const savedRunsLoading = useEngineStore((s) => s.savedRunsLoading);
  const savedRunsError = useEngineStore((s) => s.savedRunsError);
  const loadSavedRunsAction = useEngineStore((s) => s.loadSavedRunsAction);
  const loadRunAction = useEngineStore((s) => s.loadRunAction);
  const deleteRunAction = useEngineStore((s) => s.deleteRunAction);

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [loadingRunId, setLoadingRunId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isSignedIn = isAuthenticated && actor !== null;

  // Fetch the saved runs list on mount when the user is signed in.
  useEffect(() => {
    if (isSignedIn && actor !== null) {
      loadSavedRunsAction(actor);
    }
  }, [isSignedIn, actor, loadSavedRunsAction]);

  const sortedRuns = useMemo<SavedRunSummary[]>(() => {
    return [...savedRuns].sort((a, b) => b.savedAtNs - a.savedAtNs);
  }, [savedRuns]);

  const handleLoad = async (run: SavedRunSummary): Promise<void> => {
    if (actor === null) return;
    setActionError(null);
    setLoadingRunId(run.id);
    try {
      await loadRunAction(actor, run.id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to load run.",
      );
    } finally {
      setLoadingRunId(null);
    }
  };

  const handleDelete = async (runId: number): Promise<void> => {
    if (actor === null) return;
    setActionError(null);
    setPendingDeleteId(null);
    try {
      await deleteRunAction(actor, runId);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to delete run.",
      );
    }
  };

  // --- Unauthenticated state -------------------------------------------------
  if (!isSignedIn) {
    return (
      <section className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card text-foreground-muted">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Sign in to view saved runs
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-foreground-muted">
            Saved discovery runs are tied to your Internet Identity. Sign in to
            load, review, and manage the runs you have persisted. No run data
            leaves your browser until you authenticate.
          </p>
        </div>
        <button
          type="button"
          onClick={login}
          disabled={isLoggingIn}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-subtle transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoggingIn ? (
            <>
              <Spinner className="h-4 w-4" />
              Connecting…
            </>
          ) : (
            "Sign in with Internet Identity"
          )}
        </button>
      </section>
    );
  }

  // --- Authenticated layout --------------------------------------------------
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Saved Runs
        </h1>
        <p className="text-sm text-foreground-muted">
          Discovery runs you have persisted to your Internet Identity. Load a
          run to restore its configuration and pattern results without
          re-running discovery.
        </p>
      </header>

      {actionError !== null && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 h-4 w-4 flex-shrink-0"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="font-mono">{actionError}</span>
        </div>
      )}

      {savedRunsLoading && savedRuns.length === 0 ? (
        <LoadingState />
      ) : savedRunsError !== null ? (
        <ErrorState message={savedRunsError} />
      ) : sortedRuns.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {sortedRuns.map((run) => (
            <li key={run.id}>
              <SavedRunRow
                run={run}
                isLoading={loadingRunId === run.id}
                pendingDelete={pendingDeleteId === run.id}
                onConfirmDelete={() => setPendingDeleteId(run.id)}
                onCancelDelete={() => setPendingDeleteId(null)}
                onConfirmDeleteFinal={() => handleDelete(run.id)}
                onLoad={() => handleLoad(run)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Sub-components ----------------------------------------------------------

interface SavedRunRowProps {
  run: SavedRunSummary;
  isLoading: boolean;
  pendingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDeleteFinal: () => void;
  onLoad: () => void;
}

function SavedRunRow({
  run,
  isLoading,
  pendingDelete,
  onConfirmDelete,
  onCancelDelete,
  onConfirmDeleteFinal,
  onLoad,
}: SavedRunRowProps) {
  return (
    <article className="rounded-lg border border-border bg-card p-5 shadow-subtle transition-colors hover:border-border-hover">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="truncate font-display text-lg font-semibold text-foreground">
              {run.name}
            </h2>
            <span className="font-mono text-xs tabular-nums text-foreground-muted">
              #{run.id}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Field label="Saved">
              <time
                dateTime={new Date(
                  Number(run.savedAtNs) / 1_000_000,
                ).toISOString()}
                className="font-mono tabular-nums text-foreground"
              >
                {formatTimestamp(run.savedAtNs)}
              </time>
            </Field>
            <Field label="Dataset">
              <span className="truncate font-mono text-foreground">
                {run.datasetName}
              </span>
            </Field>
            <Field label="Patterns">
              <span className="font-mono tabular-nums text-foreground">
                {run.patternCount.toLocaleString()}
              </span>
            </Field>
            <Field label="Config" full>
              <span className="block font-mono text-xs leading-relaxed text-foreground-muted">
                {run.configSummary}
              </span>
            </Field>
          </dl>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2 sm:flex-col sm:items-stretch">
          {pendingDelete ? (
            <div className="flex items-center gap-2 sm:flex-col">
              <span className="text-xs text-foreground-muted sm:text-center">
                Delete this run?
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onConfirmDeleteFinal}
                  className="rounded-md border border-destructive/40 bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={onCancelDelete}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={onLoad}
                disabled={isLoading}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <Spinner className="h-3.5 w-3.5" />
                    Loading…
                  </>
                ) : (
                  "Load"
                )}
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={isLoading}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={full ? "col-span-2 sm:col-span-3" : undefined}>
      <dt className="mb-0.5 text-xs uppercase tracking-wide text-foreground-muted">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-card/50 py-20 text-center">
      <Spinner className="h-7 w-7 text-foreground-muted" />
      <p className="text-sm text-foreground-muted">Loading saved runs…</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 py-16 text-center"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-8 w-8 text-destructive"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className="font-display text-base font-medium text-foreground">
        Could not load saved runs
      </p>
      <p className="max-w-md font-mono text-xs text-foreground-muted">
        {message}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-card/50 py-20 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-10 w-10 text-foreground-muted"
        aria-hidden="true"
      >
        <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
      </svg>
      <div className="space-y-1">
        <p className="font-display text-base font-medium text-foreground">
          No saved runs yet
        </p>
        <p className="max-w-sm text-sm text-foreground-muted">
          Run a discovery and save it to see it here. Saved runs let you restore
          a configuration and its pattern results without re-running discovery.
        </p>
      </div>
    </div>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? ""}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export default SavedRunsPage;
