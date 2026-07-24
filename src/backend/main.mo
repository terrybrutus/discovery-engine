import AccessControl "mo:caffeineai-authorization/access-control";
import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import OQL "mo:caffeineai-oql";
import Expose "mo:caffeineai-oql/Expose";
import Entity "mo:caffeineai-oql/Entity";
import _TextValue "mo:caffeineai-oql/TextValue";
import _RecordValue "mo:caffeineai-oql/RecordValue";
import _NatValue "mo:caffeineai-oql/NatValue";
import _IntValue "mo:caffeineai-oql/IntValue";
import _PrincipalValue "mo:caffeineai-oql/PrincipalValue";
import _FloatValue "mo:caffeineai-oql/FloatValue";
import _BoolValue "mo:caffeineai-oql/BoolValue";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Principal "mo:core/Principal";

import RunsTypes "types/runs";
import RunsLib "lib/runs";
import RunsApi "mixins/runs-api";
import DefinitionRegistryApi "mixins/definition-registry-api";

actor {
  let accessControlState : AccessControl.AccessControlState;

  // Per-user saved discovery runs. Outer map keyed by owner Principal; inner
  // map keyed by run id for O(log n) lookup. Initialized empty by the
  // migration chain.
  let runs : RunsLib.RunStore;

  // Monotonic counter for run ids across all users. Initialized to 0 by the
  // migration chain.
  let nextRunId : { var value : Nat };

  include MixinAuthorization(accessControlState, null);
  include RunsApi(runs, nextRunId);

  // The user's reviewed indicator definitions, serialized as the versioned
  // registry JSON used by the frontend. Keeping one document per Principal
  // makes synchronization atomic and keeps definitions private by default.
  let definitionRegistries : Map.Map<Principal, Text>;
  include DefinitionRegistryApi(definitionRegistries);

  // Render a UserRole variant as its textual tag so it can travel through
  // OQL's scalar Value (which has no variant arm).
  func roleToText(role : AccessControl.UserRole) : Text = switch role {
    case (#admin) "admin";
    case (#user)  "user";
    case (#guest) "guest";
  };

  include Expose({
    entities = [
      // Persisted user-to-role mapping — admin data, controller-only.
      Entity.manual<(Principal, AccessControl.UserRole)>(
        "userRole",
        func () = accessControlState.userRoles.entries(),
        "UserRoleEntry",
        "user",
      )
        .payload(
          "user",
          func ((principal, _role) : (Principal, AccessControl.UserRole)) : Text =
            principal.toText(),
        )
        .payload(
          "role",
          func ((_principal, role) : (Principal, AccessControl.UserRole)) : Text =
            roleToText(role),
        )
        .controllerOnly()
        .build(),

      // Saved discovery runs. Each signed-in user reads only their own runs
      // (scopedPerUser); the Data Intelligence agent is also scoped, so it
      // answers only over the caller's own runs. Entity.manual's iterator
      // takes no arguments (the ?Principal-scoped form is only valid for
      // Entity.newScoped), so we flatten the whole Map<Principal,
      // Map<Nat, SavedRun>> store into a single Iter<SavedRun> and rely on
      // .ownedBy('owner') + .scopedPerUser() for per-user row filtering at
      // query time. SavedRun has array-of-record ([DatasetRef],
      // [Pattern]) and array-of-tuple (validation.byMarketCondition :
      // [(Text, Float)]) fields for which no OQL converter exists, so we
      // project scalars explicitly and flatten the all-primitive config and
      // report sub-records.
      Entity.manual<RunsTypes.SavedRun>(
        "savedRun",
        func () : Iter.Iter<RunsTypes.SavedRun> =
          Iter.flatten(
            runs.entries().map(
              func ((_, inner) : (Principal, Map.Map<Nat, RunsTypes.SavedRun>))
                : Iter.Iter<RunsTypes.SavedRun> =
                inner.values(),
            ),
          ),
        "SavedRun",
        "user",
      )
        .payload("id", func (r : RunsTypes.SavedRun) : Nat = r.id)
        .payload("owner", func (r : RunsTypes.SavedRun) : Principal = r.owner)
        .payload("name", func (r : RunsTypes.SavedRun) : Text = r.name)
        .payload("savedAtNs", func (r : RunsTypes.SavedRun) : Int = r.savedAtNs)
        .flatten(
          func (r : RunsTypes.SavedRun) : RunsTypes.DiscoveryConfig = r.config,
        )
        .flatten(func (r : RunsTypes.SavedRun) : RunsTypes.Report = r.report)
        .payload(
          "inSampleWinRate",
          func (r : RunsTypes.SavedRun) : Float = r.validation.inSampleWinRate,
        )
        .payload(
          "outOfSampleWinRate",
          func (r : RunsTypes.SavedRun) : Float =
            r.validation.outOfSampleWinRate,
        )
        .payload(
          "datasetCount",
          func (r : RunsTypes.SavedRun) : Nat = r.datasets.size(),
        )
        .payload(
          "patternCount",
          func (r : RunsTypes.SavedRun) : Nat = r.patterns.size(),
        )
        .ownedBy("owner")
        .scopedPerUser()
        .build(),
    ];
  });
};
