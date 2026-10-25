import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.ts";
import { ResourceScopeError } from "../api/scopedRequest.ts";
import { resetServerQueryCache } from "../state/serverQuery.ts";
import { getResourceScope } from "./resourceScope.ts";
import { useResourceSession } from "./useResourceSession.ts";

const session = {
	enabled: true,
	authenticated: true,
	allowed: true,
	resource: {
		id: `plans/${"a".repeat(64)}`,
		kind: "private",
		permissions: ["plan:read", "plan:project", "plan:write"],
	},
	user: { subject: "account-a", name: "Account A" },
};

function response(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
			"Waypoint-Resource": session.resource.id,
		},
	});
}

beforeEach(() => {
	vi.stubGlobal("BroadcastChannel", undefined);
	vi.spyOn(ApiClient.prototype, "getSafeSpendingSettings").mockResolvedValue({
		settings: null,
	});
});
afterEach(() => {
	cleanup();
	resetServerQueryCache();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	window.history.replaceState(null, "", "/");
});

it("keeps failed logout after a discovery outage closed without an implicit retry", async () => {
	let offline = false;
	const fetcher = vi.fn(async (input: RequestInfo | URL) =>
		String(input).endsWith("/v1/auth/logout") || offline
			? response({}, 503)
			: response(session),
	);
	vi.stubGlobal("fetch", fetcher);
	const { result } = renderHook(useResourceSession);
	await waitFor(() => expect(result.current.phase).toBe("ready"));
	offline = true;
	await act(async () => result.current.refresh());
	expect(result.current.phase).toBe("unavailable");
	await act(async () => result.current.logout());
	expect(result.current.phase).toBe("unavailable");
	expect(result.current.error).toBe("Sign-out failed. Please retry.");
	expect(fetcher).toHaveBeenCalledTimes(3);
});

it("restores requests when resource-change discovery returns to the same plan", async () => {
	const fetcher = vi.fn(async (input: RequestInfo | URL) => {
		if (String(input).endsWith("/v1/auth/session")) return response(session);
		if (String(input).endsWith("/v1/accounts"))
			return response({ status: 409, code: "RESOURCE_CHANGED" }, 409);
		return response({ readOnly: false });
	});
	vi.stubGlobal("fetch", fetcher);
	const { result } = renderHook(useResourceSession);
	await waitFor(() => expect(result.current.phase).toBe("ready"));
	const oldScope = getResourceScope();
	const oldClient = new ApiClient();
	await act(async () => {
		expect(await oldClient.createAccount({} as never)).toBeInstanceOf(
			ResourceScopeError,
		);
	});
	await waitFor(() => expect(getResourceScope().status).toBe("ready"));
	expect(result.current.phase).toBe("ready");
	expect(getResourceScope()).not.toBe(oldScope);
	expect(getResourceScope().resource?.id).toBe(session.resource.id);
	expect(await new ApiClient().getStatus()).toEqual({ readOnly: false });
	expect(await oldClient.getStatus()).toBeInstanceOf(ResourceScopeError);
	expect(fetcher).toHaveBeenCalledTimes(4);
});

it("blocks an unverified logout redirect and recovers to the guest through an explicit check", async () => {
	let finish: (value: { logoutURL: string }) => void = () => {};
	const body = new Promise<{ logoutURL: string }>((resolve) => {
		finish = resolve;
	});
	const logoutResponse = response({});
	vi.spyOn(logoutResponse, "json").mockImplementation(() => body);
	let discovery = response(session);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) =>
			String(input).endsWith("/v1/auth/logout")
				? logoutResponse
				: discovery.clone(),
		),
	);
	const { result } = renderHook(useResourceSession);
	await waitFor(() => expect(result.current.phase).toBe("ready"));
	let logout: Promise<void>;
	act(() => {
		logout = result.current.logout();
	});
	await waitFor(() => expect(logoutResponse.json).toHaveBeenCalledOnce());
	discovery = response({}, 503);
	await act(async () => result.current.refresh());
	await act(async () => {
		finish({ logoutURL: "#unverified-logout" });
		await logout;
	});
	expect(window.location.hash).toBe("");
	expect(result.current.phase).toBe("unavailable");
	expect(result.current.error).toBe("Authentication status is unavailable.");
	expect(result.current.logoutPending).toBe(false);
	expect(getResourceScope().status).toBe("pending");
	discovery = new Response(
		JSON.stringify({
			...session,
			authenticated: false,
			resource: {
				id: "plans/sample",
				kind: "sample",
				permissions: ["plan:read", "plan:project"],
			},
			user: undefined,
		}),
		{ headers: { "Waypoint-Resource": "plans/sample" } },
	);
	await act(async () => result.current.refresh());
	expect(result.current.phase).toBe("ready");
	expect(result.current.session?.authenticated).toBe(false);
	expect(getResourceScope().resource?.id).toBe("plans/sample");
});

it("rejects duplicate logout calls before React renders the pending state", async () => {
	let finish: (value: Response) => void = () => {};
	const fetcher = vi.fn(async (input: RequestInfo | URL) =>
		String(input).endsWith("/v1/auth/logout")
			? new Promise<Response>((resolve) => {
					finish = resolve;
				})
			: response(session),
	);
	vi.stubGlobal("fetch", fetcher);
	const { result } = renderHook(useResourceSession);
	await waitFor(() => expect(result.current.phase).toBe("ready"));
	let logout: Promise<void>;
	act(() => {
		logout = result.current.logout();
		void result.current.logout();
	});
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(result.current.logoutPending).toBe(true);
	await act(async () => {
		finish(response({ logoutURL: "#signed-out" }));
		await logout;
	});
	expect(window.location.hash).toBe("#signed-out");
});

it("aborts discovery and rejects a late response after unmount", async () => {
	let finish: (value: Response) => void = () => {};
	const fetcher = vi.fn(
		(_input: RequestInfo | URL, _init?: RequestInit) =>
			new Promise<Response>((resolve) => {
				finish = resolve;
			}),
	);
	vi.stubGlobal("fetch", fetcher);
	const view = renderHook(useResourceSession);
	await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
	const signal = fetcher.mock.calls[0]![1]?.signal;
	view.unmount();
	expect(signal?.aborted).toBe(true);
	const pending = getResourceScope();
	await act(async () => finish(response(session)));
	expect(getResourceScope()).toBe(pending);
	expect(getResourceScope().status).toBe("pending");
});

it("rejects an old logout redirect after the boundary unmounts and mounts again", async () => {
	let finish: (value: { logoutURL: string }) => void = () => {};
	const body = new Promise<{ logoutURL: string }>((resolve) => {
		finish = resolve;
	});
	const logoutResponse = response({});
	vi.spyOn(logoutResponse, "json").mockImplementation(() => body);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) =>
			String(input).endsWith("/v1/auth/logout")
				? logoutResponse
				: response(session),
		),
	);
	const old = renderHook(useResourceSession);
	await waitFor(() => expect(old.result.current.phase).toBe("ready"));
	let logout: Promise<void>;
	act(() => {
		logout = old.result.current.logout();
	});
	await waitFor(() => expect(logoutResponse.json).toHaveBeenCalledOnce());
	old.unmount();
	const current = renderHook(useResourceSession);
	await waitFor(() => expect(current.result.current.phase).toBe("ready"));
	const verified = getResourceScope();
	await act(async () => {
		finish({ logoutURL: "#stale-logout" });
		await logout;
	});
	expect(window.location.hash).toBe("");
	expect(current.result.current.phase).toBe("ready");
	expect(getResourceScope()).toBe(verified);
});
