import {
  listIndicatorSources,
  mergeIndicatorSources,
} from "@/lib/indicatorSourceRegistry";
import { mergePineSourceParameters } from "@/lib/pineSourceMetadata";
import type {
  ColumnSemantic,
  IndicatorDefinition,
  IndicatorRole,
  RelationshipPrimitive,
} from "@/types";

const STORAGE_KEY = "discovery-engine.indicator-definitions.v1";
const REGISTRY_VERSION = 1;

const UNIVERSAL: RelationshipPrimitive[] = [
  "percentile",
  "zscore",
  "direction",
  "slope",
  "acceleration",
  "persistence",
  "compression",
  "expansion",
  "regime-transition",
  "divergence",
  "convergence",
  "sequence",
];

const now = 0;
const builtIn = (
  id: string,
  canonicalName: string,
  role: IndicatorRole,
  semantic: ColumnSemantic,
  units: IndicatorDefinition["units"],
  aliases: string[],
  relationships: RelationshipPrimitive[],
  description: string,
  expectedRange?: [number, number],
): IndicatorDefinition => ({
  id,
  version: REGISTRY_VERSION,
  canonicalName,
  description,
  role,
  semantic,
  units,
  expectedRange,
  stationary: ![
    "price",
    "price-level",
    "upper-band",
    "lower-band",
    "basis",
    "cumulative",
  ].includes(role),
  supportedRelationships: relationships,
  aliases,
  source: "builtin",
  confidence: 1,
  reviewed: true,
  updatedAt: now,
});

export const BUILTIN_DEFINITIONS: IndicatorDefinition[] = [
  builtIn(
    "builtin.price",
    "Price",
    "price",
    "price-level",
    "price",
    ["open", "high", "low", "close", "last", "price"],
    [
      "normalized-value",
      "percentile",
      "direction",
      "slope",
      "acceleration",
      "persistence",
      "breakout",
      "failed-breakout",
      "divergence",
      "sequence",
    ],
    "Traded price. Absolute levels are never searched across markets; returns, ATR distance, structure, and relative location are used.",
  ),
  builtIn(
    "builtin.price-level",
    "Price-relative level",
    "price-level",
    "price-level",
    "price",
    [
      "vwap",
      "support",
      "resistance",
      "pivot",
      "level",
      "previous high",
      "previous low",
    ],
    [
      "normalized-value",
      "percentile",
      "direction",
      "slope",
      "cross",
      "touch",
      "rejection",
      "breakout",
      "failed-breakout",
      "persistence",
      "sequence",
    ],
    "A level expressed in price units and interpreted only through its relationship to price.",
  ),
  builtIn(
    "builtin.upper-band",
    "Upper band",
    "upper-band",
    "price-level",
    "price",
    ["upper", "upper band", "bb upper", "keltner upper"],
    [
      "normalized-value",
      "direction",
      "slope",
      "cross",
      "touch",
      "rejection",
      "breakout",
      "failed-breakout",
      "compression",
      "expansion",
      "sequence",
    ],
    "Upper boundary of an envelope. Analyzed by distance, touch/rejection, width, nesting, and expansion rather than its raw price.",
  ),
  builtIn(
    "builtin.lower-band",
    "Lower band",
    "lower-band",
    "price-level",
    "price",
    ["lower", "lower band", "bb lower", "keltner lower"],
    [
      "normalized-value",
      "direction",
      "slope",
      "cross",
      "touch",
      "rejection",
      "breakout",
      "failed-breakout",
      "compression",
      "expansion",
      "sequence",
    ],
    "Lower boundary of an envelope. Analyzed by distance, touch/rejection, width, nesting, and expansion rather than its raw price.",
  ),
  builtIn(
    "builtin.basis",
    "Band basis",
    "basis",
    "price-level",
    "price",
    ["basis", "middle", "midline", "center line"],
    [
      "normalized-value",
      "direction",
      "slope",
      "cross",
      "touch",
      "rejection",
      "persistence",
      "sequence",
    ],
    "Center line or moving basis of an envelope.",
  ),
  builtIn(
    "builtin.oscillator",
    "Bounded oscillator",
    "oscillator",
    "oscillator",
    "bounded",
    ["rsi", "stoch", "stochastic", "mfi", "williams", "cci", "oscillator"],
    [...UNIVERSAL, "normalized-value", "cross"],
    "Momentum or state series interpreted by zones, percentile, slope, acceleration, pivots, and divergence.",
  ),
  builtIn(
    "builtin.cumulative",
    "Cumulative series",
    "cumulative",
    "cumulative",
    "count",
    ["obv", "on balance volume", "cumulative", "running total"],
    UNIVERSAL,
    "Non-stationary cumulative series. Its raw value is excluded; change, standardized change, slope, percentile, and divergence are used.",
  ),
  builtIn(
    "builtin.percentage",
    "Percentage or ratio",
    "percentage",
    "percentage",
    "percent",
    ["percent", "percentage", "ratio", "bandwidth", "return"],
    [...UNIVERSAL, "normalized-value", "cross"],
    "Already scale-independent percentage or ratio.",
  ),
  builtIn(
    "builtin.event",
    "Discrete event",
    "binary-event",
    "binary-event",
    "event",
    ["signal", "enter", "exit", "long", "short", "buy", "sell"],
    ["persistence", "sequence"],
    "Discrete imported signal interpreted as an event state and sequence input.",
  ),
  builtIn(
    "builtin.generic",
    "Generic numeric series",
    "generic-series",
    "generic",
    "unknown",
    [],
    UNIVERSAL,
    "Unknown numeric series. Raw level is not trusted; standardized change, percentile, slope, acceleration, regimes, and divergence are used.",
  ),
];

