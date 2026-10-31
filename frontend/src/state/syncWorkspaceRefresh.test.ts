import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ServerStatus } from "../api/index.ts";
import { acceptOwnerResource, acceptTestResource } from "../mocks/resource.ts";
import { stubTestServer } from "../mocks/waypointServer.ts";
import { setServerStatusFixture } from "../mocks/workspace.ts";
import { getUserScope } from "../auth/resourceScope.ts";
import {
	deterministicQueryKey,
	resetServerQueryCache,
	serverQueryClient,
} from "./serverQuery.ts";
import {
	getAppliedSyncStamp,
	markSyncApplied,
	refreshWorkspaceAfterSync,
	resetSyncWorkspaceRefresh,
} from "./syncWorkspaceRefresh.ts";

const status: ServerStatus = {
	readOnly: false,
	syncConfigured: true,
	syncQuotaUsed: 5,
	syncQuotaLimit: 24,
};

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
	resetSyncWorkspaceRefresh();
	vi.unstubAllGlobals();
});

afterEach(() => {
	resetServerQueryCache();
	resetSyncWorkspaceRefresh();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("refreshes the workspace and marks the stamp applied", async () => {
	const server = stubTestServer();
	server.setStatus({ ...status, lastSyncAt: "after" });
	// The manual sync's status refresh landed first, as in triggerSyncNow.
	setServerStatusFixture({ ...status, lastSyncAt: "after" });
	const key = deterministicQueryKey("model", 10);
	serverQueryClient().setQueryData(key, "result");
	expect(await refreshWorkspaceAfterSync()).toBe(true);
	expect(server.modelFetches()).toHaveLength(1);
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(true);
	expect(getAppliedSyncStamp(getUserScope())).toBe("after");
});

it("applies the refresh even when the status cache already moved", async () => {
	const server = stubTestServer();
	server.setStatus({ ...status, lastSyncAt: "after" });
	// The manual sync's status refresh landed first, so the shared cache
	// already shows the new stamp while the workspace is still behind.
	setServerStatusFixture({ ...status, lastSyncAt: "after" });
	markSyncApplied(getUserScope(), "before");
	expect(await refreshWorkspaceAfterSync()).toBe(true);
	expect(server.modelFetches()).toHaveLength(1);
	expect(getAppliedSyncStamp(getUserScope())).toBe("after");
});

it("leaves the stamp unapplied when the model reload fails", async () => {
	const server = stubTestServer();
	server.setStatus({ ...status, lastSyncAt: "after" });
	markSyncApplied(getUserScope(), "before");
	const key = deterministicQueryKey("model", 10);
	serverQueryClient().setQueryData(key, "result");
	server.failModelOnce(new Error("boom"));
	expect(await refreshWorkspaceAfterSync()).toBe(false);
	expect(server.modelFetches()).toHaveLength(1);
	expect(getAppliedSyncStamp(getUserScope())).toBe("before");
	expect(serverQueryClient().getQueryState(key)?.isInvalidated).toBe(false);
});

it("ignores a stale scope after a user switch", async () => {
	const server = stubTestServer();
	const scope = getUserScope();
	acceptOwnerResource(`users/${"d".repeat(64)}`);
	await refreshWorkspaceAfterSync(scope);
	expect(server.modelFetches()).toHaveLength(0);
	expect(
		server.calls.filter((call) => call.url.endsWith("/v1/status")),
	).toHaveLength(0);
	expect(server.calls).toHaveLength(0);
});
