import { afterEach, describe, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	getResourceScope,
	requireSessionRecheck,
	resourceScopeKey,
	subscribeResourceScope,
	suspendResourceScope,
} from "./resourceScope.ts";

afterEach(() => suspendResourceScope());

const input = {
	apiBaseUrl: "https://plan.example",
	resource: {
		id: "plans/private-a",
		kind: "private" as const,
		permissions: ["plan:read", "plan:write"],
	},
	subject: "account-a",
};

describe("verified resource scope", () => {
	it("starts and remains blocked until the current verification accepts a scope", () => {
		const pending = suspendResourceScope();
		expect(pending.status).toBe("pending");
		const newer = suspendResourceScope();
		expect(acceptResourceScope(input, pending)).toBeNull();
		expect(getResourceScope()).toBe(newer);
		expect(acceptResourceScope(input, newer)?.resource?.id).toBe(
			input.resource.id,
		);
	});

	it("includes resource, subject, API, and permissions in a stable identity", () => {
		const key = resourceScopeKey(input);
		expect(
			resourceScopeKey({
				...input,
				resource: {
					...input.resource,
					permissions: [...input.resource.permissions].reverse(),
				},
			}),
		).toBe(key);
		for (const changed of [
			{ ...input, apiBaseUrl: "https://other.example" },
			{ ...input, subject: "account-b" },
			{ ...input, resource: { ...input.resource, id: "plans/private-b" } },
			{ ...input, resource: { ...input.resource, permissions: ["plan:read"] } },
		])
			expect(resourceScopeKey(changed)).not.toBe(key);
	});

	it("invalidates captured requests before it requests a session recheck", () => {
		const captured = acceptResourceScope(input, suspendResourceScope());
		const listener = vi.fn(() =>
			expect(getResourceScope().status).toBe("pending"),
		);
		window.addEventListener("waypoint:authentication-required", listener);
		requireSessionRecheck();
		expect(getResourceScope()).not.toBe(captured);
		expect(listener).toHaveBeenCalledOnce();
		window.removeEventListener("waypoint:authentication-required", listener);
	});

	it("notifies subscribers and removes detached listeners", () => {
		const changed = vi.fn();
		const stop = subscribeResourceScope(changed);
		suspendResourceScope();
		expect(changed).toHaveBeenCalledOnce();
		stop();
		suspendResourceScope();
		expect(changed).toHaveBeenCalledOnce();
	});
});
