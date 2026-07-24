import { DataIntake } from "@/components/DataIntake";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Database } from "lucide-react";

interface LoadDataModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal dialog triggered from the header Load Data button. Wraps the
 * DataIntake component in a shadcn Dialog with a "Load Data" title and
 * plain-English description. Closes automatically once a dataset loads.
 *
 * Layout: the shared dialog.tsx already caps DialogContent height at
 * max-h-[calc(100vh-2rem)] with overflow-y-auto. To keep the modal usable
 * on small viewports with many loaded datasets, we structure the content
 * as a flex column where the header (title + description) and the
 * DataIntake footer (action buttons + hint) stay pinned, and only the
 * dataset list scrolls inside a max-h-[60vh] region. DataIntake itself
 * owns the inner scroll wrapper around its DatasetCard list.
 */
export function LoadDataModal({ open, onOpenChange }: LoadDataModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-ocid="load_data_modal"
        className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="flex shrink-0 flex-col gap-1.5 border-b border-border px-5 py-4">
          <DialogTitle
            data-ocid="load_data_modal.title"
            className="flex items-center gap-2 font-display"
          >
            <Database className="size-5 text-primary" aria-hidden="true" />
            Load Data
          </DialogTitle>
          <DialogDescription data-ocid="load_data_modal.description">
            Upload one or more CSV, TXT, or MD files. Columns are auto-detected
            from the header row, and original column names are preserved.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <DataIntake onLoaded={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
