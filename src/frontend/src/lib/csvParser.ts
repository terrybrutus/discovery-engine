import type { ColumnDef, Dataset, OHLCVBar, Timeframe } from "@/types";
import Papa from "papaparse";

export interface ParseResult {
  dataset?: Dataset;
  error?: string;
}

export const COLUMN_ALIASES: Record<string, string[]> = {
  timestamp: ["timestamp", "time", "date", "datetime", "dt", "unix", "ts"],
  open: ["open", "o"],
  high: ["high", "h"],
  low: ["low", "l"],
  close: ["close", "c", "last", "price"],
  volume: ["volume", "vol", "v"],
};

/** Set of canonical OHLCV keys (excludes timestamp, which is "time"). */
export const OHLCV_CANONICAL = new Set([
  "open",
  "high",
  "low",
  "close",
  "volume",
]);

/** Accepted file extensions for the data intake. */
export const ACCEPTED_EXTENSIONS = [".csv", ".txt", ".md"];

/** Returns true if the file name has an accepted tabular extension. */
export function isAcceptedFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Produce the internal normalized key for a header: lowercase, with spaces
 * and special characters replaced by underscores. Consecutive underscores
 * are collapsed and leading/trailing underscores trimmed.
 *
 * Exported so downstream consumers (crossReference, DataPreview) can
 * normalize column names identically when looking up `columnValues`.
 */
export function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Compact alias matcher used by the OHLCV detector. Strips spaces/underscores/
 * hyphens entirely so "Open Price" → "openprice" matches alias "open" only
 * when the alias set is exact. Kept for backward-compatible OHLCV detection.
 */
function compactHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]/g, "");
}

function detectColumnIndex(
  headers: string[],
  canonical: keyof typeof COLUMN_ALIASES,
): number {
  const aliases = COLUMN_ALIASES[canonical].map(compactHeader);
  for (let i = 0; i < headers.length; i++) {
    const norm = compactHeader(headers[i]);
    if (aliases.includes(norm)) return i;
  }
  return -1;
}

function parseTimestamp(raw: string): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Pure number — unix seconds or ms
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    // Heuristic: < 1e11 is seconds, otherwise ms
    return n < 1e11 ? n * 1000 : n;
  }
  // ISO date string
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

function parseNumber(raw: string): number | null {
  if (raw == null) return null;
  const cleaned = raw.trim().replace(/,/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function inferIntervalMs(bars: OHLCVBar[]): number {
  if (bars.length < 2) return 60_000;
  const deltas: number[] = [];
  for (let i = 1; i < Math.min(bars.length, 50); i++) {
    deltas.push(bars[i].timestamp - bars[i - 1].timestamp);
  }
  const sorted = deltas.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median > 0 ? median : 60_000;
}

function inferTimeframe(intervalMs: number): Timeframe {
  const minute = 60_000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return "unknown";
  const roundedMinutes = Math.round(intervalMs / minute);
  // Accept arbitrary whole-minute chart intervals rather than maintaining a
  // hard-coded vocabulary. This gives 45m its correct place automatically.
  if (Math.abs(intervalMs - roundedMinutes * minute) / intervalMs <= 0.08) {
    if (roundedMinutes % (7 * 24 * 60) === 0) {
      return `${roundedMinutes / (7 * 24 * 60)}w`;
    }
    if (roundedMinutes % (24 * 60) === 0) {
      return `${roundedMinutes / (24 * 60)}d`;
    }
    if (roundedMinutes % 60 === 0) {
      return `${roundedMinutes / 60}h`;
    }
    return `${roundedMinutes}m`;
  }
  return "unknown";
}

function inferInstrumentKey(name: string): string {
  const withoutExtension = name.replace(/\.(csv|txt|md)$/i, "");
  const withoutTimeframe = withoutExtension
    .replace(
      /(?:^|[\s_.-])(?:(?:\d+)(?:m|h|d|w)|60|240|daily|weekly)(?=$|[\s_.-])/gi,
      " ",
    )
    .replace(/\(\d+\)$/g, " ");
  return (
    normalizeHeader(withoutTimeframe).replace(/^(?:\d+_)+/, "") ||
    normalizeHeader(withoutExtension) ||
    "uploaded_series"
  );
}

/** Monotonic id counter for datasets created in this session. */
let datasetIdCounter = 0;
function nextDatasetId(): string {
  datasetIdCounter += 1;
  return `ds-${Date.now().toString(36)}-${datasetIdCounter}`;
}

/**
 * Build the ColumnDef[] and originalColumns[] from a raw header row.
 * - The timestamp column (if found) is typed "time".
 * - Known OHLCV columns are typed "ohlcv".
 * - Every other column is typed "numeric" (parseFloat-friendly) by default;
 *   if a sample value cannot be parsed as a number it falls back to "unknown".
 */
function buildColumns(
  headers: string[],
  tsIdx: number,
  ohlcvIndices: Set<number>,
  sampleRows: string[][],
): { originalColumns: string[]; columns: ColumnDef[] } {
  const originalColumns = headers.slice();
  const keyOccurrences = new Map<string, number>();
  const columns: ColumnDef[] = headers.map((header, i) => {
    const baseKey = normalizeHeader(header) || `col_${i}`;
    const occurrence = (keyOccurrences.get(baseKey) ?? 0) + 1;
    keyOccurrences.set(baseKey, occurrence);
    // TradingView frequently exports several plots with the same title
    // (Upper, Lower, Basis, etc.). Preserve every positional column instead
    // of letting duplicate normalized keys overwrite one another.
    const key = occurrence === 1 ? baseKey : `${baseKey}__${occurrence}`;
    let type: ColumnDef["type"];
    if (i === tsIdx) {
      type = "time";
    } else if (ohlcvIndices.has(i)) {
      type = "ohlcv";
    } else if (sampleRows.length > 0) {
      // Indicators commonly begin with a warm-up region of blank/NaN values.
      // Inspect a window instead of only the first data row so valid imported
      // signals are not incorrectly discarded.
      const hasNumericValue = sampleRows.some(
        (row) => parseNumber(row[i] ?? "") != null,
      );
      type = hasNumericValue ? "numeric" : "unknown";
    } else {
      type = "numeric";
    }
    return { key, label: header, type };
  });
  return { originalColumns, columns };
}

/**
 * Parse a delimiter-separated tabular string (CSV, TXT, or MD) into a Dataset.
 * Auto-detects the delimiter via Papa.parse (comma, tab, semicolon, pipe),
 * auto-detects ALL columns from the header row (preserving original names
 * for display while using normalized keys internally), and keeps the existing
 * OHLCV alias mapping so bars still populate for known columns.
 *
 * This synchronous path is used for already-in-memory strings (small/medium
 * files). For File objects, prefer parseCsvFile which streams off the main
 * thread via Papa.parse worker mode.
 */
export function parseCsv(
  csvText: string,
  name = "Uploaded dataset",
): ParseResult {
  if (!csvText || csvText.trim() === "") {
    return {
      error:
        "The file is empty. Please upload a CSV, TXT, or MD file with a header row.",
    };
  }

  const parsed = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
    delimitersToGuess: [",", "\t", ";", "|"],
  });

  if (parsed.errors.length > 0 && !parsed.data.length) {
    return { error: `Could not read the file: ${parsed.errors[0].message}` };
  }

  const rows = parsed.data as string[][];
  if (rows.length < 2) {
    return {
      error:
        "The file has no data rows. Please include a header row followed by at least one data row.",
    };
  }

  return buildDatasetFromRows(rows, name);
}

