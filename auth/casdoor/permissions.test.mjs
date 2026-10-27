import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPermissionSeed,
  permissionAdapter,
  permissionModelId,
  planActions,
  planModelText,
} from "./permissions.mjs";

test("permission seed is deterministic, independently mutable, and uses one dedicated same-DB adapter", () => {
  const seed = buildPermissionSeed();
  assert.deepEqual(seed, buildPermissionSeed());
  assert.deepEqual(Object.keys(seed).sort(), ["adapters", "models", "permissions", "roles"]);
  assert.deepEqual(seed.adapters, [
    {
      owner: "waypoint",
      name: permissionAdapter,
      table: "waypoint_plan_permission_rule",
      useSameDb: true,
    },
  ]);
  assert.equal(seed.models[0].modelText, planModelText);
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
  assert.deepEqual(buildPermissionSeed().permissions[0].actions, planActions);
});

test("contextual role grants need no per-account signup writes", () => {
  const { roles, permissions } = buildPermissionSeed();
  assert.deepEqual(
    roles.map(({ name }) => name),
    ["plan-owner", "guest"],
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
        roles: ["waypoint/plan-owner"],
        resources: ["plans/*"],
        actions: ["plan:read", "plan:project", "plan:write"],
      },
      {
        roles: ["waypoint/guest"],
        resources: ["plans/sample"],
        actions: ["plan:read", "plan:project"],
      },
    ],
  );
});

test("model declares the pinned Casdoor six-column policy contract and native role support", () => {
  // These assert the exported artifact, not a handwritten policy evaluator.
  assert.match(planModelText, /^r = sub, obj, act, owner$/m);
  assert.match(planModelText, /^p = sub, obj, act, eft, unused, permissionId$/m);
  assert.match(planModelText, /^g = _, _$/m);
  assert.match(
    planModelText,
    /^e = some\(where \(p.eft == allow\)\) && !some\(where \(p.eft == deny\)\)$/m,
  );
  assert.ok(
    planModelText.includes(
      'p.sub == "waypoint/plan-owner" && r.sub == r.owner && r.sub != "guest"',
    ),
  );
  assert.ok(
    planModelText.includes(
      'p.sub == "waypoint/guest" && r.sub == "guest" && r.obj == "plans/sample"',
    ),
  );
  assert.ok(planModelText.includes("|| g(r.sub, p.sub)"));
  assert.ok(planModelText.includes("keyMatch(r.obj, p.obj) && r.act == p.act"));
});
