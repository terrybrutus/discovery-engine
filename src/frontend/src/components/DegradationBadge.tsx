import { cn } from "@/lib/utils";
import { AlertTriangle, Check, Minus } from "lucide-react";

export type DegradationStatus = "held" | "degraded" | "insufficient";

interface DegradationBadgeProps {
  /** Out-of-sample win rate (0-100). */
  outOfSampleWinRate: number;
  /** In-sample win rate (0-100), used to compute the delta. */
  inSampleWinRate: number;
  /** Out-of-sample sample size. */
  outOfSampleSampleSize: number;
  /** Minimum out-of-sample sample size to be considered sufficient. */
  minSample?: number;
  /** Win-rate drop in percentage points that counts as "degraded". */
  degradationThresholdPp?: number;
  className?: string;
}

/**
 * Compact color-coded badge that classifies a pattern's out-of-sample
 * robustness:
 *   - Held Up      (green)  — OOS win rate within threshold of in-sample.
 *   - Degraded     (amber)  — OOS win rate dropped more than threshold.
 *   - Insufficient (gray)   — OOS sample size too small to trust.
 *
 * Designed for the dark instrument-panel aesthetic: monospace label,
 * tabular-nums, subtle border, no harsh fills.
 */
export function DegradationBadge({
  outOfSampleWinRate,
  inSampleWinRate,
  outOfSampleSampleSize,
  minSample = 20,
  degradationThresholdPp = 10,
  className,
}: DegradationBadgeProps) {
  const status =
    outOfSampleSampleSize >= minSample && outOfSampleWinRate <= 50
      ? "degraded"
      : resolveStatus(
          outOfSampleSampleSize,
          inSampleWinRate - outOfSampleWinRate,
          minSample,
          degradationThresholdPp,
        );

  const { Icon, badge } = statusStyles[status];

  return (
    <span
      data-ocid={`degradation_badge.${status}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs font-medium tabular-nums whitespace-nowrap",
        badge,
        className,
      )}
      title={statusTitles[status]}
    >
      <Icon className="size-3" aria-hidden="true" />
      <span>{statusLabels[status]}</span>
    </span>
  );
}

/**
 * Resolve a status from raw metrics. Exported so callers can derive the
 * same classification the badge would show (e.g. for sorting or summaries).
 */
export function resolveDegradationStatus(
  outOfSampleSampleSize: number,
  winRateDropPp: number,
  minSample = 20,
  degradationThresholdPp = 10,
): DegradationStatus {
  return resolveStatus(
    outOfSampleSampleSize,
    winRateDropPp,
    minSample,
    degradationThresholdPp,
  );
}

function resolveStatus(
  oosSample: number,
  dropPp: number,
  minSample: number,
  thresholdPp: number,
): DegradationStatus {
  if (oosSample < minSample) return "insufficient";
  if (dropPp > thresholdPp) return "degraded";
  return "held";
}

const statusLabels: Record<DegradationStatus, string> = {
  held: "Held Up",
  degraded: "Degraded",
  insufficient: "Insufficient",
};

const statusTitles: Record<DegradationStatus, string> = {
  held: "Out-of-sample win rate stayed within 10pp of in-sample.",
  degraded:
    "Out-of-sample performance failed: win rate was 50% or lower, or dropped more than 10pp.",
  insufficient: "Out-of-sample sample size too small to trust.",
};

const statusStyles: Record<
  DegradationStatus,
  { badge: string; Icon: typeof Check }
> = {
  held: {
    badge: "border-primary/30 bg-primary/10 text-primary",
    Icon: Check,
  },
  degraded: {
    badge: "border-warning/30 bg-warning/10 text-warning",
    Icon: AlertTriangle,
  },
  insufficient: {
    badge: "border-border bg-muted text-muted-foreground",
    Icon: Minus,
  },
};
