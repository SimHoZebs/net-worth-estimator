import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	canonicalApiBaseUrl,
	suspendResourceScope,
} from "@/auth/resourceScope.ts";
import { ApiHttpError, ApiNetworkError } from "@/api/http.ts";
import { ResourceScopeError } from "@/api/scopedRequest.ts";
import { waypointFetch } from "@/api/waypoint-fetch.ts";

const A = `plans/${"a".repeat(64)}`;

function owner() {
	return acceptResourceScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: A,
				kind: "private",
				permissions: ["plan:read", "plan:project", "plan:write"],
			},
			subject: A,
		},
		suspendResourceScope(),
	)!;
}

function response(body: unknown, status = 200, resource: string | null = A) {
	const headers = new Headers({ "content-type": "application/json" });
	if (resource) headers.set("Waypoint-Resource", resource);
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
		headers,
	});
}

beforeEach(() => {
	owner();
});
afterEach(() => {
	suspendResourceScope();
	vi.unstubAllGlobals();
});

it("sends the verified scope header and parses JSON", async () => {
	const seen: { url: unknown; init: RequestInit | undefined }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			seen.push({ url, init });
			return response({ readOnly: false });
		}),
	);
	const result = await waypointFetch<{
		data: { readOnly: boolean };
		status: number;
	}>("/v1/status", {
		method: "GET",
	});
	expect(result.data).toEqual({ readOnly: false });
	expect(result.status).toBe(200);
	expect(seen).toHaveLength(1);
	const request = seen[0];
	expect(String(request?.url)).toBe("/v1/status");
	expect(new Headers(request?.init?.headers).get("Waypoint-Resource")).toBe(A);
	expect(request?.init?.credentials).toBe("same-origin");
});

it("refuses generated requests without a verified workspace", async () => {
	suspendResourceScope();
	const fetcher = vi.fn(async () => response({}));
	vi.stubGlobal("fetch", fetcher);
	await expect(waypointFetch("/v1/status")).rejects.toBeInstanceOf(
		ResourceScopeError,
	);
	expect(fetcher).not.toHaveBeenCalled();
});

it("maps service outages to API errors", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => response({ title: "Service Unavailable" }, 503)),
	);
	const failure = await waypointFetch("/v1/status").catch(
		(cause: unknown) => cause,
	);
	expect(failure).toBeInstanceOf(ApiHttpError);
	expect(failure).toMatchObject({ status: 503 });
});

it("treats a resource change as a scope error", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			response({ code: "RESOURCE_CHANGED", title: "Changed" }, 409),
		),
	);
	await expect(waypointFetch("/v1/status")).rejects.toBeInstanceOf(
		ResourceScopeError,
	);
});

it("prefixes generated requests with a non-root API base", async () => {
	const base = canonicalApiBaseUrl("/proxy");
	window.__WAYPOINT_CONFIG__ = { apiBaseUrl: base };
	try {
		acceptResourceScope(
			{
				apiBaseUrl: base,
				resource: {
					id: A,
					kind: "private",
					permissions: ["plan:read", "plan:project", "plan:write"],
				},
				subject: A,
			},
			suspendResourceScope(),
		);
		const seen: { url: unknown; init: RequestInit | undefined }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown, init?: RequestInit) => {
				seen.push({ url, init });
				return response({ readOnly: false });
			}),
		);
		const result = await waypointFetch<{
			data: { readOnly: boolean };
			status: number;
		}>("/v1/status", {
			method: "GET",
		});
		expect(result.data).toEqual({ readOnly: false });
		expect(String(seen[0]?.url)).toBe(`${base}/v1/status`);
		expect(new Headers(seen[0]?.init?.headers).get("Waypoint-Resource")).toBe(
			A,
		);
	} finally {
		delete window.__WAYPOINT_CONFIG__;
	}
});

it("propagates transport failures", async () => {
	const transport = new TypeError("Failed to fetch");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw transport;
		}),
	);
	const failure = await waypointFetch("/v1/status").catch(
		(cause: unknown) => cause,
	);
	expect(failure).toBeInstanceOf(ApiNetworkError);
	expect((failure as Error).cause).toBe(transport);
});

it("maps a truncated response body to a network error", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new TypeError("socket hang up"));
						},
					}),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
							"Waypoint-Resource": A,
						},
					},
				),
		),
	);
	const failure = await waypointFetch("/v1/status").catch(
		(cause: unknown) => cause,
	);
	expect(failure).toBeInstanceOf(ApiNetworkError);
	expect((failure as Error).cause).toBeInstanceOf(TypeError);
});
