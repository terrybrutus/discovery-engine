// Domain types for saved discovery runs.
//
// A saved run captures the full output of one discovery execution so it can be
// reloaded and compared later by the signed-in user who produced it. All fields
// are shared (serializable) so a SavedRun can travel through Candid unchanged.

module {
  // A single discovered pattern, persisted verbatim from the client engine.
  // Mirrors the frontend Pattern shape's persisted subset; kept flat (primitives
  // + arrays of primitives) so it is Candid-shared and OQL-auto-derivable.
  public type Pattern = {
    id : Text;
    name : Text;
    winRate : Float;
    mfeMaeRatio : Float;
    coverage : Float;
    plainEnglishSentence : Text;
  };

  // Validation results for a run's top patterns. Stored as a flat summary so
  // the compare view can diff in-sample vs out-of-sample performance.
  public type ValidationResult = {
    inSampleWinRate : Float;
    outOfSampleWinRate : Float;
    byMarketCondition : [(Text, Float)];
  };

  // The discovery configuration that produced this run. Flat primitives so it
  // is directly diffable in the compare view.
  public type DiscoveryConfig = {
    horizon : Nat;
    mfeMaeWindow : Nat;
    minMfeMaeRatio : Float;
    mfeMaeRatioEnabled : Bool;
    maxDepth : Nat;
    minSampleSize : Nat;
    minWinRate : Float;
  };

  // Identifies which dataset(s) the run was executed against.
  public type DatasetRef = {
    id : Text;
    name : Text;
  };

  // The generated textual report for the run.
  public type Report = {
    summary : Text;
    generatedAtNs : Int;
  };

  // A complete saved discovery run. `owner` is the Principal who saved it and
  // is the OQL owner column for per-user scoping.
  public type SavedRun = {
    id : Nat;
    owner : Principal;
    name : Text;
    savedAtNs : Int;
    config : DiscoveryConfig;
    datasets : [DatasetRef];
    patterns : [Pattern];
    validation : ValidationResult;
    report : Report;
  };

  // Lightweight projection of a SavedRun for the runs-list view. Carries only
  // the fields the list needs to render a row (name, when, dataset, pattern
  // count, and a one-line config summary) without shipping the full patterns
  // and validation arrays over the wire for every saved run.
  public type SavedRunSummary = {
    id : Nat;
    name : Text;
    savedAtNs : Int;
    datasetName : Text;
    patternCount : Nat;
    configSummary : Text;
  };
};
