import type { ValidationResult } from "@/types";

export const VALIDATION_COHORT_LIMIT = 20;
export const MIN_OUT_OF_SAMPLE_OCCURRENCES = 20;

export function validationHeldUp(
  result: ValidationResult,
  passThreshold = 50,
): boolean {
  return (
    !result.degraded &&
    result.outOfSampleMetrics.sampleSize >= MIN_OUT_OF_SAMPLE_OCCURRENCES &&
    result.outOfSampleMetrics.winRate > passThreshold
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
  return "did not clear the reliability rule";
}
