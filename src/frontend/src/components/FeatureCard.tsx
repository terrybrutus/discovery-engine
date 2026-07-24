import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Feature } from "@/types";
import {
  ChevronRight,
  Hash,
  Package,
  ToggleLeft,
  ToggleRight,
  Upload,
} from "lucide-react";
import { useState } from "react";

interface FeatureCardProps {
  feature: Feature;
  enabled: boolean;
  onToggle: (featureId: string, enabled: boolean) => void;
}

/**
 * Compact, scannable card for a single feature. Shows name, category badge,
 * source badge (Built-in vs Custom), plain-English description, type
 * indicator (categorical with buckets, or numeric), and a toggle switch to
 * enable/disable the feature for pattern testing.
 *
 * When a `formula` is present, an expandable "Formula" section reveals the
 * exact computation string so the glossary stays scannable but transparent.
 */
export function FeatureCard({ feature, enabled, onToggle }: FeatureCardProps) {
  const isCategorical = feature.type === "categorical";
  const isCustom = feature.source === "custom";
  const [formulaOpen, setFormulaOpen] = useState(false);

  return (
    <div
      data-ocid="feature_card"
      className={cn(
        "group relative flex flex-col gap-2.5 rounded-lg border bg-card p-3 transition-smooth",
        enabled
          ? "border-primary/40 shadow-subtle"
          : "border-border opacity-70 hover:opacity-100",
      )}
    >
      {/* Header row: name + toggle */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h4 className="font-display text-sm font-semibold leading-tight text-foreground">
            {feature.name}
          </h4>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="secondary"
              className="text-[10px] font-medium uppercase tracking-wide"
            >
              {feature.category}
            </Badge>
            <Badge
              variant="outline"
              data-ocid={`feature_card.source_badge.${feature.id}`}
              className={cn(
                "gap-1 text-[10px] font-medium uppercase tracking-wide",
                isCustom
                  ? "border-primary/40 text-primary"
                  : "border-border text-muted-foreground",
              )}
            >
              {isCustom ? (
                <Upload className="size-2.5" aria-hidden="true" />
              ) : (
                <Package className="size-2.5" aria-hidden="true" />
              )}
              {isCustom ? "Custom" : "Built-in"}
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "text-[10px] font-medium uppercase tracking-wide tabular-nums",
              enabled ? "text-primary" : "text-muted-foreground",
            )}
          >
            {enabled ? "On" : "Off"}
          </span>
          <Switch
            data-ocid={`feature_card.toggle.${feature.id}`}
            checked={enabled}
            onCheckedChange={(checked) => onToggle(feature.id, checked)}
            aria-label={`${enabled ? "Disable" : "Enable"} ${feature.name}`}
          />
        </div>
      </div>

      {/* Plain-English description */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {feature.description}
      </p>

      {/* Type indicator + buckets / range */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        {isCategorical ? (
          <>
            <span className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Hash className="size-2.5" aria-hidden="true" />
              Categorical
            </span>
            <span className="text-[10px] text-muted-foreground/70 tabular-nums">
              {feature.buckets?.length ?? 0} buckets
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {enabled ? (
              <ToggleRight
                className="size-2.5 text-primary"
                aria-hidden="true"
              />
            ) : (
              <ToggleLeft className="size-2.5" aria-hidden="true" />
            )}
            Numeric
          </span>
        )}
      </div>

      {/* Bucket labels for categorical features */}
      {isCategorical && feature.buckets && feature.buckets.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {feature.buckets.map((bucket) => (
            <span
              key={bucket}
              className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {bucket}
            </span>
          ))}
        </div>
      ) : null}

      {/* Range hint for numeric features */}
      {!isCategorical && feature.range ? (
        <div className="font-mono text-[10px] text-muted-foreground/70 tabular-nums">
          range {feature.range[0]} → {feature.range[1]}
        </div>
      ) : null}

      {/* Formula — expandable glossary section. Only rendered when a
          formula string is present so cards without one stay compact. */}
      {feature.formula ? (
        <Collapsible
          open={formulaOpen}
          onOpenChange={setFormulaOpen}
          data-ocid={`feature_card.formula.${feature.id}`}
          className="rounded border border-border bg-muted/30"
        >
          <CollapsibleTrigger
            data-ocid={`feature_card.formula_trigger.${feature.id}`}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
            aria-label={`${formulaOpen ? "Hide" : "Show"} formula for ${feature.name}`}
          >
            <ChevronRight
              className={cn(
                "size-3 text-muted-foreground transition-transform",
                formulaOpen && "rotate-90",
              )}
              aria-hidden="true"
            />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Formula
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border px-2 py-2">
              <code className="block font-mono text-[11px] leading-relaxed text-foreground break-words">
                {feature.formula}
              </code>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
