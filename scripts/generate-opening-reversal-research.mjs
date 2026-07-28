import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(
  process.argv[2] ??
    "/Users/tb/Documents/Codex/outputs/opening-reversal-research",
);
const inputs = {
  djDaily: process.argv[3] ?? "/tmp/yahoo_dji_daily.json",
  ndxDaily: process.argv[4] ?? "/tmp/yahoo_ndx_daily.json",
  dia5m: process.argv[5] ?? "/tmp/yahoo_dia_5m.json",
  qqq5m: process.argv[6] ?? "/tmp/yahoo_qqq_5m.json",
};

function parseYahoo(payload) {
  const result = JSON.parse(payload).chart.result[0];
  const quote = result.indicators.quote[0];
  return result.timestamp
    .map((seconds, index) => ({
      timestamp: seconds * 1000,
      open: quote.open[index],
      high: quote.high[index],
      low: quote.low[index],
      close: quote.close[index],
      volume: quote.volume[index] ?? 0,
    }))
    .filter((bar) =>
      [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite),
    );
}

function csv(bars) {
  return [
    "time,open,high,low,close,volume",
    ...bars.map((bar) =>
      [
        new Date(bar.timestamp).toISOString(),
        bar.open.toFixed(5),
        bar.high.toFixed(5),
        bar.low.toFixed(5),
        bar.close.toFixed(5),
        Math.round(bar.volume),
      ].join(","),
    ),
  ].join("\n");
}

function calibration(dailyBars, intradayBars) {
  const dailyRanges = dailyBars.slice(1).map((bar, index) => {
    const previous = dailyBars[index];
    const trueRange = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previous.close),
      Math.abs(bar.low - previous.close),
    );
    return {
      trueRangePct: (trueRange / previous.close) * 100,
      gapPct: ((bar.open - previous.close) / previous.close) * 100,
    };
  });
  const returns = dailyBars.slice(1).map(
    (bar, index) =>
      ((bar.close - dailyBars[index].close) / dailyBars[index].close) * 100,
  );
  const average = (values) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const standardDeviation = (values) => {
    const mean = average(values);
    return Math.sqrt(
      average(values.map((value) => (value - mean) ** 2)),
    );
  };
  const sortedRanges = dailyRanges
    .map((item) => item.trueRangePct)
    .sort((left, right) => left - right);
  return {
    latestPrice: dailyBars.at(-1).close,
    dailyReturnStdPct: standardDeviation(returns),
    averageTrueRangePct: average(
      dailyRanges.map((item) => item.trueRangePct),
    ),
    medianTrueRangePct: sortedRanges[Math.floor(sortedRanges.length / 2)],
    gapStdPct: standardDeviation(dailyRanges.map((item) => item.gapPct)),
    intradayBars: intradayBars.length,
  };
}

