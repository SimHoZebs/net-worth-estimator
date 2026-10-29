// Casdoor v4.23.0 imports models, roles, adapters, then permissions. See:
// https://github.com/casdoor/casdoor/blob/v4.23.0/object/init_data.go
// https://github.com/casdoor/casdoor/blob/v4.23.0/object/permission_enforcer.go
export const permissionModelId = "waypoint/account-access";
export const permissionAdapter = "account-policy-store";
export const accountActions = Object.freeze(["account:read", "account:project", "account:write"]);

export const accountModelText = `[request_definition]
r = sub, obj, act, owner

[policy_definition]
p = sub, obj, act, eft, unused, permissionId

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = ((p.sub == "waypoint/account-owner" && r.sub == r.owner && r.sub != "guest") || (p.sub == "waypoint/guest" && r.sub == "guest" && r.obj == "accounts/sample") || g(r.sub, p.sub)) && keyMatch(r.obj, p.obj) && r.act == p.act
`;

// Account scope: action strings are account:* under waypoint/account-access.
// Permission resources are accounts/* only, including the guest sample
// accounts/sample (global read-only).
export function buildPermissionSeed() {
  const role = (name, displayName, description) => ({
    owner: "waypoint",
    name,
    displayName,
    description,
    users: [],
    groups: [],
    roles: [],
    domains: [],
    isEnabled: true,
  });
  const permission = (name, displayName, roleName, resources, actions) => ({
    owner: "waypoint",
    name,
    displayName,
    description: displayName,
    users: [],
    groups: [],
    roles: [`waypoint/${roleName}`],
    domains: [],
    model: permissionModelId,
    // Permission.Adapter is a local name, unlike Enforcer.Adapter's full ID.
    adapter: permissionAdapter,
    resourceType: "Custom",
    resources,
    actions,
    effect: "Allow",
    isEnabled: true,
    expireTime: "",
    state: "Approved",
  });
  return {
    models: [
      {
        owner: "waypoint",
        name: "account-access",
        displayName: "Waypoint account access",
        modelText: accountModelText,
      },
    ],
    roles: [
      role(
        "account-owner",
        "Private account owner",
        "Contextual role: the verified actor owns this private account. No signup-time role writes.",
      ),
      role(
        "guest",
        "Sample account guest",
        "Contextual role: an anonymous actor can read and project only the separate sample account.",
      ),
    ],
    adapters: [
      {
        owner: "waypoint",
        name: permissionAdapter,
        table: "waypoint_account_permission_rule",
        useSameDb: true,
      },
    ],
    permissions: [
      permission(
        "own-private-account",
        "Own private account: read, project, write",
        "account-owner",
        ["accounts/*"],
        [...accountActions],
      ),
      permission(
        "guest-sample-account",
        "Sample account: guest read and project",
        "guest",
        ["accounts/sample"],
        ["account:read", "account:project"],
      ),
    ],
  };
}
