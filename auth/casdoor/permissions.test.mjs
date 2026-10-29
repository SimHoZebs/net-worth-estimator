import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPermissionSeed,
  permissionAdapter,
  permissionModelId,
  accountActions,
  accountModelText,
} from "./permissions.mjs";

test("permission seed is deterministic, independently mutable, and uses one dedicated same-DB adapter", () => {
  const seed = buildPermissionSeed();
  assert.deepEqual(seed, buildPermissionSeed());
  assert.deepEqual(Object.keys(seed).sort(), ["adapters", "models", "permissions", "roles"]);
  assert.deepEqual(seed.adapters, [
    {
      owner: "waypoint",
      name: permissionAdapter,
      table: "waypoint_account_permission_rule",
      useSameDb: true,
    },
  ]);
  assert.equal(seed.models[0].modelText, accountModelText);
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
  assert.deepEqual(buildPermissionSeed().permissions[0].actions, accountActions);
});

test("contextual role grants need no per-account signup writes", () => {
  const { roles, permissions } = buildPermissionSeed();
  assert.deepEqual(
    roles.map(({ name }) => name),
    ["account-owner", "guest"],
  );
  for (const role of roles) {
    assert.equal(role.owner, "waypoint");
    assert.deepEqual(role.users, []);
    assert.deepEqual(role.groups, []);
    assert.deepEqual(role.roles, []);
  }
  assert.deepEqual(
    permissions.map(({ roles, resources, actions }) => ({ roles, resources, actions })),
    [
      {
        roles: ["waypoint/account-owner"],
        resources: ["accounts/*"],
        actions: ["account:read", "account:project", "account:write"],
      },
      {
        roles: ["waypoint/guest"],
        resources: ["accounts/sample"],
        actions: ["account:read", "account:project"],
      },
    ],
  );
});

test("model declares the pinned Casdoor six-column policy contract and native role support", () => {
  // These assert the exported artifact, not a handwritten policy evaluator.
  assert.match(accountModelText, /^r = sub, obj, act, owner$/m);
  assert.match(accountModelText, /^p = sub, obj, act, eft, unused, permissionId$/m);
  assert.match(accountModelText, /^g = _, _$/m);
  assert.match(
    accountModelText,
    /^e = some\(where \(p.eft == allow\)\) && !some\(where \(p.eft == deny\)\)$/m,
  );
  assert.ok(
    accountModelText.includes(
      'p.sub == "waypoint/account-owner" && r.sub == r.owner && r.sub != "guest"',
    ),
  );
  assert.ok(
    accountModelText.includes(
      'p.sub == "waypoint/guest" && r.sub == "guest" && r.obj == "accounts/sample"',
    ),
  );
  assert.ok(accountModelText.includes("|| g(r.sub, p.sub)"));
  assert.ok(accountModelText.includes("keyMatch(r.obj, p.obj) && r.act == p.act"));
});
