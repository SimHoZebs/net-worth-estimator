import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPermissionSeed,
  permissionAdapter,
  permissionModelId,
  userActions,
  userModelText,
} from "./permissions.mjs";

test("permission seed is deterministic, independently mutable, and uses one dedicated same-DB adapter", () => {
  const seed = buildPermissionSeed();
  assert.deepEqual(seed, buildPermissionSeed());
  assert.deepEqual(Object.keys(seed).sort(), ["adapters", "groups", "models", "permissions", "roles"]);
  assert.deepEqual(seed.adapters, [
    {
      owner: "waypoint",
      name: permissionAdapter,
      table: "waypoint_account_permission_rule",
      useSameDb: true,
    },
  ]);
  assert.equal(seed.models[0].modelText, userModelText);
  assert.equal(`${seed.models[0].owner}/${seed.models[0].name}`, permissionModelId);
  for (const permission of seed.permissions) {
    assert.equal(permission.model, permissionModelId);
    assert.equal(permission.adapter, permissionAdapter);
    assert.equal(permission.resourceType, "Custom");
    assert.equal(permission.effect, "Allow");
    assert.equal(permission.isEnabled, true);
    assert.equal(permission.state, "Approved");
    assert.deepEqual(permission.users, []);
    assert.deepEqual(permission.groups, []);
    assert.deepEqual(permission.domains, []);
  }
  seed.permissions[0].actions.push("unexpected");
  assert.deepEqual(buildPermissionSeed().permissions[0].actions, userActions);
});

test("creation-time group roles grant actions with no per-request writes", () => {
  const { roles, permissions } = buildPermissionSeed();
  assert.deepEqual(
    roles.map(({ name }) => name),
    ["member", "viewer"],
  );
  for (const role of roles) {
    assert.equal(role.owner, "waypoint");
    assert.deepEqual(role.users, []);
    assert.deepEqual(role.roles, []);
  }
  assert.deepEqual(
    roles.map(({ groups }) => groups),
    [["waypoint/members"], ["waypoint/viewers"]],
  );
  assert.deepEqual(
    permissions.map(({ roles, resources, actions }) => ({ roles, resources, actions })),
    [
      {
        roles: ["waypoint/member"],
        resources: ["users/*"],
        actions: ["user:read", "user:project", "user:write"],
      },
      {
        roles: ["waypoint/viewer"],
        resources: ["users/*"],
        actions: ["user:read", "user:project"],
      },
    ],
  );
});

test("creation-time groups back the role memberships", () => {
  const { groups } = buildPermissionSeed();
  assert.deepEqual(
    groups.map(({ owner, name }) => `${owner}/${name}`),
    ["waypoint/members", "waypoint/viewers"],
  );
  for (const group of groups) {
    assert.equal(group.owner, "waypoint");
    assert.equal(group.isTopGroup, true);
    assert.equal(group.isEnabled, true);
    assert.ok(group.displayName.length > 0);
  }
  assert.deepEqual(buildPermissionSeed().groups, groups);
});

test("model declares the five-field bridge with group resolution and owner confinement", () => {
  // These assert the exported artifact, not a handwritten policy evaluator.
  assert.match(userModelText, /^r = sub, obj, act, owner, actor$/m);
  assert.match(userModelText, /^p = sub, obj, act, eft, unused, permissionId$/m);
  assert.match(userModelText, /^g = _, _$/m);
  assert.match(
    userModelText,
    /^e = some\(where \(p.eft == allow\)\) && !some\(where \(p.eft == deny\)\)$/m,
  );
  assert.ok(
    userModelText.includes(
      "m = g(r.sub, p.sub) && r.actor == r.owner && keyMatch(r.obj, p.obj) && r.act == p.act",
    ),
  );
  assert.doesNotMatch(userModelText, /user-owner/);
  assert.doesNotMatch(userModelText, /users\/sample/);
  assert.doesNotMatch(userModelText, /"guest"/);
});
