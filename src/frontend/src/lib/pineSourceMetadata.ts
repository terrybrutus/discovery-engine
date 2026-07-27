import type { IndicatorSourceInput } from "@/lib/geminiDefinitionCompiler";

function hashSource(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function splitArguments(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") depth--;
    else if (char === "," && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}

function primitive(value: string): string | number | boolean {
  const clean = value.trim();
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    return clean.slice(1, -1);
  }
  if (clean === "true") return true;
  if (clean === "false") return false;
  const numeric = Number(clean);
  return Number.isFinite(numeric) ? numeric : clean;
}

function balancedCall(source: string, openIndex: number): string | null {
  let depth = 0;
  let quote = "";
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    if (char === ")") {
      depth--;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return null;
}

function declarationValue(
  source: string,
  name: "indicator" | "strategy",
): string | undefined {
  const match = new RegExp(`\\b${name}\\s*\\(`).exec(source);
  if (!match) return undefined;
  const openIndex = source.indexOf("(", match.index);
  const body = balancedCall(source, openIndex);
  return body ? splitArguments(body)[0] : undefined;
}

export function extractPineSourceParameters(
  indicator: IndicatorSourceInput,
): Record<string, string | number | boolean> {
  const source = indicator.source;
  const parameters: Record<string, string | number | boolean> = {
    sourceRegistryId: indicator.id,
    sourceName: indicator.name.trim() || "Unnamed indicator",
    sourceCodeHash: hashSource(source),
  };
  const version = source.match(/\/\/@\s*version\s*=\s*(\d+)/i)?.[1];
  if (version) parameters.pineVersion = Number(version);
  const declaration =
    declarationValue(source, "indicator") ??
    declarationValue(source, "strategy");
  if (declaration) parameters.indicatorTitle = primitive(declaration);

  const inputPattern =
    /(?:^|[\r\n;])\s*(?:var\s+)?(?:int|float|bool|string|color)?\s*([A-Za-z_]\w*)\s*=\s*input(?:\.[A-Za-z_]\w*)?\s*\(/g;
  for (;;) {
    const match = inputPattern.exec(source);
    if (!match) break;
    const variable = match[1];
    const openIndex = source.indexOf("(", match.index + match[0].length - 1);
    const body = balancedCall(source, openIndex);
    if (!body) continue;
    const args = splitArguments(body);
    const defaultArgument =
      args.find((argument) => /^\s*defval\s*=/.test(argument)) ?? args[0];
    if (!defaultArgument) continue;
    const rawDefault = defaultArgument.includes("=")
      ? defaultArgument.slice(defaultArgument.indexOf("=") + 1)
      : defaultArgument;
    parameters[`input.${variable}`] = primitive(rawDefault);
    const titleArgument = args.find((argument) =>
      /^\s*(?:title|name)\s*=/.test(argument),
    );
    if (titleArgument) {
      parameters[`inputTitle.${variable}`] = primitive(
        titleArgument.slice(titleArgument.indexOf("=") + 1),
      );
    }
  }

  const functions = [
    ...new Set(
      [...source.matchAll(/\bta\.([A-Za-z_]\w*)\s*\(/g)].map(
        (item) => `ta.${item[1]}`,
      ),
    ),
  ].sort();
  if (functions.length > 0)
    parameters.calculationFunctions = functions.join(", ");
  return parameters;
}

export function mergePineSourceParameters(
  existing: Record<string, string | number | boolean> | undefined,
  indicator: IndicatorSourceInput,
): Record<string, string | number | boolean> {
  const sourceKeys = new Set([
    "sourceRegistryId",
    "sourceName",
    "sourceCodeHash",
    "pineVersion",
    "indicatorTitle",
    "calculationFunctions",
  ]);
  const preserved = Object.fromEntries(
    Object.entries(existing ?? {}).filter(
      ([key]) =>
        !sourceKeys.has(key) &&
        !key.startsWith("input.") &&
        !key.startsWith("inputTitle."),
    ),
  );
  return {
    ...preserved,
    ...extractPineSourceParameters(indicator),
  };
}
