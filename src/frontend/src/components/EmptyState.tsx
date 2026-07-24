import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Optional secondary hint shown below the description. */
  hint?: string;
  className?: string;
}

/**
 * Reusable empty state with icon, title, plain-English description, and an
 * optional primary action. Designed for non-developer users.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  hint,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-ocid="empty_state"
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-card/40 px-6 py-16 text-center",
        className,
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-full border border-border bg-muted/50">
        <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <h3 className="font-display text-lg font-semibold text-foreground">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        {hint ? (
          <p className="text-xs leading-relaxed text-muted-foreground/70">
            {hint}
          </p>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <Button
          data-ocid="empty_state.primary_button"
          onClick={onAction}
          className="mt-2"
        >
          {actionLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
