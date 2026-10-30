// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	getUserScope,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import { ApiHttpError } from "../api/http.ts";
import { stubTestServer } from "../mocks/waypointServer.ts";
import { resetNotifications, useNotifications } from "./notifications.ts";
import { resetServerQueryCache, serverQueryClient } from "./serverQuery.ts";
import { useUserReadOnly } from "./useUserScope.ts";
import {
	reloadWorkspace,
	userResourceKey,
	workspaceIsBusy,
} from "./workspaceResources.ts";
import {
	performSave,
	useWorkspaceSaving,
	useWorkspaceWriteError,
} from "./workspaceWrites.ts";

function owner() {
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: "users/a",
				permissions: ["user:read", "user:write"],
			},
			subject: "users/a",
		},
		suspendUserScope(),
	);
}

function toasts() {
	return useNotifications.getState().items;
}

beforeEach(() => {
	owner();
	resetNotifications();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

afterEach(() => {
	resetNotifications();
	resetServerQueryCache();
	suspendUserScope();
	vi.unstubAllGlobals();
});

it("runs the call, refreshes, and confirms with the shared success notice", async () => {
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
	expect(toasts()).toContainEqual(
		expect.objectContaining({
			kind: "success",
			key: "workspace-notice",
			message: "Changes saved.",
		}),
	);
});

it("reloads authoritative state on a rejection, then reports it", async () => {
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
	expect(refresh).toHaveBeenCalledTimes(1);
	expect(toasts()).toContainEqual(
		expect.objectContaining({ kind: "error", message: "Choose an account." }),
	);
	expect(toasts()).not.toContainEqual(
		expect.objectContaining({ kind: "success" }),
	);
});

it("reloads authoritative state on a transport failure, then reports it", async () => {
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
	expect(refresh).toHaveBeenCalledTimes(1);
	expect(toasts()).toContainEqual(
		expect.objectContaining({ kind: "error", message: "boom" }),
	);
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

it("stays silent without refresh when the resource switches during the call", async () => {
	stubTestServer();
	const refresh = vi.fn(async () => {});
	const result = await performSave({
		call: async () => {
			suspendUserScope();
			return { data: { persisted: true, issues: [] } };
		},
		refresh,
		failureMessage: "Nope.",
	});
	expect(result).toBe(false);
	expect(refresh).not.toHaveBeenCalled();
	expect(toasts()).toEqual([]);
});

it("reports a saved-but-unconfirmed state when the reload fails", async () => {
	stubTestServer();
	const refresh = vi.fn(async () => {
		throw new Error("reload failed");
	});
	const result = await performSave({
		call: async () => ({ data: { persisted: true, issues: [] } }),
		refresh,
		failureMessage: "Nope.",
	});
	expect(result).toBe(false);
	expect(toasts()).toContainEqual(
		expect.objectContaining({
			kind: "error",
			message:
				"The change was saved, but the latest server data could not be reloaded. Retry the server request.",
		}),
	);
	expect(toasts()).not.toContainEqual(
		expect.objectContaining({ kind: "success" }),
	);
});

it("stays silent without success when the resource switches during refresh", async () => {
	stubTestServer();
	const refresh = vi.fn(async () => {
		suspendUserScope();
	});
	const result = await performSave({
		call: async () => ({ data: { persisted: true, issues: [] } }),
		refresh,
		failureMessage: "Nope.",
	});
	expect(result).toBe(false);
	expect(toasts()).toEqual([]);
});

it("runs one save at a time and exposes the active save to observers", async () => {
	stubTestServer();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const call = vi.fn(async () => {
		await gate;
		return { data: { persisted: true, issues: [] } };
	});
	const refresh = vi.fn(async () => {});
	const saving = renderHook(() => useWorkspaceSaving());
	const first = performSave({ call, refresh, failureMessage: "Nope." });
	const second = performSave({ call, refresh, failureMessage: "Nope." });
	await expect(second).resolves.toBe(false);
	expect(call).toHaveBeenCalledTimes(1);
	expect(workspaceIsBusy()).toBe(true);
	await waitFor(() => expect(saving.result.current).toBe(true));
	release();
	await expect(first).resolves.toBe(true);
	expect(refresh).toHaveBeenCalledTimes(1);
	expect(workspaceIsBusy()).toBe(false);
	await waitFor(() => expect(saving.result.current).toBe(false));
});

it("records a 403 write error as read-only until reload", async () => {
	stubTestServer();
	const scope = getUserScope();
	serverQueryClient().setQueryData(userResourceKey("status", scope), {
		readOnly: false,
	});
	const readOnly = renderHook(() => useUserReadOnly());
	const writeError = renderHook(() => useWorkspaceWriteError());
	expect(readOnly.result.current).toBe(false);
	const result = await performSave({
		call: async () => {
			throw new ApiHttpError({ status: 403, message: "Forbidden" });
		},
		refresh: vi.fn(async () => {}),
		failureMessage: "Nope.",
	});
	expect(result).toBe(false);
	await waitFor(() =>
		expect(writeError.result.current).toMatchObject({ status: 403 }),
	);
	await waitFor(() => expect(readOnly.result.current).toBe(true));
	await reloadWorkspace();
	await waitFor(() => expect(writeError.result.current).toBeNull());
	await waitFor(() => expect(readOnly.result.current).toBe(false));
});
