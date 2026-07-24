import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type PatternInterpretation,
  interpretPatternsWithGemini,
  previewInterpretationCost,
} from "@/lib/geminiPatternInterpreter";
import type { Pattern, ValidationResult } from "@/types";
import { BrainCircuit, KeyRound } from "lucide-react";
import { useMemo, useState } from "react";

export function ResearchInterpreter({
  patterns,
  validationResults,
}: {
  patterns: Pattern[];
  validationResults: ValidationResult[];
}) {
  const [apiKey, setApiKey] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [interpretation, setInterpretation] =
    useState<PatternInterpretation | null>(null);
  const estimate = useMemo(
    () => previewInterpretationCost(patterns),
    [patterns],
  );

  const run = async () => {
    setRunning(true);
    setError("");
    try {
      setInterpretation(
        await interpretPatternsWithGemini(apiKey, patterns, validationResults),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Interpretation failed.",
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <BrainCircuit
          className="mt-0.5 size-4 text-primary"
          aria-hidden="true"
        />
        <div>
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide">
            AI Research Interpretation
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Optional Gemini review of the top deterministic results. It receives
            conditions, outcome summaries, and validation statistics—not raw
            rows. It can explain and challenge candidates, but cannot turn an
            invalid pattern into a valid one.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <KeyRound className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Gemini API key (memory only)"
            autoComplete="off"
            className="pl-9"
          />
        </div>
        <Button onClick={() => void run()} disabled={!apiKey || running}>
          <BrainCircuit className="size-4" />
          {running ? "Reviewing…" : "Interpret Top Results"}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Conservative request estimate: ${estimate.toFixed(4)}. The key is never
        stored.
      </p>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      {interpretation ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm leading-relaxed">{interpretation.overview}</p>
          <div className="space-y-3">
            {interpretation.strongestCandidates.map((candidate) => (
              <article
                key={candidate.patternId}
                className="rounded border border-border bg-muted/20 p-3"
              >
                <div className="font-mono text-[10px] text-primary">
                  {candidate.patternId}
                </div>
                <h4 className="mt-1 text-sm font-medium">
                  {candidate.setupNarrative}
                </h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  {candidate.whyItMayMatter}
                </p>
                {candidate.statisticalConcerns.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-warning">
                    {candidate.statisticalConcerns.map((concern) => (
                      <li key={concern}>{concern}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-2 text-xs">
                  <span className="font-medium">Next test:</span>{" "}
                  {candidate.nextBacktest}
                </p>
              </article>
            ))}
          </div>
          {interpretation.rejectedOrWeak.length ? (
            <details className="rounded border border-border p-3">
              <summary className="cursor-pointer text-xs font-medium">
                Rejected or weak candidates (
                {interpretation.rejectedOrWeak.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {interpretation.rejectedOrWeak.map((candidate) => (
                  <li key={candidate.patternId}>
                    <span className="font-mono">{candidate.patternId}</span>:{" "}
                    {candidate.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="text-[11px] text-muted-foreground">
            Request cost estimate: $
            {interpretation.usage.estimatedCostUsd.toFixed(4)}
          </div>
        </div>
      ) : null}
    </section>
  );
}
