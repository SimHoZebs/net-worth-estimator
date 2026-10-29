// Casdoor v4.23.0 imports models, roles, adapters, then permissions. See:
// https://github.com/casdoor/casdoor/blob/v4.23.0/object/init_data.go
// https://github.com/casdoor/casdoor/blob/v4.23.0/object/permission_enforcer.go
export const permissionModelId = "waypoint/plan-access";
export const permissionAdapter = "plan-policy-store";
export const planActions = Object.freeze(["plan:read", "plan:project", "plan:write"]);

export const planModelText = `[request_definition]
r = sub, obj, act, owner

[policy_definition]
p = sub, obj, act, eft, unused, permissionId

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = ((p.sub == "waypoint/plan-owner" && r.sub == r.owner && r.sub != "guest") || (p.sub == "waypoint/guest" && r.sub == "guest" && r.obj == "plans/sample") || g(r.sub, p.sub)) && keyMatch(r.obj, p.obj) && r.act == p.act
`;

// Account scope: action strings stay plan:* so the Casdoor model needs no
// migration. Permission resources move from plans/* to accounts/*; the seed
// keeps legacy plans/* until the feat/account-scope-store DB rekey migrates
// old rows. The guest sample stays plans/sample (global read-only).
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
        name: "plan-access",
        displayName: "Waypoint plan access",
        modelText: planModelText,
      },
    ],
    roles: [
      role(
        "plan-owner",
        "Private plan owner",
        "Contextual role: the verified actor owns this private plan. No signup-time role writes.",
      ),
      role(
        "guest",
        "Sample plan guest",
        "Contextual role: an anonymous actor can read and project only the separate sample plan.",
      ),
    ],
    adapters: [
      {
        owner: "waypoint",
        name: permissionAdapter,
        table: "waypoint_plan_permission_rule",
        useSameDb: true,
      },
    ],
    permissions: [
      permission(
        "own-private-plan",
        "Own private account: read, project, write",
        "plan-owner",
        ["accounts/*", "plans/*"],
        [...planActions],
      ),
      permission(
        "guest-sample-plan",
        "Sample plan: guest read and project",
        "guest",
        ["plans/sample"],
        ["plan:read", "plan:project"],
      ),
    ],
  };
}
