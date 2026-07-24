import Map "mo:core/Map";
import Principal "mo:core/Principal";

module {
  // Previous stable signature (from 20260723_213116.mo's NewActor).
  type UserRole = { #admin; #user; #guest };

  type AccessControlState = {
    var adminAssigned : Bool;
    userRoles : Map.Map<Principal, UserRole>;
  };

  type OldActor = {
    var accessControlState : AccessControlState;
  };

  // Inlined SavedRun shape (mirrors types/runs.mo). The migration file must
  // be self-contained — no project imports — so the persisted record type is
  // duplicated here. Keep this in sync with types/runs.mo.
  type Pattern = {
    id : Text;
    name : Text;
    winRate : Float;
    mfeMaeRatio : Float;
    coverage : Float;
    plainEnglishSentence : Text;
  };

  type ValidationResult = {
    inSampleWinRate : Float;
    outOfSampleWinRate : Float;
    byMarketCondition : [(Text, Float)];
  };

  type DiscoveryConfig = {
    horizon : Nat;
    mfeMaeWindow : Nat;
    minMfeMaeRatio : Float;
    mfeMaeRatioEnabled : Bool;
    maxDepth : Nat;
    minSampleSize : Nat;
    minWinRate : Float;
  };

  type DatasetRef = {
    id : Text;
    name : Text;
  };

  type Report = {
    summary : Text;
    generatedAtNs : Int;
  };

  type SavedRun = {
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

  // New stable signature: adds the per-user saved-runs store and a monotonic
  // run-id counter. Both are initialized empty/zero on fresh install and on
  // upgrade from the previous version (no existing runs to carry over).
  //
  // Field mutability matches main.mo: all three are `let` bindings there, so
  // NewActor uses non-var fields. `nextRunId` is a `let` binding to a record
  // with a `var value` field (the wrapper that lets mixins mutate the counter
  // by reference), so its NewActor entry is the record type itself.
  type NewActor = {
    accessControlState : AccessControlState;
    runs : Map.Map<Principal, Map.Map<Nat, SavedRun>>;
    nextRunId : { var value : Nat };
  };

  public func migration(old : OldActor) : NewActor {
    {
      accessControlState = old.accessControlState;
      runs = Map.empty();
      nextRunId = { var value = 0 };
    };
  };
};
