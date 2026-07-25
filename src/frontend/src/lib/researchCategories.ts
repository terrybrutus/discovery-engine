import type { Feature, FeatureCategory } from "@/types";

export const MULTI_TIMEFRAME_CATEGORY = "Multi-Timeframe";

export function collectResearchCategories(
  catalogs: Feature[][],
  multiSource: boolean,
): FeatureCategory[] {
  const categories = new Set<FeatureCategory>();
  for (const feature of catalogs.flat()) {
    categories.add(feature.category);
  }
  if (multiSource) categories.add(MULTI_TIMEFRAME_CATEGORY);
  return [...categories];
}

export function requireMultiTimeframeCategory(
  categories: FeatureCategory[],
  multiSource: boolean,
): FeatureCategory[] {
  if (!multiSource || categories.includes(MULTI_TIMEFRAME_CATEGORY)) {
    return categories;
  }
  return [...categories, MULTI_TIMEFRAME_CATEGORY];
}
