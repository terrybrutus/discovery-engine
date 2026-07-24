import { c as createLucideIcon, i as useEngineStore, j as jsxRuntimeExports, B as Button, h as cn } from "./index-D4QMwWvE.js";
import { E as EmptyState } from "./EmptyState-BitJLYM5.js";
import { R as RefreshCw } from "./refresh-cw-65HrH7HQ.js";
import { T as TrendingUp } from "./trending-up-BhSbnhsR.js";
import { T as TrendingDown } from "./trending-down-C0vv_e5s.js";
/**
 * @license lucide-react v0.511.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const __iconNode = [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "M8 18v-2", key: "qcmpov" }],
  ["path", { d: "M12 18v-4", key: "q1q25u" }],
  ["path", { d: "M16 18v-6", key: "15y0np" }]
];
const FileChartColumnIncreasing = createLucideIcon("file-chart-column-increasing", __iconNode);
const RANK_LIMIT = 10;
function ReportPage() {
  const dataset = useEngineStore((s) => s.dataset);
  const datasets = useEngineStore((s) => s.datasets);
  const features = useEngineStore((s) => s.features);
  const patterns = useEngineStore((s) => s.patterns);
  const validationResults = useEngineStore((s) => s.validationResults);
  const report = useEngineStore((s) => s.report);
  const generateReportAction = useEngineStore((s) => s.generateReportAction);
  const setActiveTab = useEngineStore((s) => s.setActiveTab);
  const hasRun = patterns.length > 0;
  const hasReport = report != null;
  if (!hasReport || !hasRun) {
    const goToDiscovery = () => setActiveTab("discovery");
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { "data-ocid": "page.report", className: "flex flex-col gap-4 p-4 md:p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(PageHeader, {}),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        EmptyState,
        {
          icon: FileChartColumnIncreasing,
          title: "No report available",
          description: "No report is available yet. Run a discovery on the Discovery tab first — once patterns are found and validated, come back here to generate a structured research brief of your strongest discoveries.",
          hint: "You can also adjust discovery settings and re-run to find stronger patterns before generating the report.",
          actionLabel: "Go to Discovery",
          onAction: goToDiscovery
        }
      )
    ] });
  }
  const activeReport = report;
  const validationById = new Map(
    validationResults.map((v) => [v.patternId, v])
  );
  const patternCount = patterns.length;
  const featureCount = features.filter((f) => f.enabled).length;
  const topWinRate = patterns.length > 0 ? Math.max(...patterns.map((p) => p.winRate)) : null;
  const ratioValues = patterns.map((p) => resolveRatio(p, validationById.get(p.id))).filter((n) => n != null);
  const topRatio = ratioValues.length > 0 ? Math.max(...ratioValues) : null;
  const topByWinRate = patterns.slice(0, RANK_LIMIT);
  const topByRatio = [...patterns].map((p) => ({
    pattern: p,
    ratio: resolveRatio(p, validationById.get(p.id))
  })).sort(
    (a, b) => (b.ratio ?? Number.NEGATIVE_INFINITY) - (a.ratio ?? Number.NEGATIVE_INFINITY)
  ).slice(0, RANK_LIMIT);
  const totalValidated = validationResults.length;
  const passedCount = validationResults.filter((v) => !v.degraded).length;
  const passRate = totalValidated > 0 ? passedCount / totalValidated * 100 : null;
  const validatedRatios = validationResults.map((v) => v.directionAdjustedMfeMaeRatio).filter((n) => n != null);
  const avgRatio = validatedRatios.length > 0 ? validatedRatios.reduce((acc, v) => acc + v, 0) / validatedRatios.length : null;
  const survivalValues = validationResults.map((v) => v.crossSymbolSurvival).filter((n) => n != null);
  const avgSurvival = survivalValues.length > 0 ? survivalValues.reduce((acc, v) => acc + v, 0) / survivalValues.length : null;
  const datasetNames = datasets.length > 0 ? datasets.map((d) => d.label ?? d.name) : dataset ? [dataset.label ?? dataset.name] : [];
  const proseSections = activeReport.sections.filter(
    (s) => s.id !== "top-discoveries" && s.id !== "top-by-ratio"
  );
  const handleRegenerate = () => generateReportAction();
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { "data-ocid": "page.report", className: "flex flex-col gap-5 p-4 md:p-6", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(PageHeader, {}),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: "Report generated from this session's discovery and validation results. Adjust settings and regenerate to update." }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        Button,
        {
          "data-ocid": "report.regenerate_button",
          onClick: handleRegenerate,
          disabled: !dataset || features.length === 0,
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(RefreshCw, { className: "size-4", "aria-hidden": "true" }),
            "Regenerate Report"
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "section",
      {
        "data-ocid": "report.summary_block",
        "aria-labelledby": "report-summary-title",
        className: "stat-card flex flex-col gap-4",
        "data-accent": "true",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-wrap items-start justify-between gap-3", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex min-w-0 flex-col gap-1", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                FileChartColumnIncreasing,
                {
                  className: "size-4 text-primary",
                  "aria-hidden": "true"
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground", children: "Research Brief" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "h2",
              {
                id: "report-summary-title",
                className: "font-display text-xl font-semibold text-foreground",
                children: activeReport.datasetName ?? "Untitled Run"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-xs text-muted-foreground", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono tabular-nums", children: formatTimestamp(activeReport.generatedAt) }),
              " · ",
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: datasetNames.join(", ") || "No dataset" })
            ] })
          ] }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-4", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              HeadlineMetric,
              {
                label: "Patterns",
                value: patternCount.toLocaleString()
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              HeadlineMetric,
              {
                label: "Features",
                value: featureCount.toLocaleString()
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              HeadlineMetric,
              {
                label: "Top Win Rate",
                value: topWinRate != null ? `${topWinRate.toFixed(1)}%` : "—"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              HeadlineMetric,
              {
                label: "Top MFE/MAE Ratio",
                value: topRatio != null ? topRatio.toFixed(2) : "—"
              }
            )
          ] })
        ]
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "section",
      {
        "data-ocid": "report.top_by_win_rate",
        "aria-labelledby": "top-win-rate-title",
        className: "flex flex-col gap-3",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(SectionHeader, { index: "01", title: "Top Patterns by Win Rate" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm leading-relaxed text-muted-foreground", children: "The strongest patterns ranked by win rate — the share of occurrences that moved in the pattern's dominant direction." }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            PatternTable,
            {
              patterns: topByWinRate,
              validationById,
              emptyMessage: "No patterns met the discovery thresholds. Try lowering the minimum win rate or sample size, or enabling more feature categories."
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "section",
      {
        "data-ocid": "report.top_by_ratio",
        "aria-labelledby": "top-ratio-title",
        className: "flex flex-col gap-3",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SectionHeader,
            {
              index: "02",
              title: "Top Patterns by Direction-Adjusted MFE/MAE Ratio"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm leading-relaxed text-muted-foreground", children: "Ranked by direction-adjusted MFE/MAE ratio — favorable excursion divided by adverse excursion, signed so bearish patterns are scored on the same scale as bullish ones. Higher is better." }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            PatternTable,
            {
              patterns: topByRatio.map((r) => r.pattern),
              validationById,
              emptyMessage: "No patterns had a computable direction-adjusted MFE/MAE ratio. This usually means the adverse excursion (MAE) was zero across the measured window."
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "section",
      {
        "data-ocid": "report.validation_summary",
        "aria-labelledby": "validation-summary-title",
        className: "flex flex-col gap-3",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(SectionHeader, { index: "03", title: "Aggregate Validation Summary" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm leading-relaxed text-muted-foreground", children: "Out-of-sample re-test of the top patterns on a 30% chronological holdout (the most recent 30% of the dataset). Patterns whose out-of-sample win rate drops more than 10 percentage points, or whose out-of-sample sample is too small, are flagged as degraded." }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-4", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              SummaryStat,
              {
                label: "Patterns Validated",
                value: totalValidated.toLocaleString()
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              SummaryStat,
              {
                label: "Pass Rate",
                value: passRate != null ? `${passRate.toFixed(1)}%` : "—",
                hint: totalValidated > 0 ? `${passedCount} of ${totalValidated} passed` : void 0
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              SummaryStat,
              {
                label: "Avg Direction-Adj. MFE/MAE",
                value: avgRatio != null ? avgRatio.toFixed(2) : "—",
                hint: validatedRatios.length > 0 ? `across ${validatedRatios.length} pattern${validatedRatios.length === 1 ? "" : "s"}` : void 0
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              SummaryStat,
              {
                label: "Avg Cross-Symbol Survival",
                value: avgSurvival != null ? `${(avgSurvival * 100).toFixed(1)}%` : "—",
                hint: survivalValues.length > 0 ? `across ${survivalValues.length} pattern${survivalValues.length === 1 ? "" : "s"}` : void 0
              }
            )
          ] })
        ]
      }
    ),
    proseSections.map((section, idx) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "section",
      {
        "data-ocid": `report.section.${section.id}`,
        "aria-labelledby": `section-${section.id}-title`,
        className: "rounded-lg border border-border bg-card p-5",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SectionHeader,
            {
              index: String(idx + 4).padStart(2, "0"),
              title: section.title,
              id: `section-${section.id}-title`
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-col gap-2.5", children: section.paragraphs.map((para, i) => /* @__PURE__ */ jsxRuntimeExports.jsx(
            "p",
            {
              className: "text-sm leading-relaxed text-muted-foreground",
              children: para
            },
            `${section.id}-${i}`
          )) })
        ]
      },
      section.id
    ))
  ] });
}
function PageHeader() {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-1", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(FileChartColumnIncreasing, { className: "size-4 text-primary", "aria-hidden": "true" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground", children: "04 · Report" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "font-display text-lg font-semibold text-foreground", children: "Discovery Report" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: "A structured summary of your strongest pattern discoveries, ranked by statistical strength and direction-adjusted reward-to-risk." })
  ] });
}
function SectionHeader({
  index,
  title,
  id
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground", children: index }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "h2",
      {
        id,
        className: "font-display text-base font-semibold text-foreground",
        children: title
      }
    )
  ] });
}
function HeadlineMetric({ label, value }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      "data-ocid": `report.headline.${label.toLowerCase().replace(/[^a-z]+/g, "_")}`,
      className: "rounded-md border border-border bg-background/40 px-3 py-2.5",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground", children: label }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 font-mono text-lg font-semibold tabular-nums text-foreground", children: value })
      ]
    }
  );
}
function SummaryStat({
  label,
  value,
  hint
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "stat-card flex flex-col gap-1", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground", children: label }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-mono text-xl font-semibold tabular-nums text-foreground", children: value }),
    hint ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-mono text-[11px] tabular-nums text-muted-foreground/80", children: hint }) : null
  ] });
}
function PatternTable({
  patterns,
  validationById,
  emptyMessage
}) {
  if (patterns.length === 0) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx(
      "div",
      {
        "data-ocid": "report.pattern_table.empty",
        className: "rounded-lg border border-dashed border-border bg-card/40 px-5 py-10 text-center",
        children: /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm leading-relaxed text-muted-foreground", children: emptyMessage })
      }
    );
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "div",
    {
      "data-ocid": "report.pattern_table",
      className: "overflow-x-auto rounded-lg border border-border bg-card",
      children: /* @__PURE__ */ jsxRuntimeExports.jsxs("table", { className: "w-full border-collapse text-sm", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("thead", { children: /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { className: "border-b border-border bg-muted/40 text-left", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Th, { className: "w-8 text-right", children: "#" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Th, { children: "Pattern" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Th, { className: "w-24", children: "Direction" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Th, { className: "w-24 text-right", children: "Win Rate" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Th, { className: "w-28 text-right", children: "MFE/MAE Ratio" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Th, { className: "w-24 text-right", children: "Avg Move" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Th, { className: "w-20 text-right", children: "Sample" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Th, { className: "w-24", children: "Confidence" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Th, { className: "w-20", children: "Status" })
        ] }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("tbody", { children: patterns.map((p, i) => {
          const v = validationById.get(p.id);
          const ratio = resolveRatio(p, v);
          const degraded = (v == null ? void 0 : v.degraded) ?? false;
          return /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "tr",
            {
              "data-ocid": `report.pattern_table.row.${i}`,
              className: "border-b border-border/60 last:border-0 hover:bg-muted/30",
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Td, { className: "text-right font-mono tabular-nums text-muted-foreground", children: i + 1 }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(Td, { children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-foreground", children: p.label.replace(/^When\s+/i, "") }) }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(Td, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(DirectionBadge, { direction: p.direction }) }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs(Td, { className: "text-right font-mono tabular-nums text-foreground", children: [
                  p.winRate.toFixed(1),
                  "%"
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(Td, { className: "text-right font-mono tabular-nums text-foreground", children: ratio != null ? ratio.toFixed(2) : "—" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(Td, { className: "text-right font-mono tabular-nums text-foreground", children: p.avgMove.toFixed(2) }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(Td, { className: "text-right font-mono tabular-nums text-muted-foreground", children: p.sampleSize.toLocaleString() }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(Td, { className: "font-mono text-xs capitalize text-muted-foreground", children: p.confidence }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(Td, { children: v ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: degraded ? "degraded" : "surviving", children: degraded ? "Degraded" : "Passed" }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-[11px] text-muted-foreground/60", children: "unvalidated" }) })
              ]
            },
            p.id
          );
        }) })
      ] })
    }
  );
}
function Th({
  children,
  className
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "th",
    {
      scope: "col",
      className: cn(
        "px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground",
        className
      ),
      children
    }
  );
}
function Td({
  children,
  className
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("td", { className: cn("px-3 py-2.5 align-middle", className), children });
}
function DirectionBadge({ direction }) {
  if (direction === "bullish") {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "inline-flex items-center gap-1 font-mono text-xs text-primary", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(TrendingUp, { className: "size-3.5", "aria-hidden": "true" }),
      "Bullish"
    ] });
  }
  if (direction === "bearish") {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "inline-flex items-center gap-1 font-mono text-xs text-destructive", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(TrendingDown, { className: "size-3.5", "aria-hidden": "true" }),
      "Bearish"
    ] });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-xs text-muted-foreground", children: "Neutral" });
}
function resolveRatio(pattern, validation) {
  if (validation && validation.directionAdjustedMfeMaeRatio != null) {
    return validation.directionAdjustedMfeMaeRatio;
  }
  return pattern.mfeMaeRatio ?? null;
}
function formatTimestamp(ts) {
  return new Date(ts).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
export {
  ReportPage as default
};
