// Public API surface for the saved-runs domain.
//
// Every update function verifies the caller via {caller} and refuses anonymous
// (unsigned) users — saving and comparing runs is gated behind Internet
// Identity sign-in. Read access is per-user: a caller only ever sees their own
// runs.

import Principal "mo:core/Principal";
import Types "../types/runs";
import Runs "../lib/runs";

mixin (
  runs : Runs.RunStore,
  nextRunId : { var value : Nat },
) {
  // Persist a discovery run for the signed-in caller. Returns the stored run
  // with its assigned id. Anonymous callers are rejected.
  public shared ({ caller }) func saveRun(run : Types.SavedRun) : async Types.SavedRun {
    if (caller.isAnonymous()) {
      Runtime.trap("saveRun: sign in with Internet Identity to save a run");
    };
    let id = nextRunId.value;
    nextRunId.value := id + 1;
    Runs.save(runs, caller, id, run);
  };

  // List all runs owned by the signed-in caller, most-recent-first. Anonymous
  // callers receive an empty array.
  public shared ({ caller }) func listMyRuns() : async [Types.SavedRun] {
    if (caller.isAnonymous()) { return []; };
    Runs.listForOwner(runs, caller);
  };

  // List lightweight summaries of all runs owned by the signed-in caller,
  // most-recent-first. This is the preferred endpoint for the runs-list view:
  // it returns only row metadata (id, name, when, dataset, pattern count,
  // config summary) without shipping the full patterns and validation arrays
  // for every saved run. Anonymous callers receive an empty array.
  public shared ({ caller }) func listMyRunSummaries() : async [Types.SavedRunSummary] {
    if (caller.isAnonymous()) { return []; };
    Runs.listSummariesForOwner(runs, caller);
  };

  // Load a single run by id. Returns null if the run does not exist or is not
  // owned by the caller.
  public shared ({ caller }) func getMyRun(runId : Nat) : async ?Types.SavedRun {
    if (caller.isAnonymous()) { return null; };
    Runs.getForOwner(runs, caller, runId);
  };

  // Load several runs by id for the compare view. Only runs owned by the caller
  // are returned, in the order requested. Anonymous callers receive an empty
  // array.
  public shared ({ caller }) func getMyRuns(runIds : [Nat]) : async [Types.SavedRun] {
    if (caller.isAnonymous()) { return []; };
    Runs.getManyForOwner(runs, caller, runIds);
  };

  // Delete a run owned by the caller. Returns true if a run was removed.
  public shared ({ caller }) func deleteMyRun(runId : Nat) : async Bool {
    if (caller.isAnonymous()) {
      Runtime.trap("deleteMyRun: sign in with Internet Identity to delete a run");
    };
    Runs.deleteForOwner(runs, caller, runId);
  };
};
