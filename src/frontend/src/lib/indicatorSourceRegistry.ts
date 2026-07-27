import type { IndicatorSourceInput } from "@/lib/geminiDefinitionCompiler";

const STORAGE_KEY = "discovery-engine.indicator-sources.v1";

function valid(value: unknown): value is IndicatorSourceInput {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<IndicatorSourceInput>;
  return (
    typeof source.id === "string" &&
    typeof source.name === "string" &&
    typeof source.source === "string"
  );
}

export function listIndicatorSources(): IndicatorSourceInput[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(valid).map((source) => ({ ...source }))
      : [];
  } catch {
    return [];
  }
}

export function saveIndicatorSources(
  sources: IndicatorSourceInput[],
): IndicatorSourceInput[] {
  const clean = sources
    .filter(valid)
    .map((source) => ({ ...source }))
    .slice(0, 50);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  }
  return clean;
}

export function mergeIndicatorSources(
  incoming: unknown,
): IndicatorSourceInput[] {
  const additions = Array.isArray(incoming) ? incoming.filter(valid) : [];
  const byId = new Map(
    listIndicatorSources().map((source) => [source.id, source]),
  );
  for (const source of additions) byId.set(source.id, { ...source });
  return saveIndicatorSources([...byId.values()]);
}
