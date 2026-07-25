import type { Pattern } from "@/types";

export function formatDuration(milliseconds: number): string {
  const minutes = milliseconds / 60_000;
  if (minutes < 60) return `${Number(minutes.toFixed(2))}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Number(hours.toFixed(2))}h`;
  const days = hours / 24;
  return `${Number(days.toFixed(2))}d`;
}

export function formatPatternHorizon(pattern: Pattern): string {
  const bars = `${pattern.horizon} target observation${
    pattern.horizon === 1 ? "" : "s"
  }`;
  if (!pattern.targetIntervalMs || pattern.targetIntervalMs <= 0) return bars;
  return `${bars} (${formatDuration(pattern.horizon * pattern.targetIntervalMs)})`;
}

export function formatPatternTarget(pattern: Pattern): string {
  return `${pattern.targetDatasetLabel ?? "Current target"} · ${
    pattern.targetTimeframe ?? "unknown"
  }`;
}
