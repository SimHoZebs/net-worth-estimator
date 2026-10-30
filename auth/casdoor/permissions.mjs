// Casdoor v4.23.0 imports models, roles, adapters, then permissions. See:
// https://github.com/casdoor/casdoor/blob/v4.23.0/object/init_data.go
// https://github.com/casdoor/casdoor/blob/v4.23.0/object/permission_enforcer.go
export const permissionModelId = "waypoint/user-access";
export const permissionAdapter = "user-policy-store";
export const userActions = Object.freeze(["user:read", "user:project", "user:write"]);

// Five-field bridge: r.sub is the provider owner/name resolved per request
// through GET /api/get-user?owner=waypoint&userId=<verified immutable subject>.
// r.actor and r.owner are the same stable app hash of issuer+subject, both
// server-derived, never browser input. Group memberships assigned at creation
// (application defaultGroup, seeded users) resolve through g(r.sub, p.sub).
// No contextual owner/guest grant arms: cross-user requests fail on
// r.actor == r.owner, and actions follow the member/viewer roles only.
export const userModelText = `[request_definition]
r = sub, obj, act, owner, actor

[policy_definition]
p = sub, obj, act, eft, unused, permissionId

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = g(r.sub, p.sub) && r.actor == r.owner && keyMatch(r.obj, p.obj) && r.act == p.act
`;

// User scope: action strings are user:* under waypoint/user-access.
// Permission resources are users/* for every scope. The r.actor == r.owner
// matcher arm confines each request to the caller's own user resource, so one
// generic resource pattern serves members and viewers. Creation-time group
// memberships (application defaultGroup, seeded users) attach the roles:
// waypoint/members grants all user actions, waypoint/viewers grants read and
// project. Signup needs no role choice and no per-request grant reapplication.
export function buildPermissionSeed() {
  const role = (name, displayName, description, groups) => ({
    owner: "waypoint",
    name,
    displayName,
    description,
    users: [],
    groups,
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
  // Groups back the creation-time role memberships. Users join them at
  // creation (application defaultGroup, seeded users); roles point at them.
  // The permission apply flow manages these groups add-only on sealed state,
  // under the same preview/approve/drift discipline as models, roles,
  // adapters, and permissions.
  const group = (name, displayName) => ({
    owner: "waypoint",
    name,
    displayName,
    isTopGroup: true,
    isEnabled: true,
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
        "member",
        "Private user member",
        "Creation-time role: members of waypoint/members own their private user. Assigned through provider groups, never per-request writes.",
        ["waypoint/members"],
      ),
      role(
        "viewer",
        "Provisioned guest viewer",
        "Creation-time role: members of waypoint/viewers read and project their own scope. The anonymous guest resolves to one such provisioned account.",
        ["waypoint/viewers"],
      ),
    ],
    groups: [group("members", "Members"), group("viewers", "Viewers")],
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
        "member-private-user",
        "Member private user: read, project, write",
        "member",
        ["users/*"],
        [...userActions],
      ),
      permission(
        "viewer-guest-user",
        "Viewer guest scope: read and project",
        "viewer",
        ["users/*"],
        ["user:read", "user:project"],
      ),
    ],
  };
}
