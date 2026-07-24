// Domain logic for saved discovery runs.
//
// Pure functions over the runs storage. The mixin layer owns caller
// authorization and delegates the storage mutations here.
//
// Storage shape: Map<owner, Map<runId, SavedRun>>. The outer map keys runs by
// owner (per-user isolation); the inner map keys each owner's runs by id for
// O(log n) lookup by runId, which the compare view needs when loading several
// runs at once.

import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Types "../types/runs";

module {
  public type RunStore = Map.Map<Principal, Map.Map<Nat, Types.SavedRun>>;

  // Append a new run for the given owner, returning the stored run with its
  // assigned id. The caller is responsible for having already advanced the
  // id counter; the passed `nextId` is the id this run will receive.
  public func save(store : RunStore, owner : Principal, nextId : Nat, run : Types.SavedRun) : Types.SavedRun {
    let stored : Types.SavedRun = { run with id = nextId; owner = owner };
    let inner = switch (store.get(owner)) {
      case (?existing) existing;
      case null {
        let fresh = Map.empty<Nat, Types.SavedRun>();
        store.add(owner, fresh);
        fresh;
      };
    };
    inner.add(nextId, stored);
    stored;
  };

  // Return all runs belonging to `owner`, ordered most-recent-first.
  public func listForOwner(store : RunStore, owner : Principal) : [Types.SavedRun] {
    switch (store.get(owner)) {
      case (?inner) {
        let runs = inner.values().toArray();
        runs.sort(
          func(a, b) = Int.compare(b.savedAtNs, a.savedAtNs),
        );
      };
      case null [];
    };
  };

  // Project a SavedRun into the lightweight summary shape used by the runs-list
  // view. The dataset name is the first dataset's name (a run is typically
  // executed against a single dataset), or empty if the run has none. The
  // config summary is a compact one-line description of the key config knobs.
  public func summarize(run : Types.SavedRun) : Types.SavedRunSummary = {
    id = run.id;
    name = run.name;
    savedAtNs = run.savedAtNs;
    datasetName = if (run.datasets.size() > 0) {
      run.datasets[0].name;
    } else {
      "";
    };
    patternCount = run.patterns.size();
    configSummary = "horizon=" # run.config.horizon.toText()
      # " depth=" # run.config.maxDepth.toText()
      # " minWinRate=" # run.config.minWinRate.toText();
  };

  // Return lightweight summaries of all runs belonging to `owner`, ordered
  // most-recent-first. Avoids shipping the full patterns/validation arrays for
  // every saved run when the list view only needs row metadata.
  public func listSummariesForOwner(store : RunStore, owner : Principal) : [Types.SavedRunSummary] {
    listForOwner(store, owner).map(func(run) = summarize(run));
  };

  // Return a single run by owner + id, or null if not found / not owned.
  public func getForOwner(store : RunStore, owner : Principal, runId : Nat) : ?Types.SavedRun {
    switch (store.get(owner)) {
      case (?inner) inner.get(runId);
      case null null;
    };
  };

  // Return the runs identified by `runIds` that belong to `owner`, preserving
  // the order of `runIds`. Missing or unowned ids are dropped. Used by the
  // compare view to load two or more runs.
  public func getManyForOwner(store : RunStore, owner : Principal, runIds : [Nat]) : [Types.SavedRun] {
    switch (store.get(owner)) {
      case (?inner) {
        runIds.filterMap(
          func(id) = inner.get(id),
        );
      };
      case null [];
    };
  };

  // Permanently remove a run owned by `owner`. Returns true if a run was
  // removed.
  public func deleteForOwner(store : RunStore, owner : Principal, runId : Nat) : Bool {
    switch (store.get(owner)) {
      case (?inner) {
        let existed = inner.get(runId) != null;
        if existed { inner.remove(runId) };
        existed;
      };
      case null false;
    };
  };
};
