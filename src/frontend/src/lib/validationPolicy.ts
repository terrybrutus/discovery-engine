import type { ValidationResult } from "@/types";

// Every pattern that can reach reporting or system construction must receive
// the same chronological validation. Leaving most displayed patterns marked
// "not-tested" allowed them to outrank the few patterns that actually held up.
export const VALIDATION_COHORT_LIMIT = 100;
export const MIN_OUT_OF_SAMPLE_OCCURRENCES = 20;

export function validationHeldUp(
  result: ValidationResult,
  passThreshold = 50,
): boolean {
  const directionHeld =
    (result.outOfSampleMetrics.direction === "bullish" &&
      result.outOfSampleMetrics.avgMove > 0) ||
    (result.outOfSampleMetrics.direction === "bearish" &&
      result.outOfSampleMetrics.avgMove < 0);
  const walkForwardHeld =
    result.walkForward == null ||
    (result.walkForward.passedFolds >=
      Math.ceil(result.walkForward.folds * 0.75) &&
      result.walkForward.meanWinRate > passThreshold);
  return (
    !result.degraded &&
    result.outOfSampleMetrics.sampleSize >= MIN_OUT_OF_SAMPLE_OCCURRENCES &&
    result.outOfSampleMetrics.winRate > passThreshold &&
    directionHeld &&
    walkForwardHeld
  );
}

export function validationFailureReason(result: ValidationResult): string {
  if (result.outOfSampleMetrics.sampleSize < MIN_OUT_OF_SAMPLE_OCCURRENCES) {
    return `only ${result.outOfSampleMetrics.sampleSize} out-of-sample occurrences`;
  }
  if (result.outOfSampleMetrics.winRate <= 50) {
    return `${result.outOfSampleMetrics.winRate.toFixed(1)}% out-of-sample win rate`;
  }
  if (result.degraded) return result.degradationNote.toLowerCase();
  const directionHeld =
    (result.outOfSampleMetrics.direction === "bullish" &&
      result.outOfSampleMetrics.avgMove > 0) ||
    (result.outOfSampleMetrics.direction === "bearish" &&
      result.outOfSampleMetrics.avgMove < 0);
  if (!directionHeld) {
    return "average out-of-sample move opposed the claimed direction";
  }
  if (
    result.walkForward &&
    (result.walkForward.passedFolds <
      Math.ceil(result.walkForward.folds * 0.75) ||
      result.walkForward.meanWinRate <= 50)
  ) {
    return `held in only ${result.walkForward.passedFolds}/${result.walkForward.folds} walk-forward folds`;
  }
  return "did not clear the reliability rule";
}
