import { createActor } from "@/backend";
import type { Backend } from "@/backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  exportDefinitions,
  importDefinitions,
  listDefinitions,
  saveDefinition,
} from "@/lib/definitionRegistry";
import {
  compileDefinitionsWithGemini,
  previewDefinitionCompilation,
} from "@/lib/geminiDefinitionCompiler";
import { useEngineStore } from "@/store/engineStore";
import type { IndicatorDefinition } from "@/types";
import { useActor, useInternetIdentity } from "@caffeineai/core-infrastructure";
import { BrainCircuit, Download, KeyRound, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export function DefinitionManager() {
  const { actor } = useActor<Backend>(createActor);
  const { isAuthenticated } = useInternetIdentity();
  const datasets = useEngineStore((state) => state.datasets);
  const selectedDatasetIds = useEngineStore(
    (state) => state.selectedDatasetIds,
  );
  const generateFeatures = useEngineStore(
    (state) => state.generateFeaturesAction,
  );
  const [apiKey, setApiKey] = useState("");
  const [pineSource, setPineSource] = useState("");
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [proposals, setProposals] = useState<IndicatorDefinition[]>([]);
  const [definitions, setDefinitions] = useState<IndicatorDefinition[]>(() =>
    listDefinitions(),
  );
  const importRef = useRef<HTMLInputElement>(null);
  const syncedPrincipalRef = useRef("");
  const selected = useMemo(
    () => datasets.filter((dataset) => selectedDatasetIds.includes(dataset.id)),
    [datasets, selectedDatasetIds],
  );
  const preview = useMemo(
    () => previewDefinitionCompilation(selected, pineSource, notes),
    [selected, pineSource, notes],
  );

  const persistRegistry = async (): Promise<void> => {
    if (!isAuthenticated || actor === null) return;
    await actor.saveMyDefinitionRegistry(exportDefinitions());
  };

  useEffect(() => {
    if (!isAuthenticated || actor === null) {
      syncedPrincipalRef.current = "";
      return;
    }
    const syncKey = "authenticated";
    if (syncedPrincipalRef.current === syncKey) return;
    syncedPrincipalRef.current = syncKey;
    void (async () => {
      try {
        const remote = await actor.getMyDefinitionRegistry();
        if (remote) importDefinitions(remote);
        await actor.saveMyDefinitionRegistry(exportDefinitions());
        setDefinitions(listDefinitions());
        generateFeatures();
        setMessage("Definitions synchronized with your Internet Identity.");
      } catch (error) {
        syncedPrincipalRef.current = "";
        setMessage(
          error instanceof Error
            ? `Definition sync failed: ${error.message}`
            : "Definition sync failed.",
        );
      }
    })();
  }, [actor, generateFeatures, isAuthenticated]);

  const compile = async () => {
    setRunning(true);
    setMessage("");
    try {
      const result = await compileDefinitionsWithGemini({
        apiKey,
        datasets: selected,
        pineSource,
        userNotes: notes,
      });
      setProposals(result.definitions);
      setMessage(
        `Generated ${result.definitions.length} proposals for review. Estimated request cost: $${result.usage.estimatedCostUsd.toFixed(4)}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Definition compilation failed.",
      );
    } finally {
      setRunning(false);
    }
  };

  const acceptProposals = async () => {
    const accepted = proposals.map((definition) =>
      saveDefinition({ ...definition, reviewed: true, updatedAt: Date.now() }),
    );
    for (const dataset of selected) {
      for (const column of dataset.columns) {
        const match = accepted.find((definition) =>
          definition.aliases.some(
            (alias) =>
              alias.trim().toLowerCase() === column.label.trim().toLowerCase(),
          ),
        );
        if (match) column.definitionId = match.id;
      }
    }
    setDefinitions(listDefinitions());
    setProposals([]);
    generateFeatures();
    try {
      await persistRegistry();
      setMessage(
        isAuthenticated
          ? `Accepted and saved ${accepted.length} reusable definitions to your Internet Identity.`
          : `Accepted ${accepted.length} definitions in this browser. Sign in to sync them across devices.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Definitions saved locally, but identity sync failed: ${error.message}`
          : "Definitions saved locally, but identity sync failed.",
      );
    }
  };

  const discardProposals = () => {
    setProposals([]);
    setMessage("Definition proposals discarded.");
  };

  const download = () => {
    const blob = new Blob([exportDefinitions()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "discovery-engine-definitions.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = importDefinitions(await file.text());
      setDefinitions(listDefinitions());
      await persistRegistry();
      setMessage(
        isAuthenticated
          ? `Imported and synchronized ${imported.length} reusable definitions.`
          : `Imported ${imported.length} definitions in this browser. Sign in to sync them.`,
      );
      generateFeatures();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Definition import failed.",
      );
    }
  };

  const customCount = definitions.filter(
    (definition) => definition.source !== "builtin",
  ).length;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="size-4 text-primary" aria-hidden="true" />
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide">
              Indicator Definition Registry
            </h3>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Deterministic definitions control how every uploaded field is
            transformed. Gemini can classify unfamiliar outputs from column
            summaries, Pine source, and your notes. It never receives the
            uploaded row history and it never calculates or validates a trading
            edge.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={download}>
            <Download className="size-3.5" /> Export
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => importRef.current?.click()}
          >
            <Upload className="size-3.5" /> Import
          </Button>
          <input
            ref={importRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
        </div>
      </div>

      <div className="mb-3 text-xs text-muted-foreground">
        {definitions.length} definitions available · {customCount} inferred, AI,
        or user-defined · {preview.columns} uploaded fields in this request
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <label
            className="mb-1 flex items-center gap-1 text-xs font-medium"
            htmlFor="gemini-key"
          >
            <KeyRound className="size-3.5" /> Gemini API key
          </label>
          <Input
            id="gemini-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Held only in this component until the page reloads"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            The key is kept in memory, never saved in local storage, the
            registry, or a run. Calls go directly from your browser to Google.
          </p>
        </div>
        <div>
          <label
            className="mb-1 block text-xs font-medium"
            htmlFor="definition-notes"
          >
            Interpretation notes (optional)
          </label>
          <Input
            id="definition-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Example: Upper 2 and Lower 2 are the outer Bollinger envelope"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium" htmlFor="pine-source">
          Pine/indicator source (optional)
        </label>
        <Textarea
          id="pine-source"
          value={pineSource}
          onChange={(event) => setPineSource(event.target.value)}
          placeholder="Paste source only when the column names and statistics do not explain the outputs."
          className="min-h-24 font-mono text-xs"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void compile()}
          disabled={running || !apiKey || preview.columns === 0}
        >
          <BrainCircuit className="size-4" />
          {running ? "Compiling definitions…" : "Compile Unknown Definitions"}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Approx. {preview.approximateInputTokens.toLocaleString()} input tokens
          · conservative request estimate ${preview.worstCaseCostUsd.toFixed(4)}
        </span>
      </div>
      {proposals.length > 0 ? (
        <div className="mt-4 rounded border border-border bg-muted/20 p-3">
          <div className="mb-2 text-xs font-medium">
            Review proposed definitions
          </div>
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {proposals.map((definition) => (
              <div
                key={definition.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-background p-2 text-xs"
              >
                <div>
                  <div className="font-medium">{definition.canonicalName}</div>
                  <div className="text-muted-foreground">
                    {definition.role} · {definition.units} ·{" "}
                    {Math.round(definition.confidence * 100)}% classification
                    confidence
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {definition.supportedRelationships.length} supported
                  relationships
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void acceptProposals()}
            >
              Accept & Save All
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={discardProposals}
            >
              Discard
            </Button>
          </div>
        </div>
      ) : null}
      {message ? (
        <output className="mt-3 block text-xs text-muted-foreground">
          {message}
        </output>
      ) : null}
    </section>
  );
}
