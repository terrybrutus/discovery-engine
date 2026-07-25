import {
  completedSourceIndexByTarget,
  datasetIntervalMs,
} from "@/lib/multiTimeframe";
import type { Dataset } from "@/types";

export interface AlignmentAuditRow {
  sourceId: string;
  sourceLabel: string;
  sourceTimeframe: string;
  relationship:
    | "same-instrument higher timeframe"
    | "same-instrument lower timeframe"
    | "same-instrument equal timeframe"
    | "cross-instrument context";
  sourceIndex: number;
  sourceStart: number | null;
  sourceEnd: number | null;
  sourceClose: number | null;
  ageMs: number | null;
  completed: boolean;
  developingProgressPct: number | null;
  containedIntrabarCount: number | null;
  expectedIntrabarCount: number | null;
  coveragePct: number;
  futureLeakCount: number;
  irregularDeltaCount: number;
  status: "pass" | "warning" | "unavailable";
}

function irregularDeltaCount(dataset: Dataset): number {
  const interval = datasetIntervalMs(dataset);
  let count = 0;
  for (let index = 1; index < dataset.bars.length; index++) {
    const delta =
      dataset.bars[index].timestamp - dataset.bars[index - 1].timestamp;
    // Larger gaps are expected at sessions/weekends; flag them so the user
    // can inspect alignment assumptions rather than silently treating them as
    // a continuous intraday sequence.
    if (Math.abs(delta - interval) / interval > 0.08) count++;
  }
  return count;
}

export function buildAlignmentAudit(
  target: Dataset,
  sources: Dataset[],
  targetIndex: number,
): {
  decisionTime: number;
  targetIndex: number;
  rows: AlignmentAuditRow[];
} {
  const boundedIndex = Math.max(
    0,
    Math.min(target.bars.length - 1, Math.floor(targetIndex)),
  );
  const targetInterval = datasetIntervalMs(target);
  const decisionTime =
    (target.bars[boundedIndex]?.timestamp ?? 0) + targetInterval;

  const rows = sources
    .filter((source) => source.id !== target.id)
    .map((source): AlignmentAuditRow => {
      const sourceInterval = datasetIntervalMs(source);
      const aligned = completedSourceIndexByTarget(target, source);
      const sourceIndex = aligned[boundedIndex] ?? -1;
      const sourceBar = sourceIndex >= 0 ? source.bars[sourceIndex] : undefined;
      const sourceEnd = sourceBar ? sourceBar.timestamp + sourceInterval : null;
      let futureLeakCount = 0;
      let covered = 0;
      for (let index = 0; index < target.bars.length; index++) {
        const alignedIndex = aligned[index];
        if (alignedIndex < 0) continue;
        covered++;
        const at = target.bars[index].timestamp + targetInterval;
        const selectedEnd =
          source.bars[alignedIndex].timestamp + sourceInterval;
        const next = source.bars[alignedIndex + 1];
        if (
          selectedEnd > at ||
          (next && next.timestamp + sourceInterval <= at)
        ) {
          futureLeakCount++;
        }
      }
      const sameInstrument = target.instrumentKey === source.instrumentKey;
      const relationship = !sameInstrument
        ? "cross-instrument context"
        : sourceInterval > targetInterval
          ? "same-instrument higher timeframe"
          : sourceInterval < targetInterval
            ? "same-instrument lower timeframe"
            : "same-instrument equal timeframe";
      const candidate = source.bars[sourceIndex + 1];
      const developingProgressPct =
        sameInstrument &&
        sourceInterval > targetInterval &&
        candidate &&
        candidate.timestamp < decisionTime &&
        decisionTime < candidate.timestamp + sourceInterval
          ? Math.min(
              100,
              ((decisionTime - candidate.timestamp) / sourceInterval) * 100,
            )
          : null;
      const containedIntrabars =
        sameInstrument && sourceInterval < targetInterval
          ? source.bars.filter(
              (bar) =>
                bar.timestamp >= target.bars[boundedIndex].timestamp &&
                bar.timestamp + sourceInterval <= decisionTime,
            ).length
          : null;
      const irregular = irregularDeltaCount(source);
      const completed = sourceEnd != null && sourceEnd <= decisionTime;
      const status: AlignmentAuditRow["status"] = !sourceBar
        ? "unavailable"
        : futureLeakCount > 0 || !completed
          ? "warning"
          : "pass";
      return {
        sourceId: source.id,
        sourceLabel: source.label ?? source.name,
        sourceTimeframe: source.timeframe,
        relationship,
        sourceIndex,
        sourceStart: sourceBar?.timestamp ?? null,
        sourceEnd,
        sourceClose: sourceBar?.close ?? null,
        ageMs: sourceEnd == null ? null : decisionTime - sourceEnd,
        completed,
        developingProgressPct,
        containedIntrabarCount: containedIntrabars,
        expectedIntrabarCount:
          containedIntrabars == null
            ? null
            : Math.max(1, Math.round(targetInterval / sourceInterval)),
        coveragePct:
          target.bars.length > 0 ? (covered / target.bars.length) * 100 : 0,
        futureLeakCount,
        irregularDeltaCount: irregular,
        status,
      };
    })
    .sort(
      (left, right) =>
        datasetIntervalMs(
          sources.find((source) => source.id === left.sourceId) as Dataset,
        ) -
        datasetIntervalMs(
          sources.find((source) => source.id === right.sourceId) as Dataset,
        ),
    );

  return { decisionTime, targetIndex: boundedIndex, rows };
}
