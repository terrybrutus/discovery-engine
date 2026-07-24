import { c as createLucideIcon, i as useEngineStore, r as reactExports, I as ue, j as jsxRuntimeExports, L as Layers, h as cn, B as Button, X } from "./index-D4QMwWvE.js";
import { E as EmptyState } from "./EmptyState-BitJLYM5.js";
import { C as Card, a as CardHeader, b as CardTitle, L as ListFilter, c as CardContent } from "./card-BKftrwgs.js";
import { P as Progress } from "./progress-qd8NrHmn.js";
import { P as Play } from "./play-DndWjt-y.js";
import { S as Sparkles } from "./sparkles-B6YI30ep.js";
/**
 * @license lucide-react v0.511.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const __iconNode = [
  ["circle", { cx: "5", cy: "6", r: "3", key: "1qnov2" }],
  ["path", { d: "M12 6h5a2 2 0 0 1 2 2v7", key: "1yj91y" }],
  ["path", { d: "m15 9-3-3 3-3", key: "1lwv8l" }],
  ["circle", { cx: "19", cy: "18", r: "3", key: "1qljk2" }],
  ["path", { d: "M12 18H7a2 2 0 0 1-2-2V9", key: "16sdep" }],
  ["path", { d: "m9 15 3 3-3 3", key: "1m3kbl" }]
];
const GitCompareArrows = createLucideIcon("git-compare-arrows", __iconNode);
function CrossReferencePage() {
  const datasets = useEngineStore((s) => s.datasets);
  const crossReferenceResults = useEngineStore((s) => s.crossReferenceResults);
  const isCrossReferencing = useEngineStore((s) => s.isCrossReferencing);
  const runCrossReferenceAction = useEngineStore(
    (s) => s.runCrossReferenceAction
  );
  const clearCrossReferenceResults = useEngineStore(
    (s) => s.clearCrossReferenceResults
  );
  const completedSteps = useEngineStore((s) => s.completedSteps);
  const [selectedDatasetIds, setSelectedDatasetIds] = reactExports.useState([]);
  const [selectedColumns, setSelectedColumns] = reactExports.useState([]);
  const hasRun = completedSteps.has("crossReferenceComplete");
  const hasResults = crossReferenceResults.length > 0;
  const availableColumns = reactExports.useMemo(() => {
    const set = /* @__PURE__ */ new Set();
    for (const id of selectedDatasetIds) {
      const ds = datasets.find((d) => d.id === id);
      if (ds) {
        for (const col of ds.originalColumns) set.add(col);
      }
    }
    return Array.from(set);
  }, [selectedDatasetIds, datasets]);
  reactExports.useEffect(() => {
    setSelectedColumns(
      (prev) => prev.filter((c) => availableColumns.includes(c))
    );
  }, [availableColumns]);
  reactExports.useEffect(() => {
    if (!isCrossReferencing && hasRun && hasResults) {
      ue.success(
        `Cross-reference complete — ${crossReferenceResults.length.toLocaleString()} coincident moment${crossReferenceResults.length === 1 ? "" : "s"} found.`
      );
    }
  }, [isCrossReferencing, hasRun, hasResults, crossReferenceResults.length]);
  const canRun = selectedDatasetIds.length >= 2 && selectedColumns.length >= 1;
  const toggleDataset = (id) => {
    setSelectedDatasetIds(
      (prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const toggleColumn = (col) => {
    setSelectedColumns(
      (prev) => prev.includes(col) ? prev.filter((x) => x !== col) : [...prev, col]
    );
  };
  const handleRun = () => {
    if (!canRun) return;
    const config = {
      datasetIds: selectedDatasetIds,
      columns: selectedColumns
    };
    void runCrossReferenceAction(config);
  };
  const handleClear = () => {
    clearCrossReferenceResults();
  };
  if (datasets.length < 2) {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "div",
      {
        "data-ocid": "page.cross_reference",
        className: "mx-auto w-full max-w-5xl px-4 py-8 md:px-6 md:py-10",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(PageHeading, {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            EmptyState,
            {
              icon: Layers,
              title: "Load at least two datasets",
              description: "Cross-reference aligns threshold-based events across two or more datasets by timestamp. Load multiple datasets (e.g. different timeframes of the same instrument) in the Data Intake panel, then return here to find coincident conditions.",
              hint: "Each dataset keeps its original column names — they are preserved verbatim throughout the analysis."
            }
          )
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      "data-ocid": "page.cross_reference",
      className: "mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(PageHeading, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-1 gap-6 lg:grid-cols-[22rem_1fr]", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("aside", { className: "lg:sticky lg:top-4 lg:self-start", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { className: "gap-0 py-0", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { className: "border-b border-border px-5 py-4", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { className: "flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                ListFilter,
                {
                  className: "size-4 text-primary",
                  "aria-hidden": "true"
                }
              ),
              "Cross-Reference Settings"
            ] }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "flex flex-col gap-5 px-5 py-5", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("fieldset", { className: "flex flex-col gap-2", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("legend", { className: "flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Datasets" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs(
                    "span",
                    {
                      className: "font-mono tabular-nums text-foreground",
                      "data-ocid": "cross_reference.dataset_count",
                      children: [
                        selectedDatasetIds.length,
                        "/",
                        datasets.length
                      ]
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: "Select 2 or more datasets to align by timestamp." }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "ul",
                  {
                    "data-ocid": "cross_reference.dataset_list",
                    className: "flex flex-col gap-1.5",
                    children: datasets.map((ds, idx) => {
                      const checked = selectedDatasetIds.includes(ds.id);
                      return /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(
                        "label",
                        {
                          "data-ocid": `cross_reference.dataset.${idx + 1}`,
                          className: cn(
                            "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-smooth",
                            checked ? "border-primary/50 bg-primary/5 text-foreground" : "border-border bg-card text-foreground hover:border-border/80 hover:bg-muted/40"
                          ),
                          children: [
                            /* @__PURE__ */ jsxRuntimeExports.jsx(
                              "input",
                              {
                                type: "checkbox",
                                checked,
                                onChange: () => toggleDataset(ds.id),
                                "data-ocid": `cross_reference.dataset.${idx + 1}.checkbox`,
                                className: "size-4 accent-[oklch(var(--primary))]"
                              }
                            ),
                            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "min-w-0 flex-1 truncate font-mono text-xs tabular-nums", children: ds.label ?? ds.name }),
                            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono text-[10px] tabular-nums text-muted-foreground", children: [
                              ds.rowCount.toLocaleString(),
                              " bars"
                            ] })
                          ]
                        }
                      ) }, ds.id);
                    })
                  }
                )
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("fieldset", { className: "flex flex-col gap-2", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("legend", { className: "flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Columns to analyze" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs(
                    "span",
                    {
                      className: "font-mono tabular-nums text-foreground",
                      "data-ocid": "cross_reference.column_count",
                      children: [
                        selectedColumns.length,
                        "/",
                        availableColumns.length
                      ]
                    }
                  )
                ] }),
                availableColumns.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: "Select datasets above to populate the column list." }) : /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "ul",
                  {
                    "data-ocid": "cross_reference.column_list",
                    className: "flex max-h-56 flex-col gap-1 overflow-y-auto pr-1",
                    children: availableColumns.map((col, idx) => {
                      const checked = selectedColumns.includes(col);
                      return /* @__PURE__ */ jsxRuntimeExports.jsx("li", { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(
                        "label",
                        {
                          "data-ocid": `cross_reference.column.${idx + 1}`,
                          className: cn(
                            "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-smooth",
                            checked ? "border-primary/50 bg-primary/5 text-foreground" : "border-border bg-card text-foreground hover:bg-muted/40"
                          ),
                          children: [
                            /* @__PURE__ */ jsxRuntimeExports.jsx(
                              "input",
                              {
                                type: "checkbox",
                                checked,
                                onChange: () => toggleColumn(col),
                                "data-ocid": `cross_reference.column.${idx + 1}.checkbox`,
                                className: "size-3.5 accent-[oklch(var(--primary))]"
                              }
                            ),
                            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "column-chip min-w-0 flex-1 truncate px-1.5 py-0.5 font-mono text-[11px] tabular-nums", children: col })
                          ]
                        }
                      ) }, col);
                    })
                  }
                )
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-2 pt-1", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs(
                  Button,
                  {
                    "data-ocid": "cross_reference.run_button",
                    onClick: handleRun,
                    disabled: !canRun || isCrossReferencing,
                    className: "w-full",
                    children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsx(Play, { className: "size-4 fill-current", "aria-hidden": "true" }),
                      isCrossReferencing ? "Running…" : "Run Cross-Reference"
                    ]
                  }
                ),
                hasResults ? /* @__PURE__ */ jsxRuntimeExports.jsxs(
                  Button,
                  {
                    "data-ocid": "cross_reference.clear_button",
                    variant: "outline",
                    onClick: handleClear,
                    disabled: isCrossReferencing,
                    className: "w-full",
                    children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsx(X, { className: "size-4", "aria-hidden": "true" }),
                      "Clear results"
                    ]
                  }
                ) : null,
                !canRun && !isCrossReferencing ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-center text-xs text-muted-foreground", children: selectedDatasetIds.length < 2 ? "Select at least 2 datasets." : selectedColumns.length < 1 ? "Select at least 1 column to analyze." : "" }) : null
              ] })
            ] })
          ] }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "flex min-w-0 flex-col gap-4", children: [
            isCrossReferencing ? /* @__PURE__ */ jsxRuntimeExports.jsx(
              Card,
              {
                "data-ocid": "cross_reference.progress",
                className: "gap-3 border-primary/30",
                children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "flex flex-col gap-3 px-5 py-4", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-3", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "relative flex size-2.5", children: [
                        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" }),
                        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "relative inline-flex size-2.5 rounded-full bg-primary" })
                      ] }),
                      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-display text-sm font-semibold text-foreground", children: "Aligning datasets by timestamp…" })
                    ] }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-sm tabular-nums text-primary", children: "working" })
                  ] }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    Progress,
                    {
                      "data-ocid": "cross_reference.progress_bar",
                      className: "h-1.5"
                    }
                  ),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: "Detecting threshold-based events on the selected columns and finding moments where conditions across datasets coincide." })
                ] })
              }
            ) : null,
            hasRun && !isCrossReferencing && hasResults ? /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "div",
              {
                "data-ocid": "cross_reference.summary",
                className: "flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5",
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(Sparkles, { className: "size-4 text-primary", "aria-hidden": "true" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm text-foreground", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono tabular-nums font-semibold text-primary", children: crossReferenceResults.length.toLocaleString() }),
                    " ",
                    "coincident moment",
                    crossReferenceResults.length === 1 ? "" : "s",
                    " found across",
                    " ",
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono tabular-nums font-semibold text-foreground", children: selectedDatasetIds.length }),
                    " ",
                    "datasets and",
                    " ",
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono tabular-nums font-semibold text-foreground", children: selectedColumns.length }),
                    " ",
                    "column",
                    selectedColumns.length === 1 ? "" : "s",
                    "."
                  ] })
                ]
              }
            ) : null,
            hasResults && !isCrossReferencing ? /* @__PURE__ */ jsxRuntimeExports.jsx(CrossReferenceResultsTable, { results: crossReferenceResults }) : !isCrossReferencing && !hasRun ? /* @__PURE__ */ jsxRuntimeExports.jsx(
              EmptyState,
              {
                icon: GitCompareArrows,
                title: "Ready to cross-reference",
                description: "Pick two or more datasets on the left and the columns you want to analyze, then run. The engine aligns threshold-based events by timestamp and surfaces moments where conditions on different timeframes line up.",
                hint: "Original column names are preserved verbatim throughout the analysis.",
                actionLabel: "Run cross-reference",
                onAction: handleRun
              }
            ) : !isCrossReferencing && hasRun && !hasResults ? /* @__PURE__ */ jsxRuntimeExports.jsx(
              EmptyState,
              {
                icon: GitCompareArrows,
                title: "No coincident moments found",
                description: "The engine ran but found no timestamps where threshold-based events on the selected columns lined up across the chosen datasets. Try selecting different columns or additional datasets.",
                actionLabel: "Run cross-reference again",
                onAction: handleRun
              }
            ) : null
          ] })
        ] })
      ]
    }
  );
}
function PageHeading() {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mb-6 flex items-start justify-between gap-4", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-1", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        GitCompareArrows,
        {
          className: "size-4 text-primary",
          "aria-hidden": "true"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "font-display text-xl font-semibold text-foreground md:text-2xl", children: "Cross-Reference" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "max-w-2xl text-sm text-muted-foreground", children: "Align threshold-based events across two or more datasets by timestamp and surface moments where conditions on different timeframes line up — ranked by correlation strength and confidence." })
  ] }) });
}
function CrossReferenceResultsTable({
  results
}) {
  const datasetIndex = reactExports.useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const r of results) {
      for (const c of r.contributingDatasets) {
        if (!map.has(c.datasetId)) map.set(c.datasetId, map.size);
      }
    }
    return map;
  }, [results]);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { className: "gap-0 overflow-hidden py-0", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { className: "border-b border-border px-5 py-4", children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { className: "font-display text-sm font-semibold uppercase tracking-wide", children: "Coincident Moments" }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(CardContent, { className: "px-0 py-0", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "overflow-x-auto", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "table",
      {
        "data-ocid": "cross_reference.results_table",
        className: "w-full border-collapse text-sm",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("thead", { className: "sticky top-0 z-10 bg-card", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { className: "border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("th", { className: "px-5 py-3 font-medium", children: "Aligned Timestamp" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("th", { className: "px-4 py-3 font-medium", children: "Contributing Datasets" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("th", { className: "px-4 py-3 font-medium", children: "Detected Conditions" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("th", { className: "px-4 py-3 text-right font-medium", children: "Correlation" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("th", { className: "px-5 py-3 text-right font-medium", children: "Confidence" })
          ] }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("tbody", { children: results.map((r, idx) => {
            var _a;
            const firstIdx = datasetIndex.get(
              ((_a = r.contributingDatasets[0]) == null ? void 0 : _a.datasetId) ?? ""
            );
            const linked = firstIdx !== void 0 && firstIdx % 2 === 1;
            return /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "tr",
              {
                "data-ocid": `cross_reference.results_table.row.${idx + 1}`,
                className: cn(
                  "border-b border-border/60 transition-smooth hover:bg-muted/30",
                  linked && "correlation-row-linked"
                ),
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "whitespace-nowrap px-5 py-3 font-mono text-xs tabular-nums text-foreground", children: formatTimestamp(r.timestamp) }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "px-4 py-3", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-wrap gap-1", children: r.contributingDatasets.map((c, ci) => /* @__PURE__ */ jsxRuntimeExports.jsx(
                    "span",
                    {
                      "data-ocid": `cross_reference.results_table.row.${idx + 1}.dataset.${ci + 1}`,
                      className: "column-chip px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
                      children: c.datasetLabel
                    },
                    `${c.datasetId}-${ci}`
                  )) }) }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "px-4 py-3", children: /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { className: "flex flex-col gap-1.5", children: r.contributingDatasets.map((c, ci) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
                    "li",
                    {
                      "data-ocid": `cross_reference.results_table.row.${idx + 1}.condition.${ci + 1}`,
                      className: "flex flex-col gap-1 text-xs leading-relaxed text-foreground",
                      children: [
                        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
                          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono text-[11px] tabular-nums text-muted-foreground", children: [
                            c.datasetLabel,
                            " · ",
                            c.column,
                            ":"
                          ] }),
                          " ",
                          c.condition
                        ] }),
                        /* @__PURE__ */ jsxRuntimeExports.jsx(
                          ContributionMeta,
                          {
                            eventOrder: c.eventOrder,
                            reconstructingTimeframe: c.reconstructingTimeframe,
                            rowOcid: `cross_reference.results_table.row.${idx + 1}.condition.${ci + 1}`
                          }
                        )
                      ]
                    },
                    `${c.datasetId}-${ci}`
                  )) }) }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums text-foreground", children: r.correlationStrength.toFixed(3) }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: "px-5 py-3 text-right", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
                    ConfidenceBadge,
                    {
                      confidence: r.confidence,
                      dataOcid: `cross_reference.results_table.row.${idx + 1}.confidence`
                    }
                  ) })
                ]
              },
              r.id
            );
          }) })
        ]
      }
    ) }) })
  ] });
}
function ConfidenceBadge({
  confidence,
  dataOcid
}) {
  const normalized = confidence.toLowerCase();
  const tone = normalized === "high" ? "border-primary/40 bg-primary/10 text-primary" : normalized === "medium" ? "border-border bg-muted text-foreground" : "border-border bg-muted/50 text-muted-foreground";
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "span",
    {
      "data-ocid": dataOcid,
      className: cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] tabular-nums uppercase tracking-wide",
        tone
      ),
      children: confidence
    }
  );
}
function ContributionMeta({
  eventOrder,
  reconstructingTimeframe,
  rowOcid
}) {
  const hasOrder = typeof eventOrder === "string" && eventOrder.length > 0;
  const hasTf = typeof reconstructingTimeframe === "string" && reconstructingTimeframe.length > 0;
  if (!hasOrder && !hasTf) return null;
  const unknown = hasOrder && eventOrder === "order unknown at available resolution";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-1.5 pl-1", children: [
    hasOrder ? /* @__PURE__ */ jsxRuntimeExports.jsx(
      "span",
      {
        "data-ocid": `${rowOcid}.event_order`,
        className: cn(
          "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums leading-tight",
          unknown ? "border-amber-500/40 bg-amber-500/10 italic text-amber-600 dark:text-amber-400" : "border-border bg-muted/60 text-muted-foreground"
        ),
        children: unknown ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Sparkles,
            {
              className: "mr-1 size-2.5 opacity-70",
              "aria-hidden": "true"
            }
          ),
          eventOrder
        ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mr-1 text-muted-foreground/70", children: "order:" }),
          eventOrder
        ] })
      }
    ) : null,
    hasTf ? /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "span",
      {
        "data-ocid": `${rowOcid}.reconstructing_timeframe`,
        className: "inline-flex items-center rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 font-mono text-[10px] tabular-nums leading-tight text-primary",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Layers, { className: "mr-1 size-2.5 opacity-80", "aria-hidden": "true" }),
          reconstructingTimeframe
        ]
      }
    ) : null
  ] });
}
function formatTimestamp(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return `${date} ${time}`;
}
export {
  CrossReferencePage as default
};
