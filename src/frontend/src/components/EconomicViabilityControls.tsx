import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useEngineStore } from "@/store/engineStore";
import { CircleDollarSign } from "lucide-react";

export function EconomicViabilityControls({
  visibleCount,
  totalCount,
}: {
  visibleCount: number;
  totalCount: number;
}) {
  const config = useEngineStore((state) => state.discoveryConfig);
  const updateConfig = useEngineStore((state) => state.updateConfig);
  const view = config.executionView ?? "non-overlapping";
  const costBps = config.roundTripCostBps ?? 0;

  const updateNumber = (
    key: "roundTripCostBps" | "minNetMovePct" | "minGrossCostMultiple",
    raw: string,
  ) => {
    const value = Number(raw);
    updateConfig({ [key]: Number.isFinite(value) ? Math.max(0, value) : 0 });
  };

  return (
    <CardShell>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <CircleDollarSign
            className="size-4 text-primary"
            aria-hidden="true"
          />
          <h3 className="font-display text-sm font-semibold text-foreground">
            Economic viability screen
          </h3>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Compare raw pattern occurrences with a one-position-at-a-time
          interpretation, then estimate the move remaining after spread,
          commissions, and entry/exit slippage.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="execution-view">Occurrence view</Label>
          <select
            id="execution-view"
            value={view}
            onChange={(event) =>
              updateConfig({
                executionView: event.target.value as
                  | "every-match"
                  | "non-overlapping",
              })
            }
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="every-match">Every matching bar</option>
            <option value="non-overlapping">Non-overlapping trades</option>
          </select>
          <p className="text-[11px] text-muted-foreground">
            {view === "non-overlapping"
              ? "Enter the first match; ignore signals until its hold ends."
              : "Count every match, including clustered signals in one move."}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="round-trip-cost">Round-trip cost (bps)</Label>
          <Input
            id="round-trip-cost"
            type="number"
            min={0}
            step={0.1}
            value={costBps}
            onChange={(event) =>
              updateNumber("roundTripCostBps", event.target.value)
            }
          />
          <p className="text-[11px] text-muted-foreground">
            {costBps.toFixed(1)} bps = {(costBps / 100).toFixed(3)}% of price.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="minimum-net-move">Minimum net avg move (%)</Label>
          <Input
            id="minimum-net-move"
            type="number"
            min={0}
            step={0.01}
            value={config.minNetMovePct ?? 0}
            onChange={(event) =>
              updateNumber("minNetMovePct", event.target.value)
            }
          />
          <p className="text-[11px] text-muted-foreground">
            Required mean direction-adjusted move after estimated costs.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="minimum-cost-multiple">
            Minimum gross/cost ratio
          </Label>
          <Input
            id="minimum-cost-multiple"
            type="number"
            min={0}
            step={0.25}
            value={config.minGrossCostMultiple ?? 3}
            onChange={(event) =>
              updateNumber("minGrossCostMultiple", event.target.value)
            }
          />
          <p className="text-[11px] text-muted-foreground">
            3× means estimated costs consume one-third of the gross move.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <Switch
            id="economic-filter"
            checked={config.costFilterEnabled ?? false}
            onCheckedChange={(checked) =>
              updateConfig({ costFilterEnabled: checked })
            }
          />
          <Label htmlFor="economic-filter">
            Filter results by these minimums
          </Label>
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {visibleCount.toLocaleString()} of {totalCount.toLocaleString()} shown
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Screening estimate only. The final TradingView strategy should model
        broker-specific costs, position sizing, stops, and financing.
      </p>
    </CardShell>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-ocid="economic_viability_controls"
      className="flex flex-col gap-4 rounded-lg border border-primary/25 bg-primary/5 px-4 py-4"
    >
      {children}
    </div>
  );
}
