import { afterEach, describe, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	getUserScope,
	requireUserRecheck,
	userScopeKey,
	subscribeUserScope,
	suspendUserScope,
} from "./resourceScope.ts";

afterEach(() => suspendUserScope());

const input = {
	apiBaseUrl: "https://plan.example",
	resource: {
		id: "users/private-a",
		kind: "private" as const,
		permissions: ["user:read", "user:write"],
	},
	subject: "user-a",
};

describe("verified user scope", () => {
	it("starts and remains blocked until the current verification accepts a scope", () => {
		const pending = suspendUserScope();
		expect(pending.status).toBe("pending");
		const newer = suspendUserScope();
		expect(acceptUserScope(input, pending)).toBeNull();
		expect(getUserScope()).toBe(newer);
		expect(acceptUserScope(input, newer)?.resource?.id).toBe(input.resource.id);
	});

	it("includes resource, subject, API, and permissions in a stable identity", () => {
		const key = userScopeKey(input);
		expect(
			userScopeKey({
				...input,
				resource: {
					...input.resource,
					permissions: [...input.resource.permissions].reverse(),
				},
			}),
		).toBe(key);
		for (const changed of [
			{ ...input, apiBaseUrl: "https://other.example" },
			{ ...input, subject: "user-b" },
			{ ...input, resource: { ...input.resource, id: "users/private-b" } },
			{
				...input,
				resource: { ...input.resource, permissions: ["user:read"] },
			},
		])
			expect(userScopeKey(changed)).not.toBe(key);
	});

	it("replaces request guards even when the verified identity stays the same", () => {
		const first = acceptUserScope(input, suspendUserScope())!;
		const pending = suspendUserScope();
		const newer = suspendUserScope();
		expect(newer).not.toBe(pending);
		expect(acceptUserScope(input, pending)).toBeNull();
		const second = acceptUserScope(input, newer)!;
		expect(second).not.toBe(first);
		expect(second.key).toBe(first.key);
	});

	it("invalidates captured requests before it requests a session recheck", () => {
		const captured = acceptUserScope(input, suspendUserScope());
		const listener = vi.fn(() => expect(getUserScope().status).toBe("pending"));
		window.addEventListener("waypoint:authentication-required", listener);
		requireUserRecheck();
		expect(getUserScope()).not.toBe(captured);
		expect(listener).toHaveBeenCalledOnce();
		window.removeEventListener("waypoint:authentication-required", listener);
	});

	it("notifies subscribers and removes detached listeners", () => {
		const changed = vi.fn();
		const stop = subscribeUserScope(changed);
		suspendUserScope();
		expect(changed).toHaveBeenCalledOnce();
		stop();
		suspendUserScope();
		expect(changed).toHaveBeenCalledOnce();
	});
});