/**
 * Shared row-to-Dataset builder used by both the synchronous parseCsv path
 * and the streaming parseCsvFile path. Auto-detects ALL columns from the
 * header row: known OHLCV aliases populate `bars`, every other column is
 * captured as a generic numeric column. Original header names are preserved
 * in `originalColumns` and `ColumnDef.label`; normalized keys live in
 * `ColumnDef.key`.
 */
function buildDatasetFromRows(rows: string[][], name: string): ParseResult {
  const headers = rows[0];
  const tsIdx = detectColumnIndex(headers, "timestamp");
  const openIdx = detectColumnIndex(headers, "open");
  const highIdx = detectColumnIndex(headers, "high");
  const lowIdx = detectColumnIndex(headers, "low");
  const closeIdx = detectColumnIndex(headers, "close");
  const volIdx = detectColumnIndex(headers, "volume");

  const hasOHLC =
    openIdx !== -1 && highIdx !== -1 && lowIdx !== -1 && closeIdx !== -1;
  const hasVolume = volIdx !== -1;
  const sampleRows = rows.slice(1, 201);
  const numericIndices = headers
    .map((_, index) => index)
    .filter(
      (index) =>
        index !== tsIdx &&
        sampleRows.some((row) => parseNumber(row[index] ?? "") != null),
    );
  const outcomeIdx = closeIdx !== -1 ? closeIdx : (numericIndices[0] ?? -1);

  const ohlcvIndices = new Set<number>();
  if (hasOHLC) {
    ohlcvIndices.add(openIdx);
    ohlcvIndices.add(highIdx);
    ohlcvIndices.add(lowIdx);
    ohlcvIndices.add(closeIdx);
  }
  if (hasVolume) ohlcvIndices.add(volIdx);

  const missing: string[] = [];
  if (tsIdx === -1) missing.push("timestamp (or date/time/datetime)");
  if (outcomeIdx === -1) missing.push("at least one numeric value column");
  if (missing.length > 0) {
    return {
      error: `Missing required columns: ${missing.join(", ")}. Found columns: ${headers.join(", ")}.`,
    };
  }

  const { originalColumns, columns } = buildColumns(
    headers,
    tsIdx,
    ohlcvIndices,
    sampleRows,
  );

  const bars: OHLCVBar[] = [];
  // columnValues[key] is parallel to `bars` by index. We collect parsed
  // numeric values for EVERY non-time column (OHLCV + custom indicators)
  // so downstream consumers can read custom column values directly.
  const columnValues: Record<string, number[]> = {};
  // Map each non-time column index → its normalized key, so we know which
  // buckets to populate per row. Only numeric/ohlcv columns are tracked;
  // "unknown"-typed columns are still attempted (parseNumber returns null).
  const columnKeyByIdx: { idx: number; key: string }[] = [];
  for (let i = 0; i < columns.length; i++) {
    if (i === tsIdx) continue;
    columnKeyByIdx.push({ idx: i, key: columns[i].key });
    columnValues[columns[i].key] = [];
  }

  let malformedCount = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const ts = parseTimestamp(row[tsIdx] ?? "");
    const primary = parseNumber(row[outcomeIdx] ?? "");
    const o = hasOHLC ? parseNumber(row[openIdx] ?? "") : primary;
    const h = hasOHLC ? parseNumber(row[highIdx] ?? "") : primary;
    const l = hasOHLC ? parseNumber(row[lowIdx] ?? "") : primary;
    const c = hasOHLC ? parseNumber(row[closeIdx] ?? "") : primary;
    const v = volIdx === -1 ? 0 : (parseNumber(row[volIdx] ?? "") ?? 0);

    if (ts == null || o == null || h == null || l == null || c == null) {
      malformedCount++;
      continue;
    }
    bars.push({ timestamp: ts, open: o, high: h, low: l, close: c, volume: v });

    // Populate columnValues for every tracked column at this bar index.
    for (const { idx, key } of columnKeyByIdx) {
      const parsed = parseNumber(row[idx] ?? "");
      // Push the parsed value, or NaN if missing/unparseable. Consumers
      // treat NaN as "no value at this index" (same semantics as a gap).
      columnValues[key].push(parsed == null ? Number.NaN : parsed);
    }
  }

  if (bars.length === 0) {
    return {
      error: `No valid rows could be parsed. ${malformedCount} row(s) had missing or malformed values.`,
    };
  }

  // Sort bars by timestamp, applying the SAME permutation to each
  // columnValues array so they stay parallel to bars by index.
  const order = bars
    .map((_, originalIdx) => originalIdx)
    .sort((a, b) => bars[a].timestamp - bars[b].timestamp);
  const sortedBars = order.map((origIdx) => bars[origIdx]);
  for (const key of Object.keys(columnValues)) {
    const src = columnValues[key];
    columnValues[key] = order.map((origIdx) => src[origIdx]);
  }
  bars.length = 0;
  for (const b of sortedBars) bars.push(b);
  const intervalMs = inferIntervalMs(bars);
  const outcomeColumn = columns[outcomeIdx];

  return {
    dataset: {
      id: nextDatasetId(),
      name,
      label: name || "Untitled",
      originalColumns,
      columns,
      bars,
      columnValues,
      timeframe: inferTimeframe(intervalMs),
      intervalMs,
      instrumentKey: inferInstrumentKey(name),
      hasOHLC,
      hasVolume,
      outcomeColumnKey: outcomeColumn.key,
      outcomeLabel: outcomeColumn.label,
      dateRange: {
        start: bars[0].timestamp,
        end: bars[bars.length - 1].timestamp,
      },
      rowCount: bars.length,
    },
  };
}

