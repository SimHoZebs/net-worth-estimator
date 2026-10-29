import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAccount } from "@/api/generated/endpoints.ts";
import { getServerStatus } from "@/api/generated/endpoints.ts";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { resetServerQueryCache } from "@/state/serverQuery.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { useResourceSession } from "@/auth/useResourceSession.ts";

const session = {
	enabled: true,
	authenticated: true,
	allowed: true,
	resource: {
		id: `users/${"a".repeat(64)}`,
		kind: "private",
		permissions: ["user:read", "user:project", "user:write"],
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
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter((call) =>
				String(call[0]).endsWith("/v1/auth/logout"),
			),
		).toHaveLength(1),
	);
});

it("restores requests when resource-change discovery returns to the same user", async () => {
	const fetcher = vi.fn(async (input: RequestInfo | URL) => {
		if (String(input).endsWith("/v1/auth/session")) return response(session);
		if (String(input).endsWith("/v1/accounts"))
			return response({ status: 409, code: "RESOURCE_CHANGED" }, 409);
		return response({ readOnly: false });
	});
	vi.stubGlobal("fetch", fetcher);
	const { result } = renderHook(useResourceSession);
	await waitFor(() => expect(result.current.phase).toBe("ready"));
	const oldScope = getUserScope();
	await act(async () => {
		await expect(createAccount({} as never)).rejects.toBeInstanceOf(
			UserScopeError,
		);
	});
	await waitFor(() => expect(getUserScope().status).toBe("ready"));
	expect(result.current.phase).toBe("ready");
	expect(getUserScope()).not.toBe(oldScope);
	expect(getUserScope().resource?.id).toBe(session.resource.id);
	expect((await getServerStatus()).data).toEqual({
		readOnly: false,
	});
	expect(fetcher).toHaveBeenCalledTimes(6);
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
	expect(result.current.error).toBe(
		"The Waypoint server is unavailable (HTTP 503). It may be restarting; retry shortly.",
	);
	expect(result.current.logoutPending).toBe(false);
	expect(getUserScope().status).toBe("pending");
	discovery = new Response(
		JSON.stringify({
			...session,
			authenticated: false,
			resource: {
				id: "users/sample",
				kind: "sample",
				permissions: ["user:read", "user:project"],
			},
			user: undefined,
		}),
		{ headers: { "Waypoint-Resource": "users/sample" } },
	);
	await act(async () => result.current.refresh());
	expect(result.current.phase).toBe("ready");
	expect(result.current.session?.authenticated).toBe(false);
	expect(getUserScope().resource?.id).toBe("users/sample");
});

it("names an unreachable server instead of reporting a generic status failure", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw new TypeError("Failed to fetch");
		}),
	);
	const { result } = renderHook(useResourceSession);
	await waitFor(() => expect(result.current.phase).toBe("unavailable"));
	expect(result.current.session).toBeNull();
	expect(result.current.error).toBe(
		"Cannot reach the Waypoint server. It may be down or restarting.",
	);
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
	await waitFor(() =>
		expect(
			fetcher.mock.calls.filter((call) =>
				String(call[0]).endsWith("/v1/auth/logout"),
			),
		).toHaveLength(1),
	);
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
	const pending = getUserScope();
	await act(async () => finish(response(session)));
	expect(getUserScope()).toBe(pending);
	expect(getUserScope().status).toBe("pending");
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
	const verified = getUserScope();
	await act(async () => {
		finish({ logoutURL: "#stale-logout" });
		await logout;
	});
	expect(window.location.hash).toBe("");
	expect(current.result.current.phase).toBe("ready");
	expect(getUserScope()).toBe(verified);
});
