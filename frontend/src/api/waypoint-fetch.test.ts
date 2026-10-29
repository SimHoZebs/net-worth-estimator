import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	canonicalApiBaseUrl,
	suspendResourceScope,
} from "@/auth/resourceScope.ts";
import { ApiHttpError, ApiNetworkError } from "@/api/http.ts";
import { ResourceScopeError } from "@/api/scopedRequest.ts";
import { waypointBlobFetch, waypointFetch } from "@/api/waypoint-fetch.ts";
import {
	attachReceipt,
	replaceReceiptImage,
} from "@/api/generated/endpoints.ts";

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

it("uses the scoped binary transport for private receipt pixels", async () => {
	const fetcher = vi.fn(
		async (_url: unknown, _options?: RequestInit) =>
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "Content-Type": "image/png", "Waypoint-Resource": A },
			}),
	);
	vi.stubGlobal("fetch", fetcher);
	const result = await waypointBlobFetch<{ data: Blob }>(
		"/v1/receipts/example/image",
	);
	expect(result.data.type).toBe("image/png");
	expect([...new Uint8Array(await result.data.arrayBuffer())]).toEqual([
		1, 2, 3,
	]);
	expect(
		new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Waypoint-Resource"),
	).toBe(A);
});

it("generates a real file part and a scalar posting ID for receipt uploads", async () => {
	const seen: RequestInit[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: unknown, options?: RequestInit) => {
			seen.push(options ?? {});
			return response({ receipt: { id: "receipt" }, diagnostics: [] });
		}),
	);
	const image = new File(["pixels"], "receipt.png", { type: "image/png" });
	await attachReceipt({ image, postingId: "posting" });
	const data = seen[0]?.body as FormData;
	expect(data.get("postingId")).toBe("posting");
	expect(data.get("image")).toBeInstanceOf(File);
	expect(new Headers(seen[0]?.headers).has("Content-Type")).toBe(false);
});

it("sends a replacement image with its scalar conflict revision", async () => {
	const seen: RequestInit[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: unknown, options?: RequestInit) => {
			seen.push(options ?? {});
			return response({ receipt: { id: "receipt" }, diagnostics: [] });
		}),
	);
	await replaceReceiptImage("receipt", {
		image: new File(["pixels"], "new.png", { type: "image/png" }),
		revision: 4,
	});
	expect(seen[0]?.method).toBe("PUT");
	const data = seen[0]?.body as FormData;
	expect(data.get("revision")).toBe("4");
	expect(data.get("image")).toBeInstanceOf(File);
	expect(new Headers(seen[0]?.headers).has("Content-Type")).toBe(false);
});

it("does not expose binary receipt content after a resource change", async () => {
	const fetcher = vi.fn(async () => {
		suspendResourceScope();
		return new Response("private", { headers: { "Waypoint-Resource": A } });
	});
	vi.stubGlobal("fetch", fetcher);
	await expect(
		waypointBlobFetch("/v1/receipts/example/image"),
	).rejects.toBeInstanceOf(ResourceScopeError);
});

it("refuses generated requests without a verified account", async () => {
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