/**
 * Parse a File object into a Dataset using Papa.parse streaming + worker
 * mode so large files do not block the main thread. Accepts .csv, .txt, and
 * .md files; the delimiter is auto-detected (comma, tab, semicolon, pipe).
 *
 * Falls back to the synchronous parseCsv path if worker mode is unavailable
 * (e.g. very old browsers or non-File inputs) so the return shape stays
 * identical for callers.
 */
export function parseCsvFile(file: File): Promise<ParseResult> {
  const name = file.name.replace(/\.(csv|txt|md)$/i, "");

  return new Promise((resolve) => {
    // Worker support check: Papa.parse worker mode requires a browser
    // environment with Web Workers. If unavailable, fall back to reading
    // the file as text and using the synchronous parser.
    if (typeof Worker === "undefined") {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        resolve(parseCsv(text, name));
      };
      reader.onerror = () =>
        resolve({ error: `Could not read the file "${file.name}".` });
      reader.readAsText(file);
      return;
    }

    const rows: string[][] = [];
    let firstError: string | null = null;
    let sawAny = false;

    Papa.parse<string[]>(file, {
      worker: true,
      skipEmptyLines: true,
      delimitersToGuess: [",", "\t", ";", "|"],
      step: (results) => {
        sawAny = true;
        const row = results.data as string[];
        if (row && row.length > 0) rows.push(row);
        if (results.errors && results.errors.length > 0 && !firstError) {
          firstError = results.errors[0].message;
        }
      },
      complete: () => {
        if (!sawAny && firstError) {
          resolve({ error: `Could not read the file: ${firstError}` });
          return;
        }
        if (rows.length < 2) {
          resolve({
            error:
              "The file has no data rows. Please include a header row followed by at least one data row.",
          });
          return;
        }
        resolve(buildDatasetFromRows(rows, name));
      },
      error: (err: { message?: string } | Error) => {
        const msg =
          err instanceof Error
            ? err.message
            : (err?.message ?? `Could not read the file "${file.name}".`);
        resolve({ error: msg });
      },
    });
  });
}
