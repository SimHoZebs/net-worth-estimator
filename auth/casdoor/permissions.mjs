// Casdoor v4.23.0 imports models, roles, adapters, then permissions. See:
// https://github.com/casdoor/casdoor/blob/v4.23.0/object/init_data.go
// https://github.com/casdoor/casdoor/blob/v4.23.0/object/permission_enforcer.go
export const permissionModelId = "waypoint/user-access";
export const permissionAdapter = "user-policy-store";
export const userActions = Object.freeze(["user:read", "user:project", "user:write"]);

export const userModelText = `[request_definition]
r = sub, obj, act, owner

[policy_definition]
p = sub, obj, act, eft, unused, permissionId

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = ((p.sub == "waypoint/user-owner" && r.sub == r.owner && r.sub != "guest") || (p.sub == "waypoint/guest" && r.sub == "guest" && r.obj == "users/sample") || g(r.sub, p.sub)) && keyMatch(r.obj, p.obj) && r.act == p.act
`;

// User scope: action strings are user:* under waypoint/user-access.
// Permission resources are users/* only, including the guest sample
// users/sample (global read-only).
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
        name: "user-access",
        displayName: "Waypoint user access",
        modelText: userModelText,
      },
    ],
    roles: [
      role(
        "user-owner",
        "Private user owner",
        "Contextual role: the verified actor owns this private user. No signup-time role writes.",
      ),
      role(
        "guest",
        "Sample user guest",
        "Contextual role: an anonymous actor can read and project only the separate sample user.",
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
        "own-private-user",
        "Own private user: read, project, write",
        "user-owner",
        ["users/*"],
        [...userActions],
      ),
      permission(
        "guest-sample-user",
        "Sample user: guest read and project",
        "guest",
        ["users/sample"],
        ["user:read", "user:project"],
      ),
    ],
  };
}
