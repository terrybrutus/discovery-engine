import { EmptyState } from "@/components/EmptyState";
import {
  ValidationAggregate,
  ValidationBreakdown,
} from "@/components/ValidationBreakdown";
import { ValidationTable } from "@/components/ValidationTable";
import { Button } from "@/components/ui/button";
import {
  VALIDATION_COHORT_LIMIT,
  validationHeldUp,
} from "@/lib/validationPolicy";
import { useEngineStore } from "@/store/engineStore";
import type { ValidationResult } from "@/types";
import {
  FlaskConical,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

/**
 * Validation tab — the third step. Tests whether the top discovered
 * patterns hold up on unseen (out-of-sample) data, breaks results down
 * by market condition and year, and flags patterns that degrade.
 *
 * Reads `validationResults`, `patterns`, and config from
 * the engine store. Runs `validatePatterns` (via `validateAction`)
 * against the current discovery results when the user clicks the
 * validate button.
 */
export default function ValidationPage() {
  const patterns = useEngineStore((s) => s.patterns);
  const validationResults = useEngineStore((s) => s.validationResults);
  const discoveryConfig = useEngineStore((s) => s.discoveryConfig);
  const isComputing = useEngineStore((s) => s.isComputing);
  const completedSteps = useEngineStore((s) => s.completedSteps);
  const validateAction = useEngineStore((s) => s.validateAction);
  const setActiveTab = useEngineStore((s) => s.setActiveTab);

  const [selected, setSelected] = useState<ValidationResult | null>(null);

  const discoveryComplete = completedSteps.has("discoveryComplete");
  const hasResults = validationResults.length > 0;
  const heldUpCount = validationResults.filter((result) =>
    validationHeldUp(result),
  ).length;
  const validatedHorizons = [
    ...new Set(
      patterns
        .filter((pattern) =>
          validationResults.some((result) => result.patternId === pattern.id),
        )
        .map((pattern) => pattern.horizon),
    ),
  ].sort((left, right) => left - right);

  // No patterns discovered yet — guide the user to the Discovery tab.
  if (!discoveryComplete || patterns.length === 0) {
    return (
      <div
        data-ocid="page.validation"
        className="mx-auto w-full max-w-5xl p-4 md:p-6"
      >
        <PageHeader />
        <EmptyState
          icon={Sparkles}
          title="No patterns to validate yet"
          description="Run Pattern Discovery first to find candidate patterns. Validation then re-tests the top patterns on unseen data to see which ones actually hold up."
          actionLabel="Go to Pattern Discovery"
          onAction={() => setActiveTab("discovery")}
          hint="Discovery trains on the oldest 70%. Validation tests the untouched newest 30% and requires survival in at least 3 of 4 walk-forward folds."
        />
      </div>
    );
  }

  return (
    <div
      data-ocid="page.validation"
      className="mx-auto w-full max-w-6xl p-4 md:p-6"
    >
      <PageHeader />

      {/* Action bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            data-ocid="validation.validate_button"
            onClick={validateAction}
            disabled={isComputing}
            size="lg"
          >
            {isComputing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            {hasResults ? "Refresh Validation" : "Validate Patterns"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Re-tests the same target-balanced{" "}
            {Math.min(patterns.length, VALIDATION_COHORT_LIMIT)} frozen
            candidates on the 70/30 chronological split. It does not rediscover
            patterns; independent symbol and timeframe survival are checked
            where compatible.
          </p>
        </div>
      </div>

      {/* Computing state */}
      {isComputing && !hasResults ? <ComputingState /> : null}

      {/* Results */}
      {hasResults ? (
        <>
          <SummaryBar total={validationResults.length} heldUp={heldUpCount} />

          {/* Aggregate validation statistics */}
          <div className="mb-5">
            <ValidationAggregate results={validationResults} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            <div
              className={selected ? "lg:col-span-3" : "lg:col-span-5"}
              data-ocid="validation.table_panel"
            >
              <ValidationTable
                results={validationResults}
                selectedId={selected?.patternId ?? null}
                onSelect={(r) => setSelected(r)}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Click a row to expand the full metric breakdown — in-sample vs
                out-of-sample, market-condition split, year-by-year,
                direction-adjusted MFE/MAE ratio, and cross-symbol survival.
              </p>
            </div>
            {selected ? (
              <div
                className="lg:col-span-2"
                data-ocid="validation.breakdown_panel"
              >
                <ValidationBreakdown
                  result={selected}
                  onClose={() => setSelected(null)}
                />
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {/* Screen-reader context reflects the frozen per-pattern horizons. */}
      <span className="sr-only" aria-hidden="true">
        {validatedHorizons.length > 0
          ? `Validated pattern-specific hold horizons: ${validatedHorizons.join(", ")} bars.`
          : `${discoveryConfig.horizon}-bar hold horizon.`}{" "}
        {discoveryConfig.mfeMaeWindow}-bar MFE/MAE window.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageHeader() {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="flex size-10 items-center justify-center rounded-md border border-border bg-card">
        <FlaskConical className="size-5 text-primary" aria-hidden="true" />
      </div>
      <div className="flex flex-col">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Validation
        </h2>
        <p className="text-sm text-muted-foreground">
          Do the discovered patterns actually hold up on unseen data?
        </p>
      </div>
    </div>
  );
}

function SummaryBar({
  total,
  heldUp,
}: {
  total: number;
  heldUp: number;
}) {
  return (
    <div
      data-ocid="validation.summary"
      className="mb-5 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-subtle"
    >
      <ShieldCheck
        className="size-5 text-primary shrink-0"
        aria-hidden="true"
      />
      <p className="text-sm text-foreground">
        <span className="font-mono tabular-nums font-semibold">{total}</span>{" "}
        pattern{total === 1 ? "" : "s"} validated,{" "}
        <span className="font-mono tabular-nums font-semibold text-primary">
          {heldUp}
        </span>{" "}
        cleared the untouched holdout and walk-forward reliability rules.
      </p>
    </div>
  );
}

function ComputingState() {
  return (
    <div
      data-ocid="validation.loading_state"
      className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-card/40 px-6 py-16 text-center"
    >
      <Loader2
        className="size-8 animate-spin text-primary"
        aria-hidden="true"
      />
      <div className="flex flex-col gap-1">
        <p className="font-display text-base font-semibold text-foreground">
          Validating patterns…
        </p>
        <p className="text-sm text-muted-foreground">
          Re-testing frozen training-period patterns on the untouched newest 30%
          and across expanding walk-forward folds.
        </p>
      </div>
    </div>
  );
}
