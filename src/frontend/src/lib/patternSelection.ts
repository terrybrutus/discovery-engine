import type { Pattern } from "@/types";

function relationshipFamily(pattern: Pattern): string {
  return pattern.conditions
    .map((condition) => condition.featureId)
    .sort()
    .join("|");
}

const EXPLAINABLE_EVENT_FEATURES = new Set([
  "pivot_event",
  "break_of_structure",
  "liquidity_sweep",
  "prev_day_level_event",
  "box_event",
  "or_breakout",
  "structure_event_sequence",
  "sweep_reclaim_sequence",
  "break_retest_sequence",
]);

function baseFeatureId(featureId: string): string {
  const parts = featureId.split("__");
  return parts[parts.length - 1] ?? featureId;
}

/**
 * Presentation should favor portable trading relationships over incidental
 * numeric proxies when both are statistically viable. This does not change
 * discovery metrics; it only decides which retained families receive one of
 * the limited report slots first.
 */
function presentationPriority(pattern: Pattern): number {
  const baseIds = pattern.conditions.map((condition) =>
    baseFeatureId(condition.featureId),
  );
  const categoricalCount = pattern.conditions.filter(
    (condition) => condition.bucketLabel != null,
  ).length;
  const numericCount = pattern.conditions.length - categoricalCount;
  const sourceCount = Math.max(1, pattern.confluenceDatasetIds?.length ?? 0);
  const eventCount = baseIds.filter((id) =>
    EXPLAINABLE_EVENT_FEATURES.has(id),
  ).length;
  const directionalContextCount = baseIds.filter(
    (id) => id === "candle_direction",
  ).length;
  return (
    sourceCount * 15 +
    eventCount * 8 +
    directionalContextCount * 8 +
    categoricalCount * 2 -
    numericCount * 2 +
    Math.min(20, Math.max(0, pattern.score))
  );
}

function diversifyRelationshipFamilies(patterns: Pattern[]): Pattern[] {
  const families = new Map<string, Pattern[]>();
  for (const pattern of patterns) {
    const key = relationshipFamily(pattern);
    const family = families.get(key) ?? [];
    family.push(pattern);
    families.set(key, family);
  }
  const queues = [...families.entries()]
    .map(([key, family]) => ({
      key,
      family: family.sort(
        (a, b) => b.score - a.score || b.sampleSize - a.sampleSize,
      ),
    }))
    .sort(
      (left, right) =>
        presentationPriority(right.family[0]) -
          presentationPriority(left.family[0]) ||
        right.family[0].score - left.family[0].score ||
        left.key.localeCompare(right.key),
    )
    .map(({ family }) => family);
  const selected: Pattern[] = [];
  let position = 0;
  while (true) {
    let added = false;
    for (const queue of queues) {
      const pattern = queue[position];
      if (!pattern) continue;
      selected.push(pattern);
      added = true;
    }
    if (!added) break;
    position++;
  }
  return selected;
}

function interleaveSearchTiers(patterns: Pattern[]): Pattern[] {
  const priority = diversifyRelationshipFamilies(
    patterns.filter((pattern) => pattern.searchTier === "event-priority"),
  );
  const general = diversifyRelationshipFamilies(
    patterns.filter((pattern) => pattern.searchTier !== "event-priority"),
  );
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
