import { DiscoveryCard } from "@/components/DiscoveryCard";
import { ResearchOverview } from "@/components/ResearchOverview";
import { Button } from "@/components/ui/button";
import type {
  Dataset,
  Feature,
  Pattern,
  Report,
  ValidationResult,
} from "@/types";
import { FileText, Printer } from "lucide-react";

interface ReportSummaryProps {
  report: Report;
  dataset: Dataset;
  features: Feature[];
  patterns: Pattern[];
  validationResults: ValidationResult[];
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The full report document. Renders a research-brief layout: research
 * overview at top, top discoveries as DiscoveryCards, then the narrative
 * sections (dataset, features, discovery, validation, methodology).
 * Clean typography, readable for non-developers. Print-friendly.
 */
export function ReportSummary({
  report,
  dataset,
  features,
  patterns,
  validationResults,
}: ReportSummaryProps) {
  const handlePrint = () => window.print();

  // Build a lookup of validation results by pattern id.
  const validationById = new Map(
    validationResults.map((v) => [v.patternId, v]),
  );

  // Match report.topDiscoveries back to the source patterns by rank order.
  const topPatterns = patterns.slice(0, report.topDiscoveries.length);

  return (
    <div data-ocid="report.summary" className="flex flex-col gap-5">
      {/* Document header */}
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-5 print:border-0 print:shadow-none">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-primary" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Research Brief
            </span>
          </div>
          <h2 className="font-display text-xl font-semibold text-foreground">
            Trading Pattern Discovery Report
          </h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            Generated {fmtDate(report.generatedAt)} · {dataset.name}
          </p>
        </div>
        <Button
          data-ocid="report.print_button"
          variant="outline"
          size="sm"
          onClick={handlePrint}
          className="print:hidden"
        >
          <Printer className="size-4" aria-hidden="true" />
          Print
        </Button>
      </header>

      {/* Executive summary */}
      <section
        data-ocid="report.executive_summary"
        className="rounded-lg border border-primary/30 bg-primary/5 p-5"
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Summary
          </span>
        </div>
        <p className="text-sm leading-relaxed text-foreground">
          {report.summary}
        </p>
      </section>

      {/* Research overview stat grid */}
      <ResearchOverview
        dataset={dataset}
        features={features}
        patterns={patterns}
        validationResults={validationResults}
      />

      {/* Top discoveries */}
      <section
        data-ocid="report.top_discoveries"
        aria-labelledby="top-discoveries-title"
        className="flex flex-col gap-3"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            02
          </span>
          <h2
            id="top-discoveries-title"
            className="font-display text-base font-semibold text-foreground"
          >
            Top Discoveries
          </h2>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The strongest patterns found, ranked by statistical strength. Each
          card shows the conditions in plain English, the probability of the
          predicted move, the average move size, the sample size, and a
          confidence rating.
        </p>
        <div className="flex flex-col gap-3">
          {topPatterns.map((p, i) => {
            const v = validationById.get(p.id);
            // Strip the leading "When " so the card reads like the example:
            // "Monday, 2:55 PM, Price below VWAP, …"
            const conditions = p.label.replace(/^When\s+/i, "");
            return (
              <DiscoveryCard
                key={p.id}
                rank={i + 1}
                conditions={conditions}
                direction={p.direction}
                winRate={p.winRate}
                avgMove={p.avgMove}
                sampleSize={p.sampleSize}
                confidence={p.confidence}
                avgMAE={p.avgMAE}
                avgMFE={p.avgMFE}
                degraded={v?.degraded ?? false}
              />
            );
          })}
        </div>
      </section>

      {/* Narrative sections */}
      {report.sections
        .filter((s) => s.id !== "top-discoveries")
        .map((section, idx) => (
          <section
            key={section.id}
            data-ocid={`report.section.${section.id}`}
            aria-labelledby={`section-${section.id}-title`}
            className="rounded-lg border border-border bg-card p-5"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {String(idx + 3).padStart(2, "0")}
              </span>
              <h2
                id={`section-${section.id}-title`}
                className="font-display text-base font-semibold text-foreground"
              >
                {section.title}
              </h2>
            </div>
            <div className="flex flex-col gap-2.5">
              {section.paragraphs.map((para, i) => (
                <p
                  key={`${section.id}-${i}`}
                  className="text-sm leading-relaxed text-muted-foreground"
                >
                  {para}
                </p>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
