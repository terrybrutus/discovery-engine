import type { ColumnDef, Dataset, OHLCVBar } from "@/types";

// Mulberry32 — tiny deterministic PRNG so the sample dataset is stable
// across reloads (session-only persistence, but reproducible within a session).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal via Box-Muller.
function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const SESSION_OPEN_HOUR = 9; // 9:30 ET
const SESSION_OPEN_MIN = 30;
const SESSION_CLOSE_HOUR = 16;
const SESSION_CLOSE_MIN = 0;
const BAR_MINUTES = 5;
const BARS_PER_DAY = Math.floor(
  (SESSION_CLOSE_HOUR * 60 +
    SESSION_CLOSE_MIN -
    (SESSION_OPEN_HOUR * 60 + SESSION_OPEN_MIN)) /
    BAR_MINUTES,
); // 78 bars/day

const TRADING_DAYS = 250;

// Skip weekends when generating calendar days.
function nextTradingDay(d: Date): Date {
  const out = new Date(d.getTime());
  do {
    out.setUTCDate(out.getUTCDate() + 1);
  } while (out.getUTCDay() === 0 || out.getUTCDay() === 6);
  return out;
}

/**
 * Generate one year of realistic intraday OHLCV bars (5-minute, ~250 trading
 * days, ~19500 bars) using a seeded random walk with realistic volatility,
 * overnight gaps, and varying volatility regimes (trending vs choppy).
 *
 * Generated at runtime to keep bundle size reasonable.
 */
export function getSampleDataset(): Dataset {
  const rand = mulberry32(20240117);
  const bars: OHLCVBar[] = [];

  // Start price ~ ES/NQ-style index futures.
  let price = 4800;
  let day = new Date(Date.UTC(2024, 0, 8, 14, 30)); // first Monday-ish in UTC

  // Volatility regime state machine: drifts between trending and choppy.
  let _regime = "trending";
  let regimeDaysLeft = 12;
  let trendBias = (rand() - 0.5) * 0.0008; // per-bar drift
  let baseVol = 0.0016; // per-bar vol

  for (let d = 0; d < TRADING_DAYS; d++) {
    if (regimeDaysLeft <= 0) {
      const r = rand();
      if (r < 0.4) {
        _regime = "trending";
        baseVol = 0.0014 + rand() * 0.0006;
        trendBias = (rand() - 0.5) * 0.0012;
        regimeDaysLeft = 8 + Math.floor(rand() * 12);
      } else if (r < 0.75) {
        _regime = "choppy";
        baseVol = 0.0009 + rand() * 0.0004;
        trendBias = (rand() - 0.5) * 0.0002;
        regimeDaysLeft = 6 + Math.floor(rand() * 8);
      } else {
        _regime = "volatile";
        baseVol = 0.0026 + rand() * 0.0012;
        trendBias = (rand() - 0.5) * 0.0006;
        regimeDaysLeft = 4 + Math.floor(rand() * 6);
      }
    }
    regimeDaysLeft--;

    // Overnight gap.
    const gapPct = gaussian(rand) * 0.0035;
    const prevClose = price;
    let open = prevClose * (1 + gapPct);
    if (open <= 0) open = prevClose;

    // Per-day volume baseline with intraday U-shape (high at open/close).
    const dayBaseVol = 8000 + rand() * 6000;
    let cur = open;

    for (let b = 0; b < BARS_PER_DAY; b++) {
      const minutesIntoSession = b * BAR_MINUTES;
      // U-shape volume: high near open and close.
      const sessionProgress = minutesIntoSession / (BARS_PER_DAY * BAR_MINUTES);
      const uShape =
        1.6 -
        1.2 * Math.sin(Math.PI * Math.min(1, Math.max(0, sessionProgress)));
      const volNoise = 0.6 + rand() * 0.9;
      const volume = Math.round(dayBaseVol * uShape * volNoise);

      // Per-bar return.
      const shock = gaussian(rand) * baseVol;
      const ret = trendBias + shock;
      const openBar = cur;
      let close = openBar * (1 + ret);
      if (close <= 0) close = openBar * 0.99;
      // Intraday wick range scales with vol.
      const wickRange = Math.abs(gaussian(rand)) * baseVol * openBar * 1.4;
      const high = Math.max(openBar, close) + wickRange * rand();
      const low = Math.min(openBar, close) - wickRange * rand();

      const ts =
        day.getTime() +
        minutesIntoSession * 60 * 1000 -
        new Date().getTimezoneOffset() * 60 * 1000; // keep wall-clock ET-ish

      bars.push({
        timestamp: ts,
        open: round2(openBar),
        high: round2(Math.max(high, openBar, close)),
        low: round2(Math.max(0, Math.min(low, openBar, close))),
        close: round2(close),
        volume,
      });
      cur = close;
    }

    price = cur;
    day = nextTradingDay(day);
  }

  bars.sort((a, b) => a.timestamp - b.timestamp);

  const originalColumns = [
    "timestamp",
    "open",
    "high",
    "low",
    "close",
    "volume",
  ];
  const columns: ColumnDef[] = [
    { key: "timestamp", label: "timestamp", type: "time" },
    { key: "open", label: "open", type: "ohlcv" },
    { key: "high", label: "high", type: "ohlcv" },
    { key: "low", label: "low", type: "ohlcv" },
    { key: "close", label: "close", type: "ohlcv" },
    { key: "volume", label: "volume", type: "ohlcv" },
  ];

  return {
    id: "ds-sample-nq-5m-1yr",
    name: "Sample: NQ Futures (5m, 1yr)",
    label: "Sample: NQ Futures (5m, 1yr)",
    originalColumns,
    columns,
    bars,
    // Populate columnValues for the OHLCV columns so the sample dataset
    // matches the shape produced by csvParser. Custom indicator columns
    // are absent in the sample; columnValues is optional on the type.
    columnValues: {
      open: bars.map((b) => b.open),
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      close: bars.map((b) => b.close),
      volume: bars.map((b) => b.volume),
    },
    timeframe: "5m",
    dateRange: {
      start: bars[0].timestamp,
      end: bars[bars.length - 1].timestamp,
    },
    rowCount: bars.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
