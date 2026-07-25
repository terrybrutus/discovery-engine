import { Input } from "@/components/ui/input";
import { buildAlignmentAudit } from "@/lib/alignmentAudit";
import { datasetIntervalMs } from "@/lib/multiTimeframe";
import type { Dataset } from "@/types";
import { CheckCircle2, Clock3, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function formatTimestamp(timestamp: number | null): string {
  if (timestamp == null) return "—";
  return new Date(timestamp).toLocaleString();
}

function formatAge(ms: number | null): string {
  if (ms == null) return "—";
  if (ms === 0) return "just completed";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m old`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h old`;
  return `${(hours / 24).toFixed(1)}d old`;
}

export function CausalAlignmentAudit({
  datasets,
}: {
  datasets: Dataset[];
}) {
  const ordered = useMemo(
    () =>
      [...datasets].sort(
        (left, right) =>
          datasetIntervalMs(left) - datasetIntervalMs(right) ||
          (left.label ?? left.name).localeCompare(right.label ?? right.name),
      ),
    [datasets],
  );
  const [targetId, setTargetId] = useState(ordered[0]?.id ?? "");
  const target =
    ordered.find((dataset) => dataset.id === targetId) ?? ordered[0];
  const [targetIndex, setTargetIndex] = useState(
    Math.max(0, (target?.bars.length ?? 1) - 1),
  );

  useEffect(() => {
    if (!target || ordered.some((dataset) => dataset.id === targetId)) return;
    setTargetId(ordered[0]?.id ?? "");
  }, [ordered, target, targetId]);

  useEffect(() => {
    setTargetIndex(Math.max(0, (target?.bars.length ?? 1) - 1));
  }, [target]);

  if (!target || datasets.length < 2) return null;

  const audit = buildAlignmentAudit(target, datasets, targetIndex);
  const passCount = audit.rows.filter((row) => row.status === "pass").length;
  const leakCount = audit.rows.reduce(
    (sum, row) => sum + row.futureLeakCount,
    0,
  );

  return (
    <section
      data-ocid="causal_alignment_audit"
      className="rounded-lg border border-primary/25 bg-card"
    >
      <div className="flex flex-col gap-2 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <Clock3 className="size-4 text-primary" aria-hidden="true" />
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-foreground">
            Intrabar & confluence audit
          </h3>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Inspect exactly what each selected source had completed at one target
          decision. Discovery now requires conditions from at least two source
          datasets whenever multiple aligned sources are available.
        </p>
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-[minmax(14rem,1fr)_minmax(12rem,1fr)_auto]">
        <label className="space-y-1 text-xs text-muted-foreground">
          Target decision timeline
          <select
            value={target.id}
            onChange={(event) => setTargetId(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            {ordered.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.label ?? dataset.name} · {dataset.timeframe}
              </option>
            ))}
          </select>
        </label>
        <label
          htmlFor="alignment-target-index"
          className="space-y-1 text-xs text-muted-foreground"
        >
          Target bar index
          <Input
            id="alignment-target-index"
            type="number"
            min={0}
            max={Math.max(0, target.bars.length - 1)}
            value={audit.targetIndex}
            onChange={(event) => setTargetIndex(Number(event.target.value))}
          />
        </label>
        <div className="self-end rounded-md border border-border bg-muted/20 px-3 py-2">
          <div className="text-[10px] uppercase text-muted-foreground">
            Decision time
          </div>
          <div className="font-mono text-xs text-foreground">
            {formatTimestamp(audit.decisionTime)}
          </div>
        </div>
      </div>

      <div className="grid gap-2 border-b border-border p-4 sm:grid-cols-3">
        <AuditStat
          label="Causally valid sources"
          value={`${passCount}/${audit.rows.length}`}
          healthy={passCount === audit.rows.length}
        />
        <AuditStat
          label="Future-leak violations"
          value={leakCount.toLocaleString()}
          healthy={leakCount === 0}
        />
        <AuditStat
          label="Confluence policy"
          value="2+ source datasets required"
          healthy
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[70rem] text-xs">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-3 py-2 text-left">Relationship</th>
              <th className="px-3 py-2 text-left">Completed bar used</th>
              <th className="px-3 py-2 text-left">Completed at</th>
              <th className="px-3 py-2 text-right">Close</th>
              <th className="px-3 py-2 text-right">Age</th>
              <th className="px-3 py-2 text-right">Coverage</th>
              <th className="px-3 py-2 text-left">Intrabar contribution</th>
              <th className="px-3 py-2 text-left">Audit</th>
            </tr>
          </thead>
          <tbody>
            {audit.rows.map((row) => (
              <tr key={row.sourceId} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="font-medium text-foreground">
                    {row.sourceLabel}
                  </div>
                  <div className="font-mono text-muted-foreground">
                    {row.sourceTimeframe}
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.relationship}
                </td>
                <td className="px-3 py-2 font-mono text-foreground">
                  {row.sourceIndex < 0
                    ? "None available"
                    : `#${row.sourceIndex} · ${formatTimestamp(row.sourceStart)}`}
                </td>
                <td className="px-3 py-2 font-mono text-foreground">
                  {formatTimestamp(row.sourceEnd)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {row.sourceClose == null ? "—" : row.sourceClose.toFixed(4)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatAge(row.ageMs)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {row.coveragePct.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.developingProgressPct != null
                    ? `${row.developingProgressPct.toFixed(1)}% of forming ${row.sourceTimeframe} reconstructed`
                    : row.containedIntrabarCount != null
                      ? `${row.containedIntrabarCount}/${row.expectedIntrabarCount} completed ${row.sourceTimeframe} bars supplied path detail`
                      : "Latest completed state"}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      row.status === "pass"
                        ? "text-primary"
                        : row.status === "warning"
                          ? "text-warning"
                          : "text-muted-foreground"
                    }
                  >
                    {row.status === "pass"
                      ? "Pass"
                      : row.status === "warning"
                        ? "Inspect"
                        : "Unavailable"}
                  </span>
                  {row.irregularDeltaCount > 0 ? (
                    <div className="mt-0.5 text-[10px] text-warning">
                      {row.irregularDeltaCount} session/gap interval
                      {row.irregularDeltaCount === 1 ? "" : "s"}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        “Completed bar used” is the latest source bar whose calculated close
        time is not later than the target decision. Developing higher-timeframe
        state is reconstructed only from target bars already completed at that
        moment. Session and gap warnings identify places where exchange
        calendars/time zones deserve explicit review.
      </p>
    </section>
  );
}

function AuditStat({
  label,
  value,
  healthy,
}: {
  label: string;
  value: string;
  healthy: boolean;
}) {
  return (
    <div className="rounded border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
        {healthy ? (
          <CheckCircle2 className="size-3 text-primary" aria-hidden="true" />
        ) : (
          <ShieldAlert className="size-3 text-warning" aria-hidden="true" />
        )}
        {label}
      </div>
      <div className="mt-1 font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}
