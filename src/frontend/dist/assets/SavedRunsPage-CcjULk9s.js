import { G as useInternetIdentity, i as useEngineStore, r as reactExports, j as jsxRuntimeExports } from "./index-D4QMwWvE.js";
import { u as useActor, c as createActor } from "./backend-BLvpbG4-.js";
function formatTimestamp(ns) {
  const ms = Number(ns) / 1e6;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString(void 0, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
function SavedRunsPage() {
  const { actor } = useActor(createActor);
  const { identity, login, isLoggingIn } = useInternetIdentity();
  const savedRuns = useEngineStore((s) => s.savedRuns);
  const savedRunsLoading = useEngineStore((s) => s.savedRunsLoading);
  const savedRunsError = useEngineStore((s) => s.savedRunsError);
  const loadSavedRunsAction = useEngineStore((s) => s.loadSavedRunsAction);
  const loadRunAction = useEngineStore((s) => s.loadRunAction);
  const deleteRunAction = useEngineStore((s) => s.deleteRunAction);
  const [pendingDeleteId, setPendingDeleteId] = reactExports.useState(null);
  const [loadingRunId, setLoadingRunId] = reactExports.useState(null);
  const [actionError, setActionError] = reactExports.useState(null);
  const isSignedIn = identity !== null && actor !== null;
  reactExports.useEffect(() => {
    if (isSignedIn && actor !== null) {
      loadSavedRunsAction(actor);
    }
  }, [isSignedIn, actor, loadSavedRunsAction]);
  const sortedRuns = reactExports.useMemo(() => {
    return [...savedRuns].sort((a, b) => b.savedAtNs - a.savedAtNs);
  }, [savedRuns]);
  const handleLoad = async (run) => {
    if (actor === null) return;
    setActionError(null);
    setLoadingRunId(run.id);
    try {
      await loadRunAction(actor, run.id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to load run."
      );
    } finally {
      setLoadingRunId(null);
    }
  };
  const handleDelete = async (runId) => {
    if (actor === null) return;
    setActionError(null);
    setPendingDeleteId(null);
    try {
      await deleteRunAction(actor, runId);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to delete run."
      );
    }
  };
  if (!isSignedIn) {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-20 text-center", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card text-foreground-muted", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "svg",
        {
          xmlns: "http://www.w3.org/2000/svg",
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.5",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          className: "h-8 w-8",
          "aria-hidden": "true",
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "3", y: "11", width: "18", height: "11", rx: "2", ry: "2" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" })
          ]
        }
      ) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "font-display text-2xl font-semibold tracking-tight text-foreground", children: "Sign in to view saved runs" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "max-w-md text-sm leading-relaxed text-foreground-muted", children: "Saved discovery runs are tied to your Internet Identity. Sign in to load, review, and manage the runs you have persisted. No run data leaves your browser until you authenticate." })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          onClick: login,
          disabled: isLoggingIn,
          className: "inline-flex items-center gap-2 rounded-md border border-border bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-subtle transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60",
          children: isLoggingIn ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Spinner, { className: "h-4 w-4" }),
            "Connecting…"
          ] }) : "Sign in with Internet Identity"
        }
      )
    ] });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "mx-auto w-full max-w-5xl px-6 py-10", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "mb-8 flex flex-col gap-1", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "font-display text-2xl font-semibold tracking-tight text-foreground", children: "Saved Runs" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-foreground-muted", children: "Discovery runs you have persisted to your Internet Identity. Load a run to restore its configuration and pattern results without re-running discovery." })
    ] }),
    actionError !== null && /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "div",
      {
        role: "alert",
        className: "mb-6 flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "svg",
            {
              xmlns: "http://www.w3.org/2000/svg",
              viewBox: "0 0 24 24",
              fill: "none",
              stroke: "currentColor",
              strokeWidth: "1.5",
              strokeLinecap: "round",
              strokeLinejoin: "round",
              className: "mt-0.5 h-4 w-4 flex-shrink-0",
              "aria-hidden": "true",
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("circle", { cx: "12", cy: "12", r: "10" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("line", { x1: "12", y1: "8", x2: "12", y2: "12" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("line", { x1: "12", y1: "16", x2: "12.01", y2: "16" })
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono", children: actionError })
        ]
      }
    ),
    savedRunsLoading && savedRuns.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoadingState, {}) : savedRunsError !== null ? /* @__PURE__ */ jsxRuntimeExports.jsx(ErrorState, { message: savedRunsError }) : sortedRuns.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx(EmptyState, {}) : /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { className: "space-y-3", children: sortedRuns.map((run) => /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(
      SavedRunRow,
      {
        run,
        isLoading: loadingRunId === run.id,
        pendingDelete: pendingDeleteId === run.id,
        onConfirmDelete: () => setPendingDeleteId(run.id),
        onCancelDelete: () => setPendingDeleteId(null),
        onConfirmDeleteFinal: () => handleDelete(run.id),
        onLoad: () => handleLoad(run)
      }
    ) }, run.id)) })
  ] });
}
function SavedRunRow({
  run,
  isLoading,
  pendingDelete,
  onConfirmDelete,
  onCancelDelete,
  onConfirmDeleteFinal,
  onLoad
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("article", { className: "rounded-lg border border-border bg-card p-5 shadow-subtle transition-colors hover:border-border-hover", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0 flex-1 space-y-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-baseline gap-x-3 gap-y-1", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "truncate font-display text-lg font-semibold text-foreground", children: run.name }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono text-xs tabular-nums text-foreground-muted", children: [
          "#",
          run.id
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("dl", { className: "grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Field, { label: "Saved", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
          "time",
          {
            dateTime: new Date(
              Number(run.savedAtNs) / 1e6
            ).toISOString(),
            className: "font-mono tabular-nums text-foreground",
            children: formatTimestamp(run.savedAtNs)
          }
        ) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Field, { label: "Dataset", children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate font-mono text-foreground", children: run.datasetName }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Field, { label: "Patterns", children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono tabular-nums text-foreground", children: run.patternCount.toLocaleString() }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Field, { label: "Config", full: true, children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block font-mono text-xs leading-relaxed text-foreground-muted", children: run.configSummary }) })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-shrink-0 items-center gap-2 sm:flex-col sm:items-stretch", children: pendingDelete ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 sm:flex-col", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs text-foreground-muted sm:text-center", children: "Delete this run?" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            onClick: onConfirmDeleteFinal,
            className: "rounded-md border border-destructive/40 bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            children: "Confirm"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            onClick: onCancelDelete,
            className: "rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            children: "Cancel"
          }
        )
      ] })
    ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          onClick: onLoad,
          disabled: isLoading,
          className: "inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
          children: isLoading ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Spinner, { className: "h-3.5 w-3.5" }),
            "Loading…"
          ] }) : "Load"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          onClick: onConfirmDelete,
          disabled: isLoading,
          className: "inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
          children: "Delete"
        }
      )
    ] }) })
  ] }) });
}
function Field({
  label,
  full,
  children
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: full ? "col-span-2 sm:col-span-3" : void 0, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { className: "mb-0.5 text-xs uppercase tracking-wide text-foreground-muted", children: label }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { children })
  ] });
}
function LoadingState() {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-card/50 py-20 text-center", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(Spinner, { className: "h-7 w-7 text-foreground-muted" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-foreground-muted", children: "Loading saved runs…" })
  ] });
}
function ErrorState({ message }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      role: "alert",
      className: "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 py-16 text-center",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "1.5",
            strokeLinecap: "round",
            strokeLinejoin: "round",
            className: "h-8 w-8 text-destructive",
            "aria-hidden": "true",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("circle", { cx: "12", cy: "12", r: "10" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("line", { x1: "12", y1: "8", x2: "12", y2: "12" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("line", { x1: "12", y1: "16", x2: "12.01", y2: "16" })
            ]
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-display text-base font-medium text-foreground", children: "Could not load saved runs" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "max-w-md font-mono text-xs text-foreground-muted", children: message })
      ]
    }
  );
}
function EmptyState() {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-card/50 py-20 text-center", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.5",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        className: "h-10 w-10 text-foreground-muted",
        "aria-hidden": "true",
        children: /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" })
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-display text-base font-medium text-foreground", children: "No saved runs yet" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "max-w-sm text-sm text-foreground-muted", children: "Run a discovery and save it to see it here. Saved runs let you restore a configuration and its pattern results without re-running discovery." })
    ] })
  ] });
}
function Spinner({ className }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "svg",
    {
      className: `animate-spin ${className ?? ""}`,
      xmlns: "http://www.w3.org/2000/svg",
      fill: "none",
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "circle",
          {
            className: "opacity-25",
            cx: "12",
            cy: "12",
            r: "10",
            stroke: "currentColor",
            strokeWidth: "4"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "path",
          {
            className: "opacity-75",
            fill: "currentColor",
            d: "M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
          }
        )
      ]
    }
  );
}
export {
  SavedRunsPage,
  SavedRunsPage as default
};
