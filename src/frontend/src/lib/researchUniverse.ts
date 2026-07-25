import { datasetIntervalMs } from "@/lib/multiTimeframe";
import type { Dataset } from "@/types";

export interface InstrumentHierarchy {
  instrumentKey: string;
  datasets: Dataset[];
  timeframeLabels: string[];
  hierarchyLinks: number;
}

export interface ResearchUniverse {
  datasets: Dataset[];
  instruments: InstrumentHierarchy[];
  totalRows: number;
  inputColumns: string[];
  hasPrice: boolean;
  hasVolume: boolean;
  hierarchyLinks: number;
}

function instrumentKey(dataset: Dataset): string {
  return (
    dataset.instrumentKey ||
    (dataset.label ?? dataset.name)
      .toLowerCase()
      .replace(/\.(csv|txt|md)$/g, "")
      .replace(
        /(?:^|[\s_.-])(?:\d+(?:m|h|d|w)|daily|weekly)(?=$|[\s_.-])/g,
        " ",
      )
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") ||
    "uploaded_series"
  );
}

/**
 * Creates the canonical research topology. Datasets are grouped by instrument
 * and ordered by their measured interval; each adjacent interval forms one
 * explicit child→parent timeframe relationship.
 */
export function buildResearchUniverse(datasets: Dataset[]): ResearchUniverse {
  const byInstrument = new Map<string, Dataset[]>();
  for (const dataset of datasets) {
    const key = instrumentKey(dataset);
    const group = byInstrument.get(key) ?? [];
    group.push(dataset);
    byInstrument.set(key, group);
  }

  const instruments = [...byInstrument.entries()].map(
    ([key, group]): InstrumentHierarchy => {
      const ordered = [...group].sort(
        (left, right) =>
          datasetIntervalMs(left) - datasetIntervalMs(right) ||
          left.name.localeCompare(right.name),
      );
      const intervals = [
        ...new Set(ordered.map((dataset) => datasetIntervalMs(dataset))),
      ];
      return {
        instrumentKey: key,
        datasets: ordered,
        timeframeLabels: [
          ...new Set(ordered.map((dataset) => dataset.timeframe)),
        ],
        hierarchyLinks: Math.max(0, intervals.length - 1),
      };
    },
  );
  const inputColumns = [
    ...new Set(
      datasets.flatMap((dataset) =>
        dataset.columns
          .filter((column) => column.type !== "time")
          .map((column) => column.label),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));

  return {
    datasets,
    instruments,
    totalRows: datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0),
    inputColumns,
    hasPrice: datasets.some((dataset) => dataset.hasOHLC),
    hasVolume: datasets.some((dataset) => dataset.hasVolume),
    hierarchyLinks: instruments.reduce(
      (sum, instrument) => sum + instrument.hierarchyLinks,
      0,
    ),
  };
}
