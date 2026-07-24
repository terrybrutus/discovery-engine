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
  type DefinitionMappingProposal,
  type IndicatorSourceInput,
  compileDefinitionsWithGemini,
  previewDefinitionCompilation,
} from "@/lib/geminiDefinitionCompiler";
import { useEngineStore } from "@/store/engineStore";
import type { IndicatorDefinition } from "@/types";
import { useActor, useInternetIdentity } from "@caffeineai/core-infrastructure";
import {
  BrainCircuit,
  Download,
  FileCode2,
  KeyRound,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function newIndicatorSource(): IndicatorSourceInput {
  return {
    id: `indicator-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`,
    name: "",
    source: "",
  };
}

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
  const [indicatorSources, setIndicatorSources] = useState<
    IndicatorSourceInput[]
  >([]);
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [proposals, setProposals] = useState<DefinitionMappingProposal[]>([]);
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
    () => previewDefinitionCompilation(selected, indicatorSources, notes),
    [selected, indicatorSources, notes],
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
        indicatorSources,
        userNotes: notes,
      });
      setProposals(result.proposals);
      setMessage(
        `Generated ${result.proposals.length} positional mappings for review. Estimated request cost: $${result.usage.estimatedCostUsd.toFixed(4)}.`,
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
    const accepted = proposals.map((proposal) =>
      saveDefinition({
        ...proposal.definition,
        reviewed: true,
        updatedAt: Date.now(),
      }),
    );
    for (let index = 0; index < proposals.length; index++) {
      const proposal = proposals[index];
      const definition = accepted[index];
      for (const assignment of proposal.assignments) {
        const dataset = selected.find(
          (candidate) => candidate.id === assignment.datasetId,
        );
        const column = dataset?.columns.find(
          (candidate) => candidate.key === assignment.columnKey,
        );
        if (column) column.definitionId = definition.id;
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

  const updateSource = (
    id: string,
    patch: Partial<IndicatorSourceInput>,
  ): void => {
    setIndicatorSources((current) =>
      current.map((source) =>
        source.id === id ? { ...source, ...patch } : source,
      ),
    );
  };

  const updateProposal = (
    index: number,
    patch: Partial<DefinitionMappingProposal>,
  ): void => {
    setProposals((current) =>
      current.map((proposal, proposalIndex) =>
        proposalIndex === index ? { ...proposal, ...patch } : proposal,
      ),
    );
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
            summaries, separate indicator sources, and your notes. It never
            receives the uploaded row history and it never calculates or
            validates a trading edge.
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

      <div className="mt-4 rounded-md border border-border bg-background/30 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <FileCode2 className="size-3.5 text-primary" />
              Indicator sources (optional)
            </div>
            <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
              Add each Pine indicator separately. Gemini uses its declaration,
              inputs, calculations, variables, and plot order to map duplicate
              table columns. Sources remain visible and independently editable.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setIndicatorSources((current) => [
                ...current,
                newIndicatorSource(),
              ])
            }
          >
            <Plus className="size-3.5" /> Add indicator source
          </Button>
        </div>

        {indicatorSources.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            No source added. Gemini can still classify unique positional columns
            from their names and value summaries.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {indicatorSources.map((indicator, index) => (
              <div
                key={indicator.id}
                className="rounded border border-border bg-card p-3"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Input
                    value={indicator.name}
                    onChange={(event) =>
                      updateSource(indicator.id, { name: event.target.value })
                    }
                    placeholder="Indicator label, e.g. Keltner 20 / 1.5"
                    aria-label={`Indicator ${index + 1} label`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setIndicatorSources((current) =>
                        current.filter((source) => source.id !== indicator.id),
                      )
                    }
                    aria-label={`Remove indicator ${index + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Textarea
                  value={indicator.source}
                  onChange={(event) =>
                    updateSource(indicator.id, { source: event.target.value })
                  }
                  placeholder="Paste this indicator's Pine source here."
                  aria-label={`Indicator ${index + 1} Pine source`}
                  className="min-h-32 font-mono text-xs"
                />
              </div>
            ))}
          </div>
        )}
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
          · {indicatorSources.filter((source) => source.source.trim()).length}{" "}
          source
          {indicatorSources.filter((source) => source.source.trim()).length ===
          1
            ? ""
            : "s"}{" "}
          · conservative request estimate ${preview.worstCaseCostUsd.toFixed(4)}
        </span>
      </div>
      {proposals.length > 0 ? (
        <div className="mt-4 rounded border border-border bg-muted/20 p-3">
          <div className="mb-1 text-xs font-medium">
            Review proposed source-to-column mappings
          </div>
          <p className="mb-3 text-[11px] text-muted-foreground">
            Duplicate names remain separate by column position. Correct the
            indicator or stored definition name before saving whenever Gemini is
            uncertain.
          </p>
          <div className="max-h-[32rem] space-y-2 overflow-y-auto">
            {proposals.map((proposal, index) => (
              <div
                key={proposal.column.id}
                className="grid gap-2 rounded border border-border bg-background p-3 text-xs lg:grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1fr)_minmax(12rem,1fr)]"
              >
                <div>
                  <div className="font-medium">
                    {proposal.column.displayLabel}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    Column {proposal.column.position} ·{" "}
                    {proposal.column.datasets.length} dataset
                    {proposal.column.datasets.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div>
                  <label
                    className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground"
                    htmlFor={`mapping-source-${index}`}
                  >
                    Indicator source
                  </label>
                  <select
                    id={`mapping-source-${index}`}
                    value={proposal.indicatorSourceId}
                    onChange={(event) => {
                      const source = indicatorSources.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      const indicatorSourceId = source?.id ?? "unmapped";
                      updateProposal(index, {
                        indicatorSourceId,
                        indicatorSourceName: source?.name || "Unmapped",
                        definition: {
                          ...proposal.definition,
                          parameters: {
                            ...(proposal.definition.parameters ?? {}),
                            indicatorSourceId,
                          },
                        },
                      });
                    }}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
                  >
                    <option value="unmapped">Unmapped / uncertain</option>
                    {indicatorSources
                      .filter((source) => source.source.trim())
                      .map((source, sourceIndex) => (
                        <option key={source.id} value={source.id}>
                          {source.name.trim() || `Indicator ${sourceIndex + 1}`}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                    {proposal.mappingReason}
                  </p>
                </div>
                <div>
                  <label
                    className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground"
                    htmlFor={`mapping-name-${index}`}
                  >
                    Stored definition name
                  </label>
                  <Input
                    id={`mapping-name-${index}`}
                    value={proposal.definition.canonicalName}
                    onChange={(event) =>
                      updateProposal(index, {
                        definition: {
                          ...proposal.definition,
                          canonicalName: event.target.value,
                        },
                      })
                    }
                  />
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {proposal.definition.role} · {proposal.definition.units} ·{" "}
                    {Math.round(proposal.definition.confidence * 100)}%
                    confidence
                  </div>
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
