import { afterEach, describe, expect, it, vi } from "vitest";
import {
	acceptAccountScope,
	getAccountScope,
	requireAccountRecheck,
	accountScopeKey,
	subscribeAccountScope,
	suspendAccountScope,
} from "./resourceScope.ts";

afterEach(() => suspendAccountScope());

const input = {
	apiBaseUrl: "https://plan.example",
	resource: {
		id: "accounts/private-a",
		kind: "private" as const,
		permissions: ["account:read", "account:write"],
	},
	subject: "account-a",
};

describe("verified account scope", () => {
	it("starts and remains blocked until the current verification accepts a scope", () => {
		const pending = suspendAccountScope();
		expect(pending.status).toBe("pending");
		const newer = suspendAccountScope();
		expect(acceptAccountScope(input, pending)).toBeNull();
		expect(getAccountScope()).toBe(newer);
		expect(acceptAccountScope(input, newer)?.resource?.id).toBe(
			input.resource.id,
		);
	});

	it("includes resource, subject, API, and permissions in a stable identity", () => {
		const key = accountScopeKey(input);
		expect(
			accountScopeKey({
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
			{ ...input, resource: { ...input.resource, id: "accounts/private-b" } },
			{ ...input, resource: { ...input.resource, permissions: ["account:read"] } },
		])
			expect(accountScopeKey(changed)).not.toBe(key);
	});

	it("replaces request guards even when the verified identity stays the same", () => {
		const first = acceptAccountScope(input, suspendAccountScope())!;
		const pending = suspendAccountScope();
		const newer = suspendAccountScope();
		expect(newer).not.toBe(pending);
		expect(acceptAccountScope(input, pending)).toBeNull();
		const second = acceptAccountScope(input, newer)!;
		expect(second).not.toBe(first);
		expect(second.key).toBe(first.key);
	});

	it("invalidates captured requests before it requests a session recheck", () => {
		const captured = acceptAccountScope(input, suspendAccountScope());
		const listener = vi.fn(() =>
			expect(getAccountScope().status).toBe("pending"),
		);
		window.addEventListener("waypoint:authentication-required", listener);
		requireAccountRecheck();
		expect(getAccountScope()).not.toBe(captured);
		expect(listener).toHaveBeenCalledOnce();
		window.removeEventListener("waypoint:authentication-required", listener);
	});

	it("notifies subscribers and removes detached listeners", () => {
		const changed = vi.fn();
		const stop = subscribeAccountScope(changed);
		suspendAccountScope();
		expect(changed).toHaveBeenCalledOnce();
		stop();
		suspendAccountScope();
		expect(changed).toHaveBeenCalledOnce();
	});
});
