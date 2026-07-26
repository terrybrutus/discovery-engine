import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_MARKET_SESSION_CONFIG } from "@/lib/features";
import { useEngineStore } from "@/store/engineStore";
import { Clock3, RotateCcw } from "lucide-react";

const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "Europe/London",
  "Asia/Tokyo",
  "Asia/Hong_Kong",
  "UTC",
];

function toClock(minutes: number): string {
  const normalized = ((minutes % 1_440) + 1_440) % 1_440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60,
  ).padStart(2, "0")}`;
}

function fromClock(value: string, fallback: number): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return Math.max(0, Math.min(1_439, hours * 60 + minutes));
}

export function MarketSessionSettings() {
  const config = useEngineStore((state) => state.marketSessionConfig);
  const update = useEngineStore((state) => state.updateMarketSessionConfig);

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-subtle">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10">
            <Clock3 className="size-4 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-foreground">
              Market clock and session definitions
            </h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              These settings define calendar, session, opening-range, previous
              session, and time-of-day relationships. They change how the engine
              interprets timestamps; they do not filter your source rows.
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => update(DEFAULT_MARKET_SESSION_CONFIG)}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          New York defaults
        </Button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label htmlFor="market-time-zone">Market time zone</Label>
          <select
            id="market-time-zone"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            value={config.timeZone}
            onChange={(event) => update({ timeZone: event.target.value })}
          >
            {!TIME_ZONES.includes(config.timeZone) ? (
              <option value={config.timeZone}>{config.timeZone}</option>
            ) : null}
            {TIME_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="regular-open">Regular open</Label>
          <Input
            id="regular-open"
            type="time"
            value={toClock(config.regularOpenMinutes)}
            onChange={(event) =>
              update({
                regularOpenMinutes: fromClock(
                  event.target.value,
                  config.regularOpenMinutes,
                ),
              })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="regular-close">Regular close</Label>
          <Input
            id="regular-close"
            type="time"
            value={toClock(config.regularCloseMinutes)}
            onChange={(event) =>
              update({
                regularCloseMinutes: fromClock(
                  event.target.value,
                  config.regularCloseMinutes,
                ),
              })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opening-range-minutes">Opening range</Label>
          <select
            id="opening-range-minutes"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            value={config.openingRangeMinutes}
            onChange={(event) =>
              update({ openingRangeMinutes: Number(event.target.value) })
            }
          >
            {[5, 15, 30, 45, 60, 90].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trading-day-start">Trading day begins</Label>
          <Input
            id="trading-day-start"
            type="time"
            value={toClock(config.tradingDayStartMinutes)}
            onChange={(event) =>
              update({
                tradingDayStartMinutes: fromClock(
                  event.target.value,
                  config.tradingDayStartMinutes,
                ),
              })
            }
          />
        </div>
      </div>
    </section>
  );
}
