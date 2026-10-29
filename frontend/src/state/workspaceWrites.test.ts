// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import { stubTestServer } from "../mocks/waypointServer.ts";
import { resetServerQueryCache } from "./serverQuery.ts";
import { resetWorkspaceStore } from "./workspaceStore.ts";
import { performSave } from "./workspaceWrites.ts";

function owner() {
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: "users/a",
				kind: "private",
				permissions: ["user:read", "user:write"],
			},
			subject: "users/a",
		},
		suspendUserScope(),
	);
}

beforeEach(() => {
	owner();
	resetWorkspaceStore();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

afterEach(() => {
	resetWorkspaceStore();
	resetServerQueryCache();
	suspendUserScope();
	vi.unstubAllGlobals();
});

it("runs the call and refreshes on success", async () => {
	stubTestServer();
	const call = vi.fn(async () => ({
		data: { persisted: true, issues: [] },
	}));
	const refresh = vi.fn(async () => {});
	expect(await performSave({ call, refresh, failureMessage: "Nope." })).toBe(
		true,
	);
	expect(call).toHaveBeenCalledTimes(1);
	expect(refresh).toHaveBeenCalledTimes(1);
});

it("reports a server rejection without refreshing", async () => {
	stubTestServer();
	const call = vi.fn(async () => ({
		data: {
			persisted: false,
			issues: [{ severity: "error", message: "Choose an account." }],
		},
	}));
	const refresh = vi.fn(async () => {});
	expect(await performSave({ call, refresh, failureMessage: "Nope." })).toBe(
		false,
	);
	expect(refresh).not.toHaveBeenCalled();
});

it("reports a thrown failure without refreshing", async () => {
	stubTestServer();
	const refresh = vi.fn(async () => {});
	expect(
		await performSave({
			call: async () => {
				throw new Error("boom");
			},
			refresh,
			failureMessage: "Nope.",
		}),
	).toBe(false);
	expect(refresh).not.toHaveBeenCalled();
});

it("refuses saves before the workspace is ready", async () => {
	stubTestServer();
	suspendUserScope();
	const call = vi.fn(async () => ({ data: { persisted: true } }));
	const refresh = vi.fn(async () => {});
	expect(await performSave({ call, refresh, failureMessage: "Nope." })).toBe(
		false,
	);
	expect(call).not.toHaveBeenCalled();
	expect(refresh).not.toHaveBeenCalled();
});
