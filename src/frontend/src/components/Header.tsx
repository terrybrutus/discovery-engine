import { LoadDataModal } from "@/components/LoadDataModal";
import { Button } from "@/components/ui/button";
import { useEngineStore } from "@/store/engineStore";
import { Activity, Database, Layers, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * App header: title, current dataset pill, and a Load Data button that
 * opens a modal dialog (LoadDataModal) wrapping the multi-file DataIntake
 * upload flow. The modal closes automatically once a dataset loads.
 *
 * The dataset pill makes clear that multiple files may be loaded even
 * though discovery runs against one at a time. When more than one dataset
 * is loaded, the pill shows a count plus the active dataset name
 * (e.g. "3 datasets · NQ_5m.csv"). When only one is loaded, it shows just
 * the name. The tooltip retains the date range.
 */
export function Header() {
  const dataset = useEngineStore((s) => s.dataset);
  const datasets = useEngineStore((s) => s.datasets);
  const selectedDatasetIds = useEngineStore((s) => s.selectedDatasetIds);
  const targetMode = useEngineStore((s) => s.targetMode);
  const loadSampleDataset = useEngineStore((s) => s.loadSampleDataset);
  const [loadModalOpen, setLoadModalOpen] = useState(false);

  const total = datasets.length;
  const selectedRows = datasets
    .filter((loadedDataset) => selectedDatasetIds.includes(loadedDataset.id))
    .reduce((sum, loadedDataset) => sum + loadedDataset.rowCount, 0);
  const activeName = dataset?.label ?? dataset?.name ?? "";
  const pillLabel =
    total > 1
      ? `${total} datasets · ${activeName}`
      : total === 1
        ? activeName
        : "";

  const tooltip = dataset
    ? targetMode === "all"
      ? "Every selected dataset is tested as an outcome target in turn; the others provide causally aligned context."
      : `${selectedDatasetIds.length} selected datasets contribute causally aligned context. "${activeName}" is the explicit prediction target with ${dataset.rowCount.toLocaleString()} outcome bars.`
    : undefined;

  return (
    <header
      data-ocid="header"
      className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-3 shadow-subtle md:px-6"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-9 items-center justify-center rounded-md border border-border bg-background">
          <Activity className="size-5 text-primary" aria-hidden="true" />
        </div>
        <div className="flex flex-col min-w-0">
          <h1 className="font-display text-base font-semibold leading-tight text-foreground md:text-lg">
            Trading Discovery Engine
          </h1>
          <p className="hidden text-xs text-muted-foreground md:block">
            Find repeating market patterns in your data — runs entirely in your
            browser.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        {dataset ? (
          <div
            data-ocid="header.dataset_pill"
            className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5"
            title={tooltip}
          >
            {total > 1 ? (
              <Layers className="size-3.5 text-primary" aria-hidden="true" />
            ) : (
              <Database className="size-3.5 text-primary" aria-hidden="true" />
            )}
            <span className="truncate font-mono text-xs text-foreground max-w-[10rem] sm:max-w-[14rem] md:max-w-[20rem]">
              {pillLabel}
            </span>
            <span className="hidden text-xs text-muted-foreground tabular-nums md:inline">
              · {selectedDatasetIds.length}/{total} selected ·{" "}
              {selectedRows.toLocaleString()} research bars ·{" "}
              {targetMode === "all"
                ? "all selected targets"
                : `${dataset.rowCount.toLocaleString()} target bars`}
            </span>
          </div>
        ) : null}
        <Button
          data-ocid="header.load_data_button"
          variant="outline"
          size="sm"
          onClick={() => setLoadModalOpen(true)}
        >
          <Upload className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Load Data</span>
        </Button>
        <Button
          data-ocid="header.sample_data_button"
          variant="ghost"
          size="sm"
          onClick={() => {
            loadSampleDataset();
            toast.success("Sample dataset loaded.");
          }}
        >
          <span className="hidden sm:inline">Use Sample</span>
          <span className="sm:hidden">Sample</span>
        </Button>
      </div>

      <LoadDataModal open={loadModalOpen} onOpenChange={setLoadModalOpen} />
    </header>
  );
}
