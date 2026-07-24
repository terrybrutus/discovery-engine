import { cn } from "@/lib/utils";
import type { Dataset } from "@/types";
import { Check, Database, Info, Layers } from "lucide-react";

interface DatasetSelectorProps {
  /** All loaded datasets in this session. */
  datasets: Dataset[];
  /** Id of the currently active dataset, or null if none. */
  activeDatasetId: string | null;
  /** Called when the user picks a dataset to make active. */
  onSelect: (id: string) => void;
  /** Datasets included in automatic multi-timeframe analysis. */
  selectedDatasetIds?: string[];
  /** Toggle inclusion without changing the active feature dataset. */
  onToggleSelected?: (id: string) => void;
}

/**
 * Compact list of all loaded datasets with the active one highlighted.
 * Lets the user switch the active dataset directly from the discovery
 * page. Includes a help line clarifying that discovery runs against one
 * dataset at a time while cross-reference uses multiple.
 *
 * This component is presentational — it does not touch the store. The
 * parent wires `datasets`, `activeDatasetId`, and `onSelect` (typically
 * `useEngineStore`'s `setActiveDataset`).
 */
export function DatasetSelector({
  datasets,
  activeDatasetId,
  onSelect,
  selectedDatasetIds,
  onToggleSelected,
}: DatasetSelectorProps) {
  if (datasets.length === 0) {
    return (
      <div
        data-ocid="dataset_selector"
        className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-4"
      >
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-primary" aria-hidden="true" />
          <h2 className="font-display text-sm font-semibold text-foreground">
            Active dataset
          </h2>
        </div>
        <p
          data-ocid="dataset_selector.empty_state"
          className="text-sm text-muted-foreground"
        >
          No datasets loaded yet. Use{" "}
          <span className="text-foreground font-medium">Load Data</span> to
          upload one or more CSV, TXT, or MD files.
        </p>
      </div>
    );
  }

  return (
    <div
      data-ocid="dataset_selector"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-primary" aria-hidden="true" />
          <h2 className="font-display text-sm font-semibold text-foreground">
            Active dataset
          </h2>
        </div>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {selectedDatasetIds
            ? `${selectedDatasetIds.length}/${datasets.length} included`
            : `${datasets.length} loaded`}
        </span>
      </div>

      <ul
        data-ocid="dataset_selector.list"
        className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto"
      >
        {datasets.map((ds, i) => {
          const isActive = ds.id === activeDatasetId;
          const label = ds.label ?? ds.name;
          return (
            <li
              key={ds.id}
              className={cn(
                "flex w-full items-center rounded-md border transition-smooth",
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-border bg-background/40 hover:border-primary/40 hover:bg-card/60",
              )}
            >
              {selectedDatasetIds && onToggleSelected ? (
                <input
                  type="checkbox"
                  checked={selectedDatasetIds.includes(ds.id)}
                  onChange={() => onToggleSelected(ds.id)}
                  aria-label={`Include ${label} in multi-timeframe analysis`}
                  className="ml-3 size-4 shrink-0 accent-[oklch(var(--primary))]"
                />
              ) : null}
              <button
                type="button"
                data-ocid={`dataset_selector.item.${i + 1}`}
                data-active={isActive ? "true" : "false"}
                aria-pressed={isActive}
                onClick={() => onSelect(ds.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {isActive ? (
                  <Check
                    className="size-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                ) : (
                  <Database
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {label}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {ds.rowCount.toLocaleString()} · {ds.timeframe}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div
        data-ocid="dataset_selector.help"
        className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
      >
        <Info
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          The highlighted dataset supplies the base patterns. Checked datasets
          are automatically cross-referenced during the same discovery run.
        </p>
      </div>
    </div>
  );
}