function normalized(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function finite(values: number[]): number[] {
  return values.filter(Number.isFinite);
}

function clone(definition: IndicatorDefinition): IndicatorDefinition {
  return {
    ...definition,
    aliases: [...definition.aliases],
    supportedRelationships: [...definition.supportedRelationships],
    parameters: definition.parameters
      ? { ...definition.parameters }
      : undefined,
  };
}

function readCustomDefinitions(): IndicatorDefinition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const sources = new Map(
      listIndicatorSources().map((source) => [source.id, source]),
    );
    return parsed.filter(isIndicatorDefinition).map((definition) => {
      const sourceId = definition.parameters?.indicatorSourceId;
      const source =
        typeof sourceId === "string" ? sources.get(sourceId) : undefined;
      return source
        ? {
            ...definition,
            parameters: {
              ...mergePineSourceParameters(definition.parameters, source),
              indicatorSourceId: source.id,
            },
          }
        : definition;
    });
  } catch {
    return [];
  }
}

function writeCustomDefinitions(definitions: IndicatorDefinition[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(definitions));
}

export function listDefinitions(): IndicatorDefinition[] {
  return [...BUILTIN_DEFINITIONS.map(clone), ...readCustomDefinitions()];
}

export function getDefinition(id: string): IndicatorDefinition | undefined {
  return listDefinitions().find((definition) => definition.id === id);
}

export function saveDefinition(
  definition: IndicatorDefinition,
): IndicatorDefinition {
  const clean = validateDefinition(definition);
  const custom = readCustomDefinitions();
  const index = custom.findIndex((candidate) => candidate.id === clean.id);
  if (index >= 0) custom[index] = clean;
  else custom.push(clean);
  writeCustomDefinitions(custom);
  return clean;
}

export function deleteDefinition(id: string): void {
  writeCustomDefinitions(
    readCustomDefinitions().filter((definition) => definition.id !== id),
  );
}

export function exportDefinitions(): string {
  return JSON.stringify(
    {
      schemaVersion: REGISTRY_VERSION,
      definitions: readCustomDefinitions(),
      indicatorSources: listIndicatorSources(),
    },
    null,
    2,
  );
}

export function importDefinitions(json: string): IndicatorDefinition[] {
  const parsed = JSON.parse(json) as {
    schemaVersion?: number;
    definitions?: unknown[];
    indicatorSources?: unknown[];
  };
  if (!Array.isArray(parsed.definitions)) {
    throw new Error("Definition file must contain a definitions array.");
  }
  const definitions = parsed.definitions.map((definition) =>
    validateDefinition(definition as IndicatorDefinition),
  );
  const byId = new Map(
    readCustomDefinitions().map((definition) => [definition.id, definition]),
  );
  for (const definition of definitions) {
    const existing = byId.get(definition.id);
    if (!existing || definition.updatedAt >= existing.updatedAt) {
      byId.set(definition.id, definition);
    }
  }
  const merged = [...byId.values()];
  writeCustomDefinitions(merged);
  mergeIndicatorSources(parsed.indicatorSources);
  return merged;
}

