import Map "mo:core/Map";
import Principal "mo:core/Principal";

module {
  type UserRole = { #admin; #user; #guest };

  type AccessControlState = {
    var adminAssigned : Bool;
    userRoles : Map.Map<Principal, UserRole>;
  };

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

  type OldActor = {
    accessControlState : AccessControlState;
    runs : Map.Map<Principal, Map.Map<Nat, SavedRun>>;
    nextRunId : { var value : Nat };
  };

  type NewActor = {
    accessControlState : AccessControlState;
    runs : Map.Map<Principal, Map.Map<Nat, SavedRun>>;
    nextRunId : { var value : Nat };
    definitionRegistries : Map.Map<Principal, Text>;
  };

  public func migration(old : OldActor) : NewActor {
    {
      accessControlState = old.accessControlState;
      runs = old.runs;
      nextRunId = old.nextRunId;
      definitionRegistries = Map.empty();
    };
  };
};
