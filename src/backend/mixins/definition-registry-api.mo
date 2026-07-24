// Per-user persistence for reviewed indicator definitions.
//
// The frontend owns the versioned registry schema and sends one JSON document.
// The backend treats that document as opaque data while enforcing ownership:
// only the Internet Identity Principal that saved a registry can read or
// replace it.

import Map "mo:core/Map";
import Principal "mo:core/Principal";

mixin (registries : Map.Map<Principal, Text>) {
  public shared ({ caller }) func saveMyDefinitionRegistry(registryJson : Text) : async Text {
    if (caller.isAnonymous()) {
      Runtime.trap(
        "saveMyDefinitionRegistry: sign in with Internet Identity to save definitions",
      );
    };
    registries.add(caller, registryJson);
    registryJson;
  };

  public shared query ({ caller }) func getMyDefinitionRegistry() : async ?Text {
    if (caller.isAnonymous()) { return null };
    registries.get(caller);
  };

  public shared ({ caller }) func deleteMyDefinitionRegistry() : async Bool {
    if (caller.isAnonymous()) {
      Runtime.trap(
        "deleteMyDefinitionRegistry: sign in with Internet Identity to delete definitions",
      );
    };
    let existed = registries.get(caller) != null;
    if (existed) { registries.remove(caller) };
    existed;
  };
};