function scaleProxy(intradayBars, indexPrice) {
  const proxyPrice = intradayBars.at(-1).close;
  const factor = indexPrice / proxyPrice;
  return intradayBars.map((bar) => ({
    ...bar,
    open: bar.open * factor,
    high: bar.high * factor,
    low: bar.low * factor,
    close: bar.close * factor,
  }));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function gaussian(random) {
  const left = Math.max(Number.EPSILON, random());
  const right = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
}

function nextBusinessDay(date) {
  const next = new Date(date);
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while (next.getUTCDay() === 0 || next.getUTCDay() === 6);
  return next;
}

function aggregate(bars, size) {
  const output = [];
  for (let index = 0; index + size <= bars.length; index += size) {
    const group = bars.slice(index, index + size);
    output.push({
      timestamp: group[0].timestamp,
      open: group[0].open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: group.at(-1).close,
      volume: group.reduce((sum, bar) => sum + bar.volume, 0),
    });
  }
  return output;
}

function fiveToOneMinute(bar) {
  const output = [];
  let previous = bar.open;
  for (let minute = 0; minute < 5; minute++) {
    const fraction = (minute + 1) / 5;
    const close =
      minute === 4 ? bar.close : bar.open + (bar.close - bar.open) * fraction;
    const high =
      minute === 1
        ? Math.max(previous, close, bar.high)
        : Math.max(previous, close);
    const low =
      minute === 2
        ? Math.min(previous, close, bar.low)
        : Math.min(previous, close);
    output.push({
      timestamp: bar.timestamp + minute * 60_000,
      open: previous,
      high,
      low,
      close,
      volume: bar.volume / 5,
    });
    previous = close;
  }
  return output;
}

function syntheticMarket({
  seed,
  startPrice,
  dailyReturnStdPct,
  averageTrueRangePct,
  gapStdPct,
  planted,
}) {
  const random = seededRandom(seed);
  const oneMinute = [];
  const daily = [];
  let date = new Date("2025-01-02T14:30:00.000Z");
  let previousClose = startPrice;
  const recentTrueRanges = [];
  for (let day = 0; day < 360; day++) {
    const regime =
      day < 65 ? 0.75 : day < 130 ? 1.35 : day < 195 ? 0.95 : 1.65;
    const gap =
      previousClose * (gaussian(random) * gapStdPct * regime * 0.01);
    const dayOpen = previousClose + gap;
    const trailingAtr =
      recentTrueRanges.length > 0
        ? recentTrueRanges.slice(-14).reduce((sum, value) => sum + value, 0) /
          Math.min(14, recentTrueRanges.length)
        : previousClose * averageTrueRangePct * 0.01;
    const openingAtrPct = 18 + random() * 38;
    const openingRange = trailingAtr * (openingAtrPct / 100);
    const direction = random() < 0.5 ? 1 : -1;
    const reliableSetup = planted && openingAtrPct >= 35;
    const success = reliableSetup
      ? random() < 0.82
      : planted
        ? random() < 0.48
        : random() < 0.3;
    const bars5m = [];
    let price = dayOpen;
    const openingLow = direction > 0 ? dayOpen - openingRange * 0.15 : dayOpen - openingRange;
    const openingHigh = direction > 0 ? dayOpen + openingRange : dayOpen + openingRange * 0.15;
    for (let slot = 0; slot < 78; slot++) {
      const timestamp = date.getTime() + slot * 5 * 60_000;
      let open = price;
      let close = open;
      let high = open;
      let low = open;
      if (slot < 3) {
        const fraction = (slot + 1) / 3;
        close =
          direction > 0
            ? dayOpen + openingRange * 0.82 * fraction
            : dayOpen - openingRange * 0.82 * fraction;
        high =
          slot === 2 ? Math.max(open, close, openingHigh) : Math.max(open, close);
        low =
          slot === 2 ? Math.min(open, close, openingLow) : Math.min(open, close);
      } else if (slot === 4) {
        if (direction > 0) {
          high = openingHigh + openingRange * 0.12;
          low = open - openingRange * 0.08;
          close = low + (high - low) * 0.18;
        } else {
          low = openingLow - openingRange * 0.12;
          high = open + openingRange * 0.08;
          close = low + (high - low) * 0.82;
        }
      } else if (
        slot >= 5 &&
        slot <= 10 &&
        (reliableSetup || !planted)
      ) {
        const target = success
          ? (openingHigh + openingLow) / 2
          : direction > 0
            ? openingHigh + openingRange * 0.16
            : openingLow - openingRange * 0.16;
        close = open + (target - open) * 0.55;
        high = Math.max(open, close) + openingRange * 0.015;
        low = Math.min(open, close) - openingRange * 0.015;
      } else {
        const uShape = slot < 12 || slot > 65 ? 1.4 : 0.65;
        const noise =
          previousClose *
          dailyReturnStdPct *
          0.01 *
          regime *
          uShape *
          gaussian(random) /
          Math.sqrt(78);
        close = open + noise;
        high = Math.max(open, close) + Math.abs(noise) * random() * 0.5;
        low = Math.min(open, close) - Math.abs(noise) * random() * 0.5;
      }
      const bar = {
        timestamp,
        open,
        high: Math.max(high, open, close),
        low: Math.min(low, open, close),
        close,
        volume: 1000 * (1 + Math.abs(gaussian(random))) * (slot < 12 ? 1.7 : 1),
      };
      bars5m.push(bar);
      price = close;
    }
    const bars1m = bars5m.flatMap(fiveToOneMinute);
    oneMinute.push(...bars1m);
    const dailyBar = {
      timestamp: date.getTime(),
      open: bars5m[0].open,
      high: Math.max(...bars5m.map((bar) => bar.high)),
      low: Math.min(...bars5m.map((bar) => bar.low)),
      close: bars5m.at(-1).close,
      volume: bars5m.reduce((sum, bar) => sum + bar.volume, 0),
    };
    daily.push(dailyBar);
    const trueRange = Math.max(
      dailyBar.high - dailyBar.low,
      Math.abs(dailyBar.high - previousClose),
      Math.abs(dailyBar.low - previousClose),
    );
    recentTrueRanges.push(trueRange);
    previousClose = Math.max(
      startPrice * 0.45,
      dailyBar.close +
        startPrice * dailyReturnStdPct * 0.0005 * gaussian(random),
    );
    date = nextBusinessDay(date);
  }
  return {
    "1m": oneMinute,
    "5m": aggregate(oneMinute, 5),
    "15m": aggregate(oneMinute, 15),
    "1d": daily,
  };
}

await mkdir(outputDirectory, { recursive: true });
const [djDaily, ndxDaily, dia5m, qqq5m] = await Promise.all(
  Object.values(inputs).map(async (path) => parseYahoo(await readFile(path, "utf8"))),
);
const djCalibration = calibration(djDaily, dia5m);
const ndxCalibration = calibration(ndxDaily, qqq5m);
const realFiles = [
  ["YAHOO_DJ30_PROXY_1D.csv", djDaily],
  ["YAHOO_DJ30_PROXY_5m.csv", scaleProxy(dia5m, djCalibration.latestPrice)],
  ["YAHOO_USTECH_PROXY_1D.csv", ndxDaily],
  ["YAHOO_USTECH_PROXY_5m.csv", scaleProxy(qqq5m, ndxCalibration.latestPrice)],
];
for (const [name, bars] of realFiles) {
  await writeFile(resolve(outputDirectory, name), csv(bars));
}

const markets = [
  {
    prefix: "CONTROL_DJ30",
    seed: 30,
    calibration: djCalibration,
  },
  {
    prefix: "CONTROL_USTECH",
    seed: 100,
    calibration: ndxCalibration,
  },
];
for (const market of markets) {
  for (const planted of [true, false]) {
    const generated = syntheticMarket({
      seed: market.seed + (planted ? 0 : 10_000),
      startPrice: market.calibration.latestPrice,
      dailyReturnStdPct: market.calibration.dailyReturnStdPct,
      averageTrueRangePct: market.calibration.averageTrueRangePct,
      gapStdPct: market.calibration.gapStdPct,
      planted,
    });
    const kind = planted ? "PLANTED_EDGE" : "NULL";
    for (const [timeframe, bars] of Object.entries(generated)) {
      await writeFile(
        resolve(outputDirectory, `${market.prefix}_${kind}_${timeframe}.csv`),
        csv(bars),
      );
    }
  }
}

const manifest = {
  generatedAt: new Date().toISOString(),
  source: {
    daily: "Yahoo Finance public chart data for ^DJI and ^NDX",
    intraday:
      "Yahoo Finance public 5-minute DIA and QQQ data, multiplied by a constant only to resemble index price scale",
    caveat:
      "DIA and QQQ are liquid ETF proxies, not identical to cash indices or CFD broker feeds.",
  },
  calibration: { DJ30: djCalibration, USTECH: ndxCalibration },
  controls: {
    plantedEdge: {
      purpose:
        "Prove the engine can recover a stable opening-reversal relationship without being told the winning threshold.",
      plantedStableRegion:
        "Opening range >= approximately 35% of prior daily ATR, rejection around 50% wick / <=50% body, then fade toward the opening midpoint.",
      expected:
        "The optimizer should prefer the 35%-50% ATR neighborhood, show positive development folds and sealed holdout results, and retain enough trades.",
    },
    null: {
      purpose:
        "Prove safeguards refuse a file whose opening moves and subsequent outcomes are random.",
      expected:
        "No candidate should clear development, sealed-holdout, doubled-cost, and stable-neighborhood safeguards together.",
    },
  },
};
await writeFile(
  resolve(outputDirectory, "CONTROL_MANIFEST.json"),
  JSON.stringify(manifest, null, 2),
);
await writeFile(
  resolve(outputDirectory, "README.md"),
  `# Opening reversal research package

Use one symbol package at a time to keep browser memory controlled.

## Real Yahoo proxy research

- YAHOO_DJ30_PROXY_1D.csv + YAHOO_DJ30_PROXY_5m.csv
- YAHOO_USTECH_PROXY_1D.csv + YAHOO_USTECH_PROXY_5m.csv

The 5-minute prices are DIA/QQQ ETF proxy bars multiplied by a constant to resemble the corresponding index price scale. Percentage behavior is unchanged.

## Planted controls

Upload the matching 1m, 5m, 15m, and 1d files for one CONTROL_*_PLANTED_EDGE package. The optimizer should recover the stable region documented in CONTROL_MANIFEST.json. Then repeat with the matching NULL files; it should recommend nothing.

The controls are verification fixtures, not evidence that the real-market strategy works.
`,
);
console.log(outputDirectory);
