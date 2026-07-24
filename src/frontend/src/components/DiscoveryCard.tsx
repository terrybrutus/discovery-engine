import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Confidence, Direction } from "@/types";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Info,
  ShieldCheck,
} from "lucide-react";

interface DiscoveryCardProps {
  rank: number;
  /** Plain-English conditions, e.g. "Monday, 2:55 PM, Price below VWAP, RVOL 1.8–2.2". */
  conditions: string;
  direction: Direction;
  winRate: number; // 0–100
  avgMove: number; // price units
  sampleSize: number;
  confidence: Confidence;
  /** Average max adverse excursion (price units). */
  avgMAE?: number;
  /** Average max favorable excursion (price units). */
  avgMFE?: number;
  /** True if the pattern degraded out-of-sample. */
  degraded?: boolean;
}

const CONFIDENCE_STYLES: Record<
  Confidence,
  { label: string; className: string }
> = {
  "very high": {
    label: "Very High",
    className: "border-success/40 bg-success/15 text-success",
  },
  high: {
    label: "High",
    className: "border-success/30 bg-success/10 text-success",
  },
  moderate: {
    label: "Medium",
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  low: {
    label: "Low",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

function fmtNum(n: number, digits = 1): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Tooltip explaining the window-based proxy MFE/MAE measurement. */
const PROXY_TOOLTIP =
  "Window-based proxy: max favorable/adverse excursion measured over the forward hold window, not from a simulated strategy.";

/**
 * Individual discovery presentation. Reads like the example output:
 * "Pattern #1: Monday, 2:55 PM, Price below VWAP, … → 76% probability of
 * downside, Average move 18.4 points, Sample size 1,147, Confidence High".
 *
 * Scannable card layout with a direction arrow, headline probability,
 * average move, sample size, confidence rating, and MAE/MFE as secondary
 * stats. All numbers in JetBrains Mono with tabular-nums.
 */
export function DiscoveryCard({
  rank,
  conditions,
  direction,
  winRate,
  avgMove,
  sampleSize,
  confidence,
  avgMAE,
  avgMFE,
  degraded = false,
}: DiscoveryCardProps) {
  const isDown = direction === "bearish";
  const isUp = direction === "bullish";
  const dirText = isDown ? "downside" : isUp ? "upside" : "neutral";
  const Arrow = isDown ? ArrowDown : isUp ? ArrowUp : ArrowDown;
  const dirColor = isDown
    ? "text-destructive"
    : isUp
      ? "text-success"
      : "text-muted-foreground";
  const dirBg = isDown
    ? "bg-destructive/10 border-destructive/30"
    : isUp
      ? "bg-success/10 border-success/30"
      : "bg-muted border-border";
  const conf = CONFIDENCE_STYLES[confidence];

  return (
    <article
      data-ocid={`report.discovery_card.${rank}`}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card p-4 transition-smooth",
        degraded ? "border-warning/30" : "border-border",
      )}
    >
      {/* Rank + direction rail */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md border",
            dirBg,
          )}
          aria-hidden="true"
        >
          <Arrow className={cn("size-5", dirColor)} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium tabular-nums text-muted-foreground">
              Pattern #{rank}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-medium uppercase tracking-wide",
                conf.className,
              )}
            >
              {conf.label} confidence
            </Badge>
            {degraded ? (
              <Badge
                variant="outline"
                className="border-warning/40 bg-warning/10 text-warning text-[10px] font-medium uppercase tracking-wide"
              >
                <AlertTriangle className="size-2.5" aria-hidden="true" />
                Degraded OOS
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-success/30 bg-success/5 text-success text-[10px] font-medium uppercase tracking-wide"
              >
                <ShieldCheck className="size-2.5" aria-hidden="true" />
                Held OOS
              </Badge>
            )}
          </div>

          {/* Plain-English conditions */}
          <p className="text-sm leading-relaxed text-foreground">
            {conditions}
          </p>
        </div>
      </div>

      {/* Headline outcome line — reads like the example output */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">→</span>
        <span className={cn("font-mono font-semibold tabular-nums", dirColor)}>
          {fmtNum(winRate, 1)}%
        </span>
        <span className="text-muted-foreground">probability of {dirText},</span>
        <span className="text-muted-foreground">Average move</span>
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {fmtNum(Math.abs(avgMove), 1)}
        </span>
        <span className="text-muted-foreground">points,</span>
        <span className="text-muted-foreground">Sample size</span>
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {sampleSize.toLocaleString()}
        </span>
      </div>

      {/* Secondary stats: MAE / MFE */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background/40 px-2.5 py-1.5">
          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Avg MFE (proxy)
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="What does Avg MFE (proxy) mean?"
                  className="text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                >
                  <Info className="size-3" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[16rem] text-left">
                {PROXY_TOOLTIP}
              </TooltipContent>
            </Tooltip>
          </span>
          <span className="font-mono text-xs tabular-nums text-foreground">
            {avgMFE != null ? fmtNum(avgMFE, 1) : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background/40 px-2.5 py-1.5">
          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Avg MAE (proxy)
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="What does Avg MAE (proxy) mean?"
                  className="text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                >
                  <Info className="size-3" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[16rem] text-left">
                {PROXY_TOOLTIP}
              </TooltipContent>
            </Tooltip>
          </span>
          <span className="font-mono text-xs tabular-nums text-foreground">
            {avgMAE != null ? fmtNum(avgMAE, 1) : "—"}
          </span>
        </div>
      </div>
    </article>
  );
}