export function inferDefinition(
  label: string,
  values: number[],
): IndicatorDefinition {
  const name = normalized(label);
  const sample = finite(values).slice(0, 5000);
  const unique = new Set(sample);
  let template = BUILTIN_DEFINITIONS.find((definition) =>
    definition.aliases.some((alias) => {
      const candidate = normalized(alias);
      return name === candidate || name.includes(candidate);
    }),
  );

  if (
    unique.size >= 2 &&
    unique.size <= 5 &&
    [...unique].every((value) => Number.isInteger(value))
  ) {
    template = getDefinition("builtin.event");
  } else if (/\bupper\b/.test(name)) {
    template = getDefinition("builtin.upper-band");
  } else if (/\blower\b/.test(name)) {
    template = getDefinition("builtin.lower-band");
  } else if (/\b(?:basis|middle|midline|center)\b/.test(name)) {
    template = getDefinition("builtin.basis");
  } else if (
    /\b(?:price|vwap|support|resistance|pivot|level|session|day high|day low|week high|week low)\b/.test(
      name,
    )
  ) {
    template = getDefinition("builtin.price-level");
  } else if (
    label.includes("%") ||
    /\b(?:pct|percent|ratio|bandwidth|return)\b/.test(name)
  ) {
    template = getDefinition("builtin.percentage");
  } else if (sample.length > 10) {
    const low = Math.min(...sample);
    const high = Math.max(...sample);
    if ((low >= 0 && high <= 100) || (low >= -1 && high <= 1)) {
      template = getDefinition("builtin.oscillator");
    }
  }
  template ??= getDefinition("builtin.generic");

  return {
    ...clone(template as IndicatorDefinition),
    id: `inferred.${name.replace(/[^a-z0-9]+/g, ".") || "series"}`,
    canonicalName: label,
    aliases: [label],
    source: "inferred",
    confidence: template?.id === "builtin.generic" ? 0.45 : 0.8,
    reviewed: false,
    updatedAt: Date.now(),
  };
}

export function resolveDefinition(
  definitionId: string | undefined,
  label: string,
  values: number[],
): IndicatorDefinition {
  const normalizedLabel = normalized(label);
  const storedMatches = readCustomDefinitions()
    .filter(
      (definition) =>
        definition.reviewed &&
        [definition.canonicalName, ...definition.aliases].some(
          (candidate) => normalized(candidate) === normalizedLabel,
        ),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  // Never guess between several saved definitions that share an ambiguous
  // export label such as "Upper". Duplicate fields require an explicit
  // source mapping for the current upload.
  const storedMatch = storedMatches.length === 1 ? storedMatches[0] : undefined;

  return (
    (definitionId ? getDefinition(definitionId) : undefined) ??
    (storedMatch ? clone(storedMatch) : undefined) ??
    inferDefinition(label, values)
  );
}

export function validateDefinition(
  input: IndicatorDefinition,
): IndicatorDefinition {
  if (!input || typeof input !== "object")
    throw new Error("Invalid indicator definition.");
  const roles: IndicatorRole[] = [
    "price",
    "price-level",
    "upper-band",
    "lower-band",
    "basis",
    "oscillator",
    "volume",
    "volatility",
    "cumulative",
    "percentage",
    "binary-event",
    "generic-series",
  ];
  if (!input.id || !input.canonicalName || !roles.includes(input.role)) {
    throw new Error(
      "Definition requires id, canonicalName, and a supported role.",
    );
  }
  const allowed = new Set(
    BUILTIN_DEFINITIONS.flatMap(
      (definition) => definition.supportedRelationships,
    ),
  );
  const relationships = (input.supportedRelationships ?? []).filter(
    (primitive) => allowed.has(primitive),
  );
  return {
    ...input,
    version: Number.isFinite(input.version) ? input.version : REGISTRY_VERSION,
    description: input.description || input.canonicalName,
    aliases: Array.isArray(input.aliases)
      ? input.aliases.filter((alias) => typeof alias === "string")
      : [],
    supportedRelationships: [...new Set(relationships)],
    source: input.source ?? "user",
    confidence: Math.min(1, Math.max(0, Number(input.confidence) || 0)),
    updatedAt: Date.now(),
  };
}

export function isIndicatorDefinition(
  value: unknown,
): value is IndicatorDefinition {
  try {
    validateDefinition(value as IndicatorDefinition);
    return true;
  } catch {
    return false;
  }
}
