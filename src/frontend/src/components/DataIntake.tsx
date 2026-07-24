import { Button } from "@/components/ui/button";
import { isAcceptedFile, parseCsvFile } from "@/lib/csvParser";
import { cn } from "@/lib/utils";
import { useEngineStore } from "@/store/engineStore";
import type { Dataset } from "@/types";
import {
  AlertCircle,
  Check,
  FileUp,
  FlaskConical,
  Loader2,
  Pencil,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Main data loading interface. Accepts multiple CSV/TXT/MD files, parses
 * each into a Dataset, and renders a manageable list of loaded datasets
 * with editable labels, row counts, and column preview chips. Shown when
 * no dataset is loaded, or inside the Load Data modal.
 */
export function DataIntake({ onLoaded }: { onLoaded?: () => void } = {}) {
  const datasets = useEngineStore((s) => s.datasets);
  const activeDatasetId = useEngineStore((s) => s.activeDatasetId);
  const addDataset = useEngineStore((s) => s.addDataset);
  const removeDataset = useEngineStore((s) => s.removeDataset);
  const setActiveDataset = useEngineStore((s) => s.setActiveDataset);
  const renameDataset = useEngineStore((s) => s.renameDataset);
  const loadSampleDataset = useEngineStore((s) => s.loadSampleDataset);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      setError(null);
      const files = Array.from(fileList);
      if (files.length === 0) return;

      const rejected: string[] = [];
      const accepted = files.filter((f) => {
        if (isAcceptedFile(f)) return true;
        rejected.push(f.name);
        return false;
      });

      if (rejected.length > 0) {
        const msg = `"${rejected.join('", "')}" ${
          rejected.length === 1
            ? "isn't a supported file"
            : "aren't supported files"
        }. Please choose CSV, TXT, or MD files with a header row.`;
        setError(msg);
        toast.error(msg);
      }

      if (accepted.length === 0) return;

      setIsParsing(true);
      let loadedCount = 0;
      let lastError: string | null = null;
      for (const file of accepted) {
        try {
          const result = await parseCsvFile(file);
          if (result.error) {
            lastError = result.error;
            toast.error(`${file.name}: ${result.error}`);
          } else if (result.dataset) {
            addDataset(result.dataset);
            loadedCount++;
          }
        } catch (e) {
          lastError =
            e instanceof Error
              ? e.message
              : `Something went wrong reading "${file.name}".`;
          toast.error(`${file.name}: ${lastError}`);
        }
      }
      setIsParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";

      if (loadedCount > 0) {
        const noun = loadedCount === 1 ? "dataset" : "datasets";
        toast.success(`Loaded ${loadedCount} ${noun}.`);
        onLoaded?.();
      } else if (lastError && !error) {
        setError(lastError);
      }
    },
    [addDataset, error, onLoaded],
  );

  const handleSample = useCallback(() => {
    setError(null);
    loadSampleDataset();
    toast.success("Sample dataset loaded — ready to run.");
    onLoaded?.();
  }, [loadSampleDataset, onLoaded]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (isParsing) return;
      const files = e.dataTransfer.files;
      if (files && files.length > 0) handleFiles(files);
    },
    [handleFiles, isParsing],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isParsing) setIsDragging(true);
    },
    [isParsing],
  );

  const onDragLeave = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const commitRename = useCallback(
    (id: string) => {
      const trimmed = draftLabel.trim();
      if (trimmed) renameDataset(id, trimmed);
      setEditingId(null);
      setDraftLabel("");
    },
    [draftLabel, renameDataset],
  );

  // Cancel inline edit on Escape.
  useEffect(() => {
    if (!editingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditingId(null);
        setDraftLabel("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId]);

  return (
    <div data-ocid="data_intake" className="flex flex-col gap-4">
      {/* Drop zone */}
      <button
        type="button"
        data-ocid="data_intake.dropzone"
        aria-label="Drop CSV, TXT, or MD files here, or activate to choose files"
        onClick={() => !isParsing && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isParsing) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDragEnd={onDragLeave}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-smooth outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-card/40 hover:border-primary/60 hover:bg-card/60",
          isParsing && "pointer-events-none opacity-70",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.txt,.md"
          className="hidden"
          data-ocid="data_intake.file_input"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
          }}
        />
        <div
          className={cn(
            "flex size-14 items-center justify-center rounded-full border transition-smooth",
            isDragging
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-muted/50 text-muted-foreground group-hover:text-primary",
          )}
        >
          {isParsing ? (
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          ) : (
            <UploadCloud className="size-6" aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-display text-sm font-semibold text-foreground">
            {isParsing
              ? "Reading your files…"
              : isDragging
                ? "Drop your files here"
                : "Drag & drop CSV, TXT, or MD files here"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isParsing
              ? "This only takes a moment."
              : "Or click to browse. A timestamp plus at least one numeric field is required; OHLCV and imported indicators are detected only when present."}
          </p>
        </div>
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          or
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          data-ocid="data_intake.browse_button"
          variant="outline"
          className="flex-1"
          onClick={() => fileInputRef.current?.click()}
          disabled={isParsing}
        >
          <FileUp className="size-4" aria-hidden="true" />
          Choose Files
        </Button>
        <Button
          data-ocid="data_intake.sample_button"
          variant="default"
          className="flex-1"
          onClick={handleSample}
          disabled={isParsing}
        >
          <FlaskConical className="size-4" aria-hidden="true" />
          Use Sample Dataset
        </Button>
      </div>

      {/* Dataset list — scrolls independently so the modal header and
          action buttons stay visible when many datasets are loaded. */}
      {datasets.length > 0 ? (
        <div
          data-ocid="data_intake.dataset_list"
          className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto rounded-md border border-border bg-background/40 p-2"
        >
          <div className="flex sticky top-0 items-center justify-between bg-background/80 px-1 py-1 backdrop-blur-sm">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Loaded datasets ({datasets.length})
            </span>
            <span className="text-[11px] text-muted-foreground/70">
              Inspect a file; this does not make it primary.
            </span>
          </div>
          {datasets.map((ds, i) => (
            <DatasetCard
              key={ds.id}
              dataset={ds}
              index={i}
              isActive={ds.id === activeDatasetId}
              isEditing={editingId === ds.id}
              draftLabel={draftLabel}
              onActivate={() => setActiveDataset(ds.id)}
              onRemove={() => {
                removeDataset(ds.id);
                toast.success(`Removed "${ds.label ?? ds.name}".`);
              }}
              onStartEdit={() => {
                setEditingId(ds.id);
                setDraftLabel(ds.label ?? ds.name);
              }}
              onDraftChange={setDraftLabel}
              onCommitRename={() => commitRename(ds.id)}
            />
          ))}
        </div>
      ) : null}

      {/* Error display */}
      {error ? (
        <div
          data-ocid="data_intake.error_state"
          role="alert"
          className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-destructive">
              Couldn't load that file
            </p>
            <p className="text-sm leading-relaxed text-destructive/90">
              {error}
            </p>
          </div>
        </div>
      ) : null}

      {/* Helper note */}
      <p
        data-ocid="data_intake.hint"
        className="text-xs leading-relaxed text-muted-foreground"
      >
        Everything stays in your browser — nothing is uploaded to a server.
        Every selected file participates in the unified research universe by
        default; you can explicitly focus one later if needed. The sample
        dataset is one year of 5-minute NQ-style futures bars, so you can click{" "}
        <span className="text-foreground font-medium">Use Sample Dataset</span>{" "}
        and start exploring right away.
      </p>
    </div>
  );
}

interface DatasetCardProps {
  dataset: Dataset;
  index: number;
  isActive: boolean;
  isEditing: boolean;
  draftLabel: string;
  onActivate: () => void;
  onRemove: () => void;
  onStartEdit: () => void;
  onDraftChange: (v: string) => void;
  onCommitRename: () => void;
}

function DatasetCard({
  dataset,
  index,
  isActive,
  isEditing,
  draftLabel,
  onActivate,
  onRemove,
  onStartEdit,
  onDraftChange,
  onCommitRename,
}: DatasetCardProps) {
  const label = dataset.label ?? dataset.name;
  const columnChips = dataset.originalColumns.slice(0, 12);
  const extraCount = dataset.originalColumns.length - columnChips.length;

  return (
    <div
      data-ocid={`data_intake.dataset_card.${index + 1}`}
      data-active={isActive ? "true" : "false"}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      tabIndex={0}
      aria-pressed={isActive}
      className={cn(
        "dataset-card animate-row-reveal group flex cursor-pointer flex-col gap-2.5 rounded-lg border p-3 transition-smooth",
        isActive
          ? "border-primary bg-primary/5"
          : "border-border bg-card/40 hover:border-primary/40 hover:bg-card/60",
      )}
      style={{ animationDelay: `${Math.min(index * 60, 480)}ms` }}
    >
      {/* Row 1: label (editable) + actions */}
      <div className="flex items-center gap-2">
        {isActive ? (
          <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
        ) : null}
        {isEditing ? (
          <input
            data-ocid={`data_intake.dataset_label_input.${index + 1}`}
            value={draftLabel}
            onChange={(e) => onDraftChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitRename();
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 font-display text-sm font-semibold text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label="Dataset name"
          />
        ) : (
          <button
            type="button"
            data-ocid={`data_intake.dataset_label.${index + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit();
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            title="Click to rename"
          >
            <span className="truncate font-display text-sm font-semibold text-foreground">
              {label}
            </span>
            <Pencil
              className="size-3 shrink-0 text-muted-foreground opacity-0 transition-smooth group-hover:opacity-100"
              aria-hidden="true"
            />
          </button>
        )}
        <button
          type="button"
          data-ocid={`data_intake.dataset_remove_button.${index + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove dataset "${label}"`}
          className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-smooth hover:border-destructive/50 hover:text-destructive focus-visible:border-destructive/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-destructive/30"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Row 2: metadata */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-mono tabular-nums">
          {dataset.rowCount.toLocaleString()} rows
        </span>
        <span aria-hidden="true">·</span>
        <span className="font-mono tabular-nums">{dataset.timeframe}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono tabular-nums">
          {dataset.columns.length} columns
        </span>
      </div>

      {/* Row 3: column chips */}
      <div className="flex flex-wrap gap-1.5">
        {columnChips.map((col, ci) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: key includes stable column name; index disambiguates duplicate columns
            key={`${col}-${ci}`}
            data-ocid={`data_intake.column_chip.${index + 1}.${ci + 1}`}
            className="column-chip"
            title={col}
          >
            {col}
          </span>
        ))}
        {extraCount > 0 ? (
          <span className="column-chip text-muted-foreground">
            +{extraCount} more
          </span>
        ) : null}
      </div>
    </div>
  );
}
