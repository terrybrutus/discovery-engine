import { cn } from "@/lib/utils";
import type { Dataset, Feature, Pattern, ValidationResult } from "@/types";
import {
  CalendarRange,
  CheckCircle2,
  Database,
  GitBranch,
  Layers,
  Target,
} from "lucide-react";
import { useMemo } from "react";

interface ResearchOverviewProps {
  dataset: Dataset;
  features: Feature[];
  patterns: Pattern[];
  validationResults: ValidationResult[];
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Overall research summary — a clean stat grid describing the dataset,
 * features generated, combinations tested, patterns discovered, and how
 * many validated out-of-sample. Reads like the header of a research brief.
 */
export function ResearchOverview({
  dataset,
  features,
  patterns,
  validationResults,
}: ResearchOverviewProps) {
  const enabledFeatures = useMemo(
    () => features.filter((f) => f.enabled),
    [features],
  );
  const validatedCount = useMemo(
    () => validationResults.filter((v) => !v.degraded).length,
    [validationResults],
  );
  const dateSpan = useMemo(() => {
    const days = Math.round(
      (dataset.dateRange.end - dataset.dateRange.start) / (1000 * 60 * 60 * 24),
    );
    if (days >= 365) {
      const years = (days / 365).toFixed(1);
      return `${years} years`;
    }
    return `${days.toLocaleString()} days`;
  }, [dataset.dateRange]);

  const stats = [
    {
      icon: Database,
      label: "Dataset",
      value: dataset.name,
      sub: `${dataset.rowCount.toLocaleString()} bars · ${dataset.timeframe}`,
      mono: false,
    },
    {
      icon: CalendarRange,
      label: "Time Period",
      value: `${fmtDate(dataset.dateRange.start)} → ${fmtDate(dataset.dateRange.end)}`,
      sub: dateSpan,
      mono: true,
    },
    {
      icon: Layers,
      label: "Features Generated",
      value: enabledFeatures.length.toLocaleString(),
      sub: `across ${new Set(enabledFeatures.map((f) => f.category)).size} categories`,
      mono: true,
    },
    {
      icon: GitBranch,
      label: "Combinations Tested",
      value: patterns.length.toLocaleString(),
      sub: "2–4 conditions each",
      mono: true,
    },
    {
      icon: Target,
      label: "Patterns Discovered",
      value: patterns.length.toLocaleString(),
      sub: "met thresholds",
      mono: true,
    },
    {
      icon: CheckCircle2,
      label: "Validated Out-of-Sample",
      value: `${validatedCount}/${validationResults.length}`,
      sub:
        validationResults.length === 0
          ? "not yet validated"
          : validatedCount === validationResults.length
            ? "all held up"
            : `${validationResults.length - validatedCount} degraded`,
      mono: true,
    },
  ];

  return (
    <section
      data-ocid="report.research_overview"
      aria-labelledby="research-overview-title"
      className="rounded-lg border border-border bg-card p-5"
    >
      <div className="mb-4 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          01
        </span>
        <h2
          id="research-overview-title"
          className="font-display text-base font-semibold text-foreground"
        >
          Research Overview
        </h2>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s, i) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              data-ocid={`report.research_overview.stat.${i}`}
              className="flex flex-col gap-1.5 rounded-md border border-border bg-background/40 p-3"
            >
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Icon className="size-3.5" aria-hidden="true" />
                <dt className="text-[10px] font-medium uppercase tracking-wide">
                  {s.label}
                </dt>
              </div>
              <dd
                className={cn(
                  "min-w-0 break-words leading-tight text-foreground",
                  s.mono
                    ? "font-mono text-sm tabular-nums"
                    : "font-display text-sm font-semibold",
                )}
              >
                {s.value}
              </dd>
              <p className="text-[10px] leading-tight text-muted-foreground/80 tabular-nums">
                {s.sub}
              </p>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
