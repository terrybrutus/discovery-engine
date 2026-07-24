import { c as createLucideIcon, r as reactExports, j as jsxRuntimeExports, h as cn, B as Button, X, T as TriangleAlert, k as Check, i as useEngineStore, M as LoaderCircle, N as FlaskConical } from "./index-D4QMwWvE.js";
import { E as EmptyState } from "./EmptyState-BitJLYM5.js";
import { f as Tooltip, B as BarChart, X as XAxis, Y as YAxis, g as Bar, h as Cell, T as Table, a as TableHeader, b as TableRow, c as TableHead, d as TableBody, e as TableCell, C as ChevronDown } from "./BarChart-DqfCYvDs.js";
import { R as ResponsiveContainer, M as Minus, C as ChevronRight } from "./ResponsiveContainer-D8JxM1vG.js";
import { C as CartesianGrid, b as ChevronsUpDown, A as ArrowUp, a as ArrowDown } from "./CartesianGrid-BLbGQhp3.js";
import { T as TrendingUp } from "./trending-up-BhSbnhsR.js";
import { T as TrendingDown } from "./trending-down-C0vv_e5s.js";
import { S as Sparkles } from "./sparkles-B6YI30ep.js";
import { P as Play } from "./play-DndWjt-y.js";
/**
 * @license lucide-react v0.511.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const __iconNode = [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "oel41y"
    }
  ],
  ["path", { d: "m9 12 2 2 4-4", key: "dzmm74" }]
];
const ShieldCheck = createLucideIcon("shield-check", __iconNode);
const THEMES = { light: "", dark: ".dark" };
const ChartContext = reactExports.createContext(null);
function useChart() {
  const context = reactExports.useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }
  return context;
}
function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}) {
  const uniqueId = reactExports.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;
  return /* @__PURE__ */ jsxRuntimeExports.jsx(ChartContext.Provider, { value: { config }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      "data-slot": "chart",
      "data-chart": chartId,
      className: cn(
        "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border flex aspect-video justify-center text-xs [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
        className
      ),
      ...props,
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ChartStyle, { id: chartId, config }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(ResponsiveContainer, { children })
      ]
    }
  ) });
}
const ChartStyle = ({ id, config }) => {
  const colorConfig = Object.entries(config).filter(
    ([, config2]) => config2.theme || config2.color
  );
  if (!colorConfig.length) {
    return null;
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "style",
    {
      dangerouslySetInnerHTML: {
        __html: Object.entries(THEMES).map(
          ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig.map(([key, itemConfig]) => {
            var _a;
            const color = ((_a = itemConfig.theme) == null ? void 0 : _a[theme]) || itemConfig.color;
            return color ? `  --color-${key}: ${color};` : null;
          }).join("\n")}
}
`
        ).join("\n")
      }
    }
  );
};
const ChartTooltip = Tooltip;
function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey
}) {
  const { config } = useChart();
  const tooltipLabel = reactExports.useMemo(() => {
    var _a;
    if (hideLabel || !(payload == null ? void 0 : payload.length)) {
      return null;
    }
    const [item] = payload;
    const key = `${labelKey || (item == null ? void 0 : item.dataKey) || (item == null ? void 0 : item.name) || "value"}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value = !labelKey && typeof label === "string" ? ((_a = config[label]) == null ? void 0 : _a.label) || label : itemConfig == null ? void 0 : itemConfig.label;
    if (labelFormatter) {
      return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: cn("font-medium", labelClassName), children: labelFormatter(value, payload) });
    }
    if (!value) {
      return null;
    }
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: cn("font-medium", labelClassName), children: value });
  }, [
    label,
    labelFormatter,
    payload,
    hideLabel,
    labelClassName,
    config,
    labelKey
  ]);
  if (!active || !(payload == null ? void 0 : payload.length)) {
    return null;
  }
  const nestLabel = payload.length === 1 && indicator !== "dot";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      className: cn(
        "border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl",
        className
      ),
      children: [
        !nestLabel ? tooltipLabel : null,
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "grid gap-1.5", children: payload.map((item, index) => {
          const key = `${nameKey || item.name || item.dataKey || "value"}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);
          const indicatorColor = color || item.payload.fill || item.color;
          return /* @__PURE__ */ jsxRuntimeExports.jsx(
            "div",
            {
              className: cn(
                "[&>svg]:text-muted-foreground flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5",
                indicator === "dot" && "items-center"
              ),
              children: formatter && (item == null ? void 0 : item.value) !== void 0 && item.name ? formatter(item.value, item.name, item, index, item.payload) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
                (itemConfig == null ? void 0 : itemConfig.icon) ? /* @__PURE__ */ jsxRuntimeExports.jsx(itemConfig.icon, {}) : !hideIndicator && /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "div",
                  {
                    className: cn(
                      "shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
                      {
                        "h-2.5 w-2.5": indicator === "dot",
                        "w-1": indicator === "line",
                        "w-0 border-[1.5px] border-dashed bg-transparent": indicator === "dashed",
                        "my-0.5": nestLabel && indicator === "dashed"
                      }
                    ),
                    style: {
                      "--color-bg": indicatorColor,
                      "--color-border": indicatorColor
                    }
                  }
                ),
                /* @__PURE__ */ jsxRuntimeExports.jsxs(
                  "div",
                  {
                    className: cn(
                      "flex flex-1 justify-between leading-none",
                      nestLabel ? "items-end" : "items-center"
                    ),
                    children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-1.5", children: [
                        nestLabel ? tooltipLabel : null,
                        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-muted-foreground", children: (itemConfig == null ? void 0 : itemConfig.label) || item.name })
                      ] }),
                      item.value && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-foreground font-mono font-medium tabular-nums", children: item.value.toLocaleString() })
                    ]
                  }
                )
              ] })
            },
            item.dataKey
          );
        }) })
      ]
    }
  );
}
function getPayloadConfigFromPayload(config, payload, key) {
  if (typeof payload !== "object" || payload === null) {
    return void 0;
  }
  const payloadPayload = "payload" in payload && typeof payload.payload === "object" && payload.payload !== null ? payload.payload : void 0;
  let configLabelKey = key;
  if (key in payload && typeof payload[key] === "string") {
    configLabelKey = payload[key];
  } else if (payloadPayload && key in payloadPayload && typeof payloadPayload[key] === "string") {
    configLabelKey = payloadPayload[key];
  }
  return configLabelKey in config ? config[configLabelKey] : config[key];
}
const chartConfig = {
  winRate: { label: "Win Rate %", color: "oklch(var(--chart-1))" },
  bull: { label: "Bull Market", color: "oklch(var(--chart-1))" },
  bear: { label: "Bear Market", color: "oklch(var(--chart-3))" }
};
const PASS_THRESHOLD = 50;
function ValidationBreakdown({
  result,
  onClose
}) {
  const summary = reactExports.useMemo(() => buildSummary(result), [result]);
  const yearData = reactExports.useMemo(
    () => result.byYear.map((y) => ({
      year: String(y.year),
      winRate: Number(y.metrics.winRate.toFixed(1)),
      sample: y.metrics.sampleSize
    })),
    [result]
  );
  const bull = result.byMarketCondition.bull;
  const bear = result.byMarketCondition.bear;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      "data-ocid": "validation_breakdown",
      className: "flex flex-col gap-5 rounded-lg border border-border bg-card p-5 shadow-subtle",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between gap-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-1 min-w-0", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "font-display text-base font-semibold text-foreground", children: "Pattern Breakdown" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground line-clamp-2", children: result.patternLabel })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Button,
            {
              "data-ocid": "validation_breakdown.close_button",
              variant: "ghost",
              size: "icon",
              onClick: onClose,
              "aria-label": "Close breakdown",
              className: "size-8 shrink-0",
              children: /* @__PURE__ */ jsxRuntimeExports.jsx(X, { className: "size-4", "aria-hidden": "true" })
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            RobustnessStat,
            {
              label: "Direction-Adjusted MFE/MAE",
              value: formatRatio$1(result.directionAdjustedMfeMaeRatio),
              hint: "MFE/MAE recomputed with direction adjustment so the ratio is meaningful for bearish patterns.",
              dataOcid: "validation_breakdown.direction_adjusted_ratio"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            RobustnessStat,
            {
              label: "Cross-Symbol Survival",
              value: formatSurvival$1(result.crossSymbolSurvival),
              hint: "Fraction of symbols/datasets the pattern remains profitable on (0–1).",
              dataOcid: "validation_breakdown.cross_symbol_survival"
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "div",
          {
            "data-ocid": "validation_breakdown.summary",
            className: "rounded-md border border-border bg-muted/30 px-4 py-3",
            children: /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm leading-relaxed text-foreground", children: summary })
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h4", { className: "font-display text-sm font-semibold text-foreground", children: "By Market Condition" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              ConditionCard,
              {
                label: "Bull Periods",
                metrics: bull,
                tone: "bull",
                dataOcid: "validation_breakdown.condition.bull"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              ConditionCard,
              {
                label: "Bear Periods",
                metrics: bear,
                tone: "bear",
                dataOcid: "validation_breakdown.condition.bear"
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-baseline justify-between gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h4", { className: "font-display text-sm font-semibold text-foreground", children: "Year-by-Year Win Rate" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-xs text-muted-foreground", children: [
              result.byYear.length,
              " calendar year",
              result.byYear.length === 1 ? "" : "s",
              " in dataset"
            ] })
          ] }),
          yearData.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex h-32 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground", children: "No matched samples in any year." }) : /* @__PURE__ */ jsxRuntimeExports.jsx(
            ChartContainer,
            {
              config: chartConfig,
              className: "aspect-[16/7] w-full",
              "data-ocid": "validation_breakdown.year_chart",
              children: /* @__PURE__ */ jsxRuntimeExports.jsxs(
                BarChart,
                {
                  data: yearData,
                  margin: { top: 8, right: 8, bottom: 0, left: -16 },
                  children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx(
                      CartesianGrid,
                      {
                        vertical: false,
                        stroke: "oklch(var(--border))",
                        strokeDasharray: "3 3"
                      }
                    ),
                    /* @__PURE__ */ jsxRuntimeExports.jsx(
                      XAxis,
                      {
                        dataKey: "year",
                        tickLine: false,
                        axisLine: false,
                        tick: { fontSize: 11, fill: "oklch(var(--muted-foreground))" }
                      }
                    ),
                    /* @__PURE__ */ jsxRuntimeExports.jsx(
                      YAxis,
                      {
                        domain: [0, 100],
                        tickLine: false,
                        axisLine: false,
                        tick: { fontSize: 11, fill: "oklch(var(--muted-foreground))" },
                        tickFormatter: (v) => `${v}%`
                      }
                    ),
                    /* @__PURE__ */ jsxRuntimeExports.jsx(
                      ChartTooltip,
                      {
                        cursor: { fill: "oklch(var(--muted) / 0.4)" },
                        content: /* @__PURE__ */ jsxRuntimeExports.jsx(
                          ChartTooltipContent,
                          {
                            formatter: (value, _name, _item, _idx, payload) => {
                              var _a, _b;
                              return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-0.5", children: [
                                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono text-xs tabular-nums text-foreground", children: [
                                  Number(value).toFixed(1),
                                  "% win rate"
                                ] }),
                                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-xs text-muted-foreground", children: [
                                  ((_b = (_a = payload == null ? void 0 : payload[0]) == null ? void 0 : _a.payload) == null ? void 0 : _b.sample) ?? 0,
                                  " samples"
                                ] })
                              ] });
                            }
                          }
                        )
                      }
                    ),
                    /* @__PURE__ */ jsxRuntimeExports.jsx(Bar, { dataKey: "winRate", radius: [3, 3, 0, 0], children: yearData.map((d) => /* @__PURE__ */ jsxRuntimeExports.jsx(
                      Cell,
                      {
                        fill: d.winRate >= 55 ? "oklch(var(--chart-1))" : d.winRate >= 45 ? "oklch(var(--chart-2))" : "oklch(var(--chart-3))"
                      },
                      d.year
                    )) })
                  ]
                }
              )
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(YearLegend, { rows: result.byYear })
        ] })
      ]
    }
  );
}
function ValidationAggregate({
  results,
  passThreshold = PASS_THRESHOLD
}) {
  const stats = reactExports.useMemo(
    () => computeAggregate(results, passThreshold),
    [results, passThreshold]
  );
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      "data-ocid": "validation_aggregate",
      className: "grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 shadow-subtle sm:grid-cols-4",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          AggregateStat,
          {
            label: "Patterns Validated",
            value: String(stats.total),
            dataOcid: "validation_aggregate.total"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          AggregateStat,
          {
            label: "Pass Rate",
            value: stats.total === 0 ? "—" : `${stats.passRate.toFixed(1)}%`,
            hint: `Fraction of patterns with out-of-sample win rate above ${passThreshold}%.`,
            dataOcid: "validation_aggregate.pass_rate"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          AggregateStat,
          {
            label: "Avg Adj. MFE/MAE",
            value: formatRatio$1(stats.avgDirectionAdjustedMfeMaeRatio),
            hint: "Average of non-null direction-adjusted MFE/MAE ratios.",
            dataOcid: "validation_aggregate.avg_ratio"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          AggregateStat,
          {
            label: "Avg Cross-Sym Survival",
            value: formatSurvival$1(stats.avgCrossSymbolSurvival),
            hint: "Average of non-null cross-symbol survival fractions (0–1).",
            dataOcid: "validation_aggregate.avg_survival"
          }
        )
      ]
    }
  );
}
function computeAggregate(results, passThreshold) {
  const total = results.length;
  if (total === 0) {
    return {
      total: 0,
      passRate: 0,
      avgDirectionAdjustedMfeMaeRatio: null,
      avgCrossSymbolSurvival: null
    };
  }
  const passed = results.filter(
    (r) => r.outOfSampleMetrics.winRate > passThreshold
  ).length;
  const passRate = passed / total * 100;
  const ratios = results.map((r) => r.directionAdjustedMfeMaeRatio).filter((v) => v != null);
  const avgDirectionAdjustedMfeMaeRatio = ratios.length === 0 ? null : ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const survivals = results.map((r) => r.crossSymbolSurvival).filter((v) => v != null);
  const avgCrossSymbolSurvival = survivals.length === 0 ? null : survivals.reduce((a, b) => a + b, 0) / survivals.length;
  return {
    total,
    passRate,
    avgDirectionAdjustedMfeMaeRatio,
    avgCrossSymbolSurvival
  };
}
function AggregateStat({
  label,
  value,
  hint,
  dataOcid
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { "data-ocid": dataOcid, className: "flex flex-col gap-1", title: hint, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: label }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-lg tabular-nums font-semibold text-foreground", children: value })
  ] });
}
function RobustnessStat({
  label,
  value,
  hint,
  dataOcid
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      "data-ocid": dataOcid,
      className: "flex flex-col gap-1 rounded-md border border-border bg-background/40 px-3 py-2",
      title: hint,
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: label }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-sm tabular-nums text-foreground", children: value })
      ]
    }
  );
}
function ConditionCard({
  label,
  metrics,
  tone,
  dataOcid
}) {
  const Icon = tone === "bull" ? TrendingUp : TrendingDown;
  const accent = tone === "bull" ? "text-primary border-primary/30" : "text-chart-3 border-chart-3/30";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      "data-ocid": dataOcid,
      className: "flex flex-col gap-3 rounded-md border border-border bg-background/40 p-4",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: cn("flex items-center gap-1.5", accent), children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { className: "size-4", "aria-hidden": "true" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-display text-sm font-semibold", children: label })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono text-xs tabular-nums text-muted-foreground", children: [
            "n=",
            metrics.sampleSize
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(WinRateBar, { winRate: metrics.winRate, tone }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-3 gap-2 text-center", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Metric, { label: "Win %", value: `${metrics.winRate.toFixed(1)}%` }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Metric, { label: "Avg Move", value: metrics.avgMove.toFixed(2) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            Metric,
            {
              label: "MFE (proxy) / MAE (proxy)",
              value: `${metrics.avgMFE.toFixed(1)} / ${metrics.avgMAE.toFixed(1)}`
            }
          )
        ] })
      ]
    }
  );
}
function WinRateBar({
  winRate,
  tone
}) {
  const pct = Math.max(0, Math.min(100, winRate));
  const barColor = tone === "bull" ? "bg-primary" : "bg-chart-3";
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      className: "relative h-2 w-full overflow-hidden rounded-full bg-muted",
      role: "img",
      "aria-label": `Win rate ${pct.toFixed(1)} percent`,
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "div",
          {
            className: cn("h-full rounded-full transition-all", barColor),
            style: { width: `${pct}%` }
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "div",
          {
            className: "absolute top-0 bottom-0 w-px bg-foreground/30",
            style: { left: "50%" },
            "aria-hidden": "true"
          }
        )
      ]
    }
  );
}
function Metric({ label, value }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-0.5", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: label }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-xs tabular-nums text-foreground", children: value })
  ] });
}
function YearLegend({
  rows
}) {
  if (rows.length === 0) return null;
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-wrap gap-x-4 gap-y-1.5", children: rows.map((r) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      "data-ocid": `validation_breakdown.year_legend.${r.year}`,
      className: "flex items-center gap-1.5 text-xs",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono tabular-nums text-muted-foreground", children: r.year }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono tabular-nums text-foreground", children: [
          r.metrics.winRate.toFixed(1),
          "%"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono tabular-nums text-muted-foreground/70", children: [
          "(n=",
          r.metrics.sampleSize,
          ")"
        ] })
      ]
    },
    r.year
  )) });
}
function buildSummary(r) {
  const yearsHeld = r.byYear.filter(
    (y) => y.metrics.winRate >= r.inSampleMetrics.winRate - 10
  ).length;
  const yearsTotal = r.byYear.length;
  const bull = r.byMarketCondition.bull;
  const bear = r.byMarketCondition.bear;
  const bearDegraded = bear.sampleSize >= 20 && bull.sampleSize >= 20 && bull.winRate - bear.winRate > 10;
  const parts = [];
  if (r.outOfSampleMetrics.sampleSize < 20) {
    parts.push(
      `Only ${r.outOfSampleMetrics.sampleSize} out-of-sample matches — too few to trust the result.`
    );
  } else if (r.degraded) {
    const drop = (r.inSampleMetrics.winRate - r.outOfSampleMetrics.winRate).toFixed(1);
    parts.push(
      `This pattern degraded out-of-sample, dropping ${drop}pp from ${r.inSampleMetrics.winRate.toFixed(1)}% to ${r.outOfSampleMetrics.winRate.toFixed(1)}%.`
    );
  } else {
    parts.push(
      `This pattern held up out-of-sample: ${r.outOfSampleMetrics.winRate.toFixed(1)}% win rate vs ${r.inSampleMetrics.winRate.toFixed(1)}% in-sample.`
    );
  }
  if (yearsTotal > 0) {
    parts.push(
      `It held up in ${yearsHeld} of ${yearsTotal} year${yearsTotal === 1 ? "" : "s"}.`
    );
  }
  if (bearDegraded) {
    parts.push(
      `It degraded in bear markets (${bear.winRate.toFixed(1)}% vs ${bull.winRate.toFixed(1)}% in bull periods).`
    );
  } else if (bull.sampleSize >= 20 && bear.sampleSize >= 20) {
    parts.push(
      `It performed similarly in bull (${bull.winRate.toFixed(1)}%) and bear (${bear.winRate.toFixed(1)}%) markets.`
    );
  }
  return parts.join(" ");
}
function formatRatio$1(v) {
  if (v == null) return "—";
  return v.toFixed(2);
}
function formatSurvival$1(v) {
  if (v == null) return "—";
  return v.toFixed(2);
}
function DegradationBadge({
  outOfSampleWinRate,
  inSampleWinRate,
  outOfSampleSampleSize,
  minSample = 20,
  degradationThresholdPp = 10,
  className
}) {
  const status = resolveStatus(
    outOfSampleSampleSize,
    inSampleWinRate - outOfSampleWinRate,
    minSample,
    degradationThresholdPp
  );
  const { Icon, badge } = statusStyles[status];
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "span",
    {
      "data-ocid": `degradation_badge.${status}`,
      className: cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs font-medium tabular-nums whitespace-nowrap",
        badge,
        className
      ),
      title: statusTitles[status],
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { className: "size-3", "aria-hidden": "true" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: statusLabels[status] })
      ]
    }
  );
}
function resolveStatus(oosSample, dropPp, minSample, thresholdPp) {
  if (oosSample < minSample) return "insufficient";
  if (dropPp > thresholdPp) return "degraded";
  return "held";
}
const statusLabels = {
  held: "Held Up",
  degraded: "Degraded",
  insufficient: "Insufficient"
};
const statusTitles = {
  held: "Out-of-sample win rate stayed within 10pp of in-sample.",
  degraded: "Out-of-sample win rate dropped more than 10pp.",
  insufficient: "Out-of-sample sample size too small to trust."
};
const statusStyles = {
  held: {
    badge: "border-primary/30 bg-primary/10 text-primary",
    Icon: Check
  },
  degraded: {
    badge: "border-warning/30 bg-warning/10 text-warning",
    Icon: TriangleAlert
  },
  insufficient: {
    badge: "border-border bg-muted text-muted-foreground",
    Icon: Minus
  }
};
function ValidationTable({
  results,
  selectedId,
  onSelect
}) {
  const [sortKey, setSortKey] = reactExports.useState("inSampleWinRate");
  const [sortDir, setSortDir] = reactExports.useState("desc");
  const [expandedId, setExpandedId] = reactExports.useState(null);
  const sorted = reactExports.useMemo(() => {
    const copy = [...results];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = av - bv;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [results, sortKey, sortDir]);
  const toggleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };
  const handleRowClick = (r) => {
    onSelect(r);
    setExpandedId((prev) => prev === r.patternId ? null : r.patternId);
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "div",
    {
      "data-ocid": "validation_table",
      className: "overflow-hidden rounded-lg border border-border bg-card shadow-subtle",
      children: /* @__PURE__ */ jsxRuntimeExports.jsxs(Table, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(TableHeader, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(TableRow, { className: "border-border bg-muted/30 hover:bg-muted/30", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { className: "w-8 bg-muted/30" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SortableHeader,
            {
              label: "Rank",
              sortKey: "inSampleWinRate",
              activeKey: sortKey,
              dir: sortDir,
              onClick: () => toggleSort("inSampleWinRate"),
              align: "left",
              className: "w-16"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { className: "text-xs font-medium uppercase tracking-wide text-muted-foreground", children: "Conditions" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SortableHeader,
            {
              label: "In-Sample Win %",
              sortKey: "inSampleWinRate",
              activeKey: sortKey,
              dir: sortDir,
              onClick: () => toggleSort("inSampleWinRate"),
              align: "right"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SortableHeader,
            {
              label: "OOS Win %",
              sortKey: "outOfSampleWinRate",
              activeKey: sortKey,
              dir: sortDir,
              onClick: () => toggleSort("outOfSampleWinRate"),
              align: "right"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableHead, { className: "text-right text-xs font-medium uppercase tracking-wide text-muted-foreground", children: "Δ" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SortableHeader,
            {
              label: "Adj. MFE/MAE",
              sortKey: "directionAdjustedMfeMaeRatio",
              activeKey: sortKey,
              dir: sortDir,
              onClick: () => toggleSort("directionAdjustedMfeMaeRatio"),
              align: "right"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SortableHeader,
            {
              label: "Cross-Sym Survival",
              sortKey: "crossSymbolSurvival",
              activeKey: sortKey,
              dir: sortDir,
              onClick: () => toggleSort("crossSymbolSurvival"),
              align: "right"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SortableHeader,
            {
              label: "Sample",
              sortKey: "outOfSampleWinRate",
              activeKey: sortKey,
              dir: sortDir,
              onClick: () => toggleSort("outOfSampleWinRate"),
              align: "right"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            SortableHeader,
            {
              label: "Status",
              sortKey: "degradation",
              activeKey: sortKey,
              dir: sortDir,
              onClick: () => toggleSort("degradation"),
              align: "center"
            }
          )
        ] }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(TableBody, { children: sorted.map((r, idx) => {
          const dropPp = r.inSampleMetrics.winRate - r.outOfSampleMetrics.winRate;
          const isSelected = r.patternId === selectedId;
          const isExpanded = expandedId === r.patternId;
          return /* @__PURE__ */ jsxRuntimeExports.jsx(
            ValidationRow,
            {
              result: r,
              rank: idx + 1,
              isSelected,
              isExpanded,
              dropPp,
              onRowClick: handleRowClick
            },
            r.patternId
          );
        }) })
      ] })
    }
  );
}
function ValidationRow({
  result: r,
  rank,
  isSelected,
  isExpanded,
  dropPp,
  onRowClick
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      TableRow,
      {
        "data-ocid": `validation_table.row.${rank - 1}`,
        onClick: () => onRowClick(r),
        "aria-expanded": isExpanded,
        className: cn(
          "cursor-pointer border-border transition-colors",
          isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/40"
        ),
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { className: "w-8 px-2 text-muted-foreground", children: isExpanded ? /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronDown, { className: "size-3.5", "aria-hidden": "true" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(ChevronRight, { className: "size-3.5", "aria-hidden": "true" }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { className: "font-mono text-xs tabular-nums text-muted-foreground", children: String(rank).padStart(2, "0") }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { className: "max-w-[20rem]", children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "line-clamp-2 text-sm text-foreground", children: r.patternLabel }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            NumericCell,
            {
              value: `${r.inSampleMetrics.winRate.toFixed(1)}`,
              suffix: "%"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            NumericCell,
            {
              value: `${r.outOfSampleMetrics.winRate.toFixed(1)}`,
              suffix: "%"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { className: "text-right", children: /* @__PURE__ */ jsxRuntimeExports.jsx(DeltaPill, { dropPp }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(NumericCell, { value: formatRatio(r.directionAdjustedMfeMaeRatio) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(NumericCell, { value: formatSurvival(r.crossSymbolSurvival) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(TableCell, { className: "text-right font-mono text-xs tabular-nums text-muted-foreground", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-foreground", children: r.outOfSampleMetrics.sampleSize }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-muted-foreground/60", children: [
              " / ",
              r.inSampleMetrics.sampleSize + r.outOfSampleMetrics.sampleSize
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { className: "text-center", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            DegradationBadge,
            {
              outOfSampleWinRate: r.outOfSampleMetrics.winRate,
              inSampleWinRate: r.inSampleMetrics.winRate,
              outOfSampleSampleSize: r.outOfSampleMetrics.sampleSize
            }
          ) })
        ]
      }
    ),
    isExpanded ? /* @__PURE__ */ jsxRuntimeExports.jsx(
      TableRow,
      {
        "data-ocid": `validation_table.detail.${rank - 1}`,
        className: "border-border bg-muted/20 hover:bg-muted/20",
        children: /* @__PURE__ */ jsxRuntimeExports.jsx(TableCell, { colSpan: 10, className: "p-0", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ExpandedDetail, { result: r }) })
      }
    ) : null
  ] });
}
function ExpandedDetail({ result: r }) {
  const bull = r.byMarketCondition.bull;
  const bear = r.byMarketCondition.bear;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-4 px-6 py-4", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h4", { className: "font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground", children: "In-Sample vs Out-of-Sample" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          DetailStat,
          {
            label: "In-Sample Win %",
            value: `${r.inSampleMetrics.winRate.toFixed(1)}%`
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          DetailStat,
          {
            label: "OOS Win %",
            value: `${r.outOfSampleMetrics.winRate.toFixed(1)}%`
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          DetailStat,
          {
            label: "In-Sample Sample",
            value: String(r.inSampleMetrics.sampleSize)
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          DetailStat,
          {
            label: "OOS Sample",
            value: String(r.outOfSampleMetrics.sampleSize)
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          DetailStat,
          {
            label: "In-Sample Avg Move",
            value: formatMove(r.inSampleMetrics.avgMove)
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          DetailStat,
          {
            label: "OOS Avg Move",
            value: formatMove(r.outOfSampleMetrics.avgMove)
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          DetailStat,
          {
            label: "In-Sample MFE / MAE",
            value: `${r.inSampleMetrics.avgMFE.toFixed(1)} / ${r.inSampleMetrics.avgMAE.toFixed(1)}`
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          DetailStat,
          {
            label: "OOS MFE / MAE",
            value: `${r.outOfSampleMetrics.avgMFE.toFixed(1)} / ${r.outOfSampleMetrics.avgMAE.toFixed(1)}`
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h4", { className: "font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground", children: "Robustness Metrics" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          DetailStat,
          {
            label: "Direction-Adjusted MFE/MAE Ratio",
            value: formatRatio(r.directionAdjustedMfeMaeRatio),
            hint: r.directionAdjustedMfeMaeRatio == null ? "Ratio not computable (zero MAE/MFE)." : "MFE/MAE recomputed with direction adjustment so the ratio is meaningful for bearish patterns."
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          DetailStat,
          {
            label: "Cross-Symbol Survival",
            value: formatSurvival(r.crossSymbolSurvival),
            hint: r.crossSymbolSurvival == null ? "No datasets available to evaluate." : "Fraction of symbols/datasets the pattern remains profitable on (0–1)."
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h4", { className: "font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground", children: "By Market Condition" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(ConditionMiniCard, { label: "Bull Periods", metrics: bull }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(ConditionMiniCard, { label: "Bear Periods", metrics: bear })
      ] })
    ] }),
    r.byYear.length > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h4", { className: "font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground", children: "By Year" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-wrap gap-x-4 gap-y-1.5", children: r.byYear.map((y) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "div",
        {
          "data-ocid": `validation_table.detail.year.${y.year}`,
          className: "flex items-center gap-1.5 text-xs",
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono tabular-nums text-muted-foreground", children: y.year }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono tabular-nums text-foreground", children: [
              y.metrics.winRate.toFixed(1),
              "%"
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono tabular-nums text-muted-foreground/70", children: [
              "(n=",
              y.metrics.sampleSize,
              ")"
            ] })
          ]
        },
        y.year
      )) })
    ] }) : null,
    r.degradationNote ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "rounded-md border border-border bg-background/40 px-3 py-2", children: /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: r.degradationNote }) }) : null
  ] });
}
function DetailStat({
  label,
  value,
  hint
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      className: "flex flex-col gap-0.5 rounded-md border border-border bg-background/40 px-3 py-2",
      title: hint,
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-[10px] uppercase tracking-wide text-muted-foreground", children: label }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono text-sm tabular-nums text-foreground", children: value })
      ]
    }
  );
}
function ConditionMiniCard({
  label,
  metrics
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-2 rounded-md border border-border bg-background/40 px-3 py-2", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-display text-xs font-semibold text-foreground", children: label }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-mono text-xs tabular-nums text-muted-foreground", children: [
        "n=",
        metrics.sampleSize
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-3 gap-2 text-center", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(DetailStat, { label: "Win %", value: `${metrics.winRate.toFixed(1)}%` }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(DetailStat, { label: "Avg Move", value: formatMove(metrics.avgMove) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        DetailStat,
        {
          label: "MFE / MAE",
          value: `${metrics.avgMFE.toFixed(1)} / ${metrics.avgMAE.toFixed(1)}`
        }
      )
    ] })
  ] });
}
function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  align,
  className
}) {
  const isActive = sortKey === activeKey;
  const Icon = !isActive ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    TableHead,
    {
      className: cn(
        "text-xs font-medium uppercase tracking-wide text-muted-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className
      ),
      children: /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "button",
        {
          type: "button",
          "data-ocid": `validation_table.sort.${sortKey}`,
          onClick,
          className: cn(
            "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground",
            align === "right" && "flex-row-reverse",
            align === "center" && "flex-row justify-center",
            isActive && "text-foreground"
          ),
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: label }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Icon,
              {
                className: cn("size-3", !isActive && "opacity-40"),
                "aria-hidden": "true"
              }
            )
          ]
        }
      )
    }
  );
}
function NumericCell({
  value,
  suffix
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(TableCell, { className: "text-right font-mono text-xs tabular-nums text-foreground", children: [
    value,
    suffix ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-muted-foreground/70", children: suffix }) : null
  ] });
}
function DeltaPill({ dropPp }) {
  const isDegraded = dropPp > 10;
  const isNeutral = Math.abs(dropPp) <= 0.05;
  const sign = dropPp > 0 ? "-" : dropPp < 0 ? "+" : "";
  const abs = Math.abs(dropPp).toFixed(1);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "span",
    {
      className: cn(
        "inline-flex items-center rounded font-mono text-xs tabular-nums px-1.5 py-0.5",
        isNeutral ? "text-muted-foreground" : isDegraded ? "bg-warning/10 text-warning" : "text-primary"
      ),
      title: isNeutral ? "No meaningful change out-of-sample." : `${sign}${abs}pp vs in-sample`,
      children: [
        isNeutral ? "±0.0" : `${sign}${abs}`,
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-muted-foreground/70", children: "pp" })
      ]
    }
  );
}
function sortValue(r, key) {
  switch (key) {
    case "inSampleWinRate":
      return r.inSampleMetrics.winRate;
    case "outOfSampleWinRate":
      return r.outOfSampleMetrics.winRate;
    case "degradation": {
      if (r.outOfSampleMetrics.sampleSize < 20) return 9999;
      return r.inSampleMetrics.winRate - r.outOfSampleMetrics.winRate;
    }
    case "directionAdjustedMfeMaeRatio":
      return r.directionAdjustedMfeMaeRatio ?? Number.NEGATIVE_INFINITY;
    case "crossSymbolSurvival":
      return r.crossSymbolSurvival ?? Number.NEGATIVE_INFINITY;
  }
}
function formatMove(v) {
  const sign = v > 0 ? "+" : v < 0 ? "" : "";
  return `${sign}${v.toFixed(2)}`;
}
function formatRatio(v) {
  if (v == null) return "—";
  return v.toFixed(2);
}
function formatSurvival(v) {
  if (v == null) return "—";
  return v.toFixed(2);
}
function ValidationPage() {
  const patterns = useEngineStore((s) => s.patterns);
  const validationResults = useEngineStore((s) => s.validationResults);
  const discoveryConfig = useEngineStore((s) => s.discoveryConfig);
  const datasets = useEngineStore((s) => s.datasets);
  const isComputing = useEngineStore((s) => s.isComputing);
  const completedSteps = useEngineStore((s) => s.completedSteps);
  const validateAction = useEngineStore((s) => s.validateAction);
  const setActiveTab = useEngineStore((s) => s.setActiveTab);
  const [selected, setSelected] = reactExports.useState(null);
  const discoveryComplete = completedSteps.has("discoveryComplete");
  const hasResults = validationResults.length > 0;
  const heldUpCount = validationResults.filter(
    (r) => !r.degraded && r.outOfSampleMetrics.sampleSize >= 20
  ).length;
  if (!discoveryComplete || patterns.length === 0) {
    return /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "div",
      {
        "data-ocid": "page.validation",
        className: "mx-auto w-full max-w-5xl p-4 md:p-6",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(PageHeader, {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            EmptyState,
            {
              icon: Sparkles,
              title: "No patterns to validate yet",
              description: "Run Pattern Discovery first to find candidate patterns. Validation then re-tests the top patterns on unseen data to see which ones actually hold up.",
              actionLabel: "Go to Pattern Discovery",
              onAction: () => setActiveTab("discovery"),
              hint: "Validation splits your data 70/30 chronologically — the first 70% trains, the last 30% tests."
            }
          )
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      "data-ocid": "page.validation",
      className: "mx-auto w-full max-w-6xl p-4 md:p-6",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(PageHeader, {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            Button,
            {
              "data-ocid": "validation.validate_button",
              onClick: validateAction,
              disabled: isComputing,
              size: "lg",
              children: [
                isComputing ? /* @__PURE__ */ jsxRuntimeExports.jsx(LoaderCircle, { className: "size-4 animate-spin", "aria-hidden": "true" }) : /* @__PURE__ */ jsxRuntimeExports.jsx(Play, { className: "size-4", "aria-hidden": "true" }),
                hasResults ? "Re-run Validation" : "Validate Patterns"
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm text-muted-foreground", children: [
            "Tests the top ",
            Math.min(patterns.length, 20),
            " discovered patterns on a 70/30 chronological split across ",
            datasets.length,
            " dataset",
            datasets.length === 1 ? "" : "s",
            "."
          ] })
        ] }) }),
        isComputing && !hasResults ? /* @__PURE__ */ jsxRuntimeExports.jsx(ComputingState, {}) : null,
        hasResults ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(SummaryBar, { total: validationResults.length, heldUp: heldUpCount }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mb-5", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ValidationAggregate, { results: validationResults }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-1 gap-5 lg:grid-cols-5", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "div",
              {
                className: selected ? "lg:col-span-3" : "lg:col-span-5",
                "data-ocid": "validation.table_panel",
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    ValidationTable,
                    {
                      results: validationResults,
                      selectedId: (selected == null ? void 0 : selected.patternId) ?? null,
                      onSelect: (r) => setSelected(r)
                    }
                  ),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-xs text-muted-foreground", children: "Click a row to expand the full metric breakdown — in-sample vs out-of-sample, market-condition split, year-by-year, direction-adjusted MFE/MAE ratio, and cross-symbol survival." })
                ]
              }
            ),
            selected ? /* @__PURE__ */ jsxRuntimeExports.jsx(
              "div",
              {
                className: "lg:col-span-2",
                "data-ocid": "validation.breakdown_panel",
                children: /* @__PURE__ */ jsxRuntimeExports.jsx(
                  ValidationBreakdown,
                  {
                    result: selected,
                    onClose: () => setSelected(null)
                  }
                )
              }
            ) : null
          ] })
        ] }) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "sr-only", "aria-hidden": "true", children: [
          discoveryConfig.horizon,
          "-bar horizon, ",
          discoveryConfig.mfeMaeWindow,
          "-bar MFE/MAE window."
        ] })
      ]
    }
  );
}
function PageHeader() {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mb-5 flex items-center gap-3", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex size-10 items-center justify-center rounded-md border border-border bg-card", children: /* @__PURE__ */ jsxRuntimeExports.jsx(FlaskConical, { className: "size-5 text-primary", "aria-hidden": "true" }) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg font-semibold text-foreground", children: "Validation" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: "Do the discovered patterns actually hold up on unseen data?" })
    ] })
  ] });
}
function SummaryBar({
  total,
  heldUp
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      "data-ocid": "validation.summary",
      className: "mb-5 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-subtle",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          ShieldCheck,
          {
            className: "size-5 text-primary shrink-0",
            "aria-hidden": "true"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm text-foreground", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono tabular-nums font-semibold", children: total }),
          " ",
          "pattern",
          total === 1 ? "" : "s",
          " validated,",
          " ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-mono tabular-nums font-semibold text-primary", children: heldUp }),
          " ",
          "held up out-of-sample."
        ] })
      ]
    }
  );
}
function ComputingState() {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      "data-ocid": "validation.loading_state",
      className: "flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-card/40 px-6 py-16 text-center",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          LoaderCircle,
          {
            className: "size-8 animate-spin text-primary",
            "aria-hidden": "true"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-col gap-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "font-display text-base font-semibold text-foreground", children: "Validating patterns…" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted-foreground", children: "Splitting the dataset 70/30 and re-testing each top pattern on both halves." })
        ] })
      ]
    }
  );
}
export {
  ValidationPage as default
};
