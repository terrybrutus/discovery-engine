import { FeatureCard } from "@/components/FeatureCard";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Feature, FeatureCategory } from "@/types";
import {
  ChevronDown,
  ChevronRight,
  Package,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

type SourceFilter = "all" | "builtin" | "custom";

interface FeatureCatalogProps {
  features: Feature[];
  /** Map of featureId -> enabled, owned by the parent page. */
  enabledMap: Record<string, boolean>;
  onToggle: (featureId: string, enabled: boolean) => void;
  onSetCategoryEnabled: (category: FeatureCategory, enabled: boolean) => void;
}

const SOURCE_FILTERS: {
  id: SourceFilter;
  label: string;
  icon: typeof Package;
}[] = [
  { id: "all", label: "All", icon: Package },
  { id: "builtin", label: "Built-in", icon: Package },
  { id: "custom", label: "Custom", icon: Upload },
];

/**
 * Browsable feature catalog. Groups features by category into collapsible
 * sections, with per-category Select All / Deselect All, a feature count, and
 * a search/filter box to find features by name.
 */
export function FeatureCatalog({
  features,
  enabledMap,
  onToggle,
  onSetCategoryEnabled,
}: FeatureCatalogProps) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [openCategories, setOpenCategories] = useState<Set<FeatureCategory>>(
    () => new Set<FeatureCategory>(),
  );

  // Group features by category, preserving first-seen order.
  const grouped = useMemo(() => {
    const map = new Map<FeatureCategory, Feature[]>();
    for (const f of features) {
      const arr = map.get(f.category) ?? [];
      arr.push(f);
      map.set(f.category, arr);
    }
    return map;
  }, [features]);

  // Filter by search query (name + description, case-insensitive) and by
  // source (built-in vs custom). Source filter narrows which features are
  // eligible before grouping so empty categories drop out cleanly.
  const filteredGrouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<FeatureCategory, Feature[]>();
    for (const [cat, feats] of grouped) {
      const matched = feats.filter((f) => {
        if (sourceFilter === "builtin" && f.source !== "builtin") return false;
        if (sourceFilter === "custom" && f.source !== "custom") return false;
        if (!q) return true;
        return (
          f.name.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          f.id.toLowerCase().includes(q)
        );
      });
      if (matched.length) out.set(cat, matched);
    }
    return out;
  }, [grouped, query, sourceFilter]);

  const toggleCategory = (cat: FeatureCategory) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const expandAll = () =>
    setOpenCategories(
      new Set(grouped.keys() as IterableIterator<FeatureCategory>),
    );
  const collapseAll = () => setOpenCategories(new Set<FeatureCategory>());

  const totalCategories = grouped.size;
  const totalMatched = Array.from(filteredGrouped.values()).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const hasCustom = features.some((f) => f.source === "custom");

  return (
    <div
      data-ocid="feature_catalog"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-3"
    >
      {/* Search + source filter + bulk controls */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            data-ocid="feature_catalog.search_input"
            type="search"
            placeholder="Search features by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 pr-9"
            aria-label="Search features"
          />
          {query ? (
            <button
              type="button"
              data-ocid="feature_catalog.clear_search_button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="Clear search"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {totalMatched} of {features.length} features · {totalCategories}{" "}
            {totalCategories === 1 ? "category" : "categories"}
          </span>
          <Button
            data-ocid="feature_catalog.expand_all_button"
            variant="ghost"
            size="sm"
            onClick={expandAll}
          >
            Expand all
          </Button>
          <Button
            data-ocid="feature_catalog.collapse_all_button"
            variant="ghost"
            size="sm"
            onClick={collapseAll}
          >
            Collapse all
          </Button>
        </div>
      </div>

      {/* Source filter — All / Built-in / Custom. Only show the Custom
          option when uploaded columns actually produced custom features. */}
      <fieldset
        className="flex items-center gap-1.5 border-0 p-0 m-0"
        aria-label="Filter features by source"
      >
        {SOURCE_FILTERS.map((opt) => {
          if (opt.id === "custom" && !hasCustom) return null;
          const Icon = opt.icon;
          const active = sourceFilter === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              data-ocid={`feature_catalog.source_filter.${opt.id}`}
              aria-pressed={active}
              onClick={() => setSourceFilter(opt.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3" aria-hidden="true" />
              {opt.label}
            </button>
          );
        })}
      </fieldset>

      {/* Category sections */}
      <ScrollArea className="max-h-[640px]">
        <div className="flex flex-col gap-2 pr-2">
          {filteredGrouped.size === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {query
                ? `No features match "${query}"`
                : sourceFilter === "custom"
                  ? "No custom (uploaded-column) features available. Upload a dataset with non-OHLCV columns to generate custom features."
                  : sourceFilter === "builtin"
                    ? "No built-in features available."
                    : "No features available."}
            </div>
          ) : null}
          {Array.from(filteredGrouped.entries()).map(([category, feats]) => {
            const isOpen = openCategories.has(category);
            const enabledCount = feats.filter(
              (f) => enabledMap[f.id] ?? f.enabled,
            ).length;
            const allEnabled = enabledCount === feats.length;
            return (
              <Collapsible
                key={category}
                open={isOpen}
                onOpenChange={() => toggleCategory(category)}
                data-ocid={`feature_catalog.category.${category.toLowerCase().replace(/\s+/g, "_")}`}
                className="rounded-md border border-border bg-card"
              >
                <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <CollapsibleTrigger
                    data-ocid={`feature_catalog.category_trigger.${category.toLowerCase().replace(/\s+/g, "_")}`}
                    className="flex flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
                  >
                    {isOpen ? (
                      <ChevronDown
                        className="size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        className="size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <span className="font-display text-sm font-semibold text-foreground">
                      {category}
                    </span>
                    <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                      {feats.length}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                      {enabledCount}/{feats.length} on
                    </span>
                  </CollapsibleTrigger>
                  <Button
                    data-ocid={`feature_catalog.${allEnabled ? "deselect_all" : "select_all"}.${category.toLowerCase().replace(/\s+/g, "_")}`}
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => onSetCategoryEnabled(category, !allEnabled)}
                  >
                    {allEnabled ? "Deselect all" : "Select all"}
                  </Button>
                </div>
                <CollapsibleContent>
                  <div
                    className={cn(
                      "grid grid-cols-1 gap-2 border-t border-border px-3 py-3",
                      "sm:grid-cols-2 lg:grid-cols-3",
                    )}
                  >
                    {feats.map((f) => (
                      <FeatureCard
                        key={f.id}
                        feature={f}
                        enabled={enabledMap[f.id] ?? f.enabled}
                        onToggle={onToggle}
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
