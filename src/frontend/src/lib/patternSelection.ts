import type { Pattern } from "@/types";

function interleaveSearchTiers(patterns: Pattern[]): Pattern[] {
  const priority = patterns
    .filter((pattern) => pattern.searchTier === "event-priority")
    .sort((a, b) => b.score - a.score || b.sampleSize - a.sampleSize);
  const general = patterns
    .filter((pattern) => pattern.searchTier !== "event-priority")
    .sort((a, b) => b.score - a.score || b.sampleSize - a.sampleSize);
  const selected: Pattern[] = [];
  for (
    let index = 0;
    index < Math.max(priority.length, general.length);
    index++
  ) {
    if (priority[index]) selected.push(priority[index]);
    if (general[index]) selected.push(general[index]);
  }
  return selected;
}

/**
 * Keep every uploaded outcome target visible. Targets are round-robined, and
 * each target interleaves structural/event discoveries with the broad search.
 * No symbol, timeframe, or dataset count is assumed.
 */
export function selectBalancedPatterns(
  patterns: Pattern[],
  limit = 100,
): Pattern[] {
  const groups = new Map<string, Pattern[]>();
  for (const pattern of patterns) {
    const key = pattern.targetDatasetId ?? "current-target";
    const group = groups.get(key) ?? [];
    group.push(pattern);
    groups.set(key, group);
  }
  const queues = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => interleaveSearchTiers(group));
  const selected: Pattern[] = [];
  let position = 0;
  while (selected.length < limit) {
    let added = false;
    for (const queue of queues) {
      const pattern = queue[position];
      if (!pattern) continue;
      selected.push(pattern);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    position++;
  }
  return selected;
}
