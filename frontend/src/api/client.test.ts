import { describe, expect, it, vi } from "vitest";
import {
	ApiClient,
	type ApiClientOptions,
	ApiHttpError,
	ApiNetworkError,
	type FetchLike,
} from "./client.ts";

function response(body: string, init: ResponseInit): Response {
	return new Response(body, init);
}

describe("native API client", () => {
	it("defaults to same-origin /v1 routes, preserves AbortSignal, and sends bearer auth only when supplied per call", async () => {
		const fetcher = vi.fn<FetchLike>(async (_input, init) => {
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer supplied-at-call",
			);
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			return response(JSON.stringify({ readOnly: false, authEnabled: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});
		const options: ApiClientOptions = { baseUrl: "/proxy/", fetch: fetcher };
		const client = new ApiClient(options);
		const controller = new AbortController();
		const result = await client.getStatus({
			authToken: "supplied-at-call",
			signal: controller.signal,
		});

		expect(result).toEqual({ readOnly: false, authEnabled: true });
		expect(fetcher).toHaveBeenCalledWith(
			"/proxy/v1/status",
			expect.objectContaining({ method: "GET", signal: controller.signal }),
		);
	});

	it("binds the native fetch implementation to the global receiver", async () => {
		const originalFetch = globalThis.fetch;
		const receivers: unknown[] = [];
		const nativeFetch = vi.fn(function (this: unknown) {
			receivers.push(this);
			return Promise.resolve(
				response(JSON.stringify({ readOnly: false, authEnabled: false }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			);
		});
		vi.stubGlobal("fetch", nativeFetch);
		try {
			await new ApiClient().getStatus();
			expect(receivers[0]).toBe(globalThis);
		} finally {
			vi.stubGlobal("fetch", originalFetch);
		}
	});

	it("sends the model content identity on conditional writes", async () => {
		const fetcher = vi.fn<FetchLike>(async (_input, init) => {
			expect(new Headers(init?.headers).get("if-match")).toBe(
				'"sha256-revision"',
			);
			return response(
				JSON.stringify({ document: {}, issues: [], revision: '"sha256-next"' }),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		const client = new ApiClient({ fetch: fetcher });
		const result = await client.putModel({} as never, {
			ifMatch: '"sha256-revision"',
		});
		expect(result).toEqual({
			document: {},
			issues: [],
			revision: '"sha256-next"',
		});
	});

	it("parses problem+json errors without exposing a raw body field", async () => {
		const client = new ApiClient({
			fetch: async () =>
				response(
					JSON.stringify({
						title: "Forbidden",
						status: 403,
						detail: "server is read-only",
					}),
					{
						status: 403,
						headers: { "content-type": "application/problem+json" },
					},
				),
		});
		const result = await client.putModel({} as never);

		expect(result).toBeInstanceOf(ApiHttpError);
		if (!(result instanceof ApiHttpError)) return;
		expect(result.status).toBe(403);
		expect(result.problem?.title).toBe("Forbidden");
		expect(result.detail).toBe("server is read-only");
		expect("body" in result).toBe(false);
	});

	it("handles plain-text errors and network failures as Error values", async () => {
		const textClient = new ApiClient({
			fetch: async () =>
				response("service unavailable", {
					status: 503,
					headers: { "content-type": "text/plain" },
				}),
		});
		const textResult = await textClient.getIncomeData();
		expect(textResult).toBeInstanceOf(ApiHttpError);
		if (textResult instanceof ApiHttpError)
			expect(textResult.message).toContain("service unavailable");

		const networkClient = new ApiClient({
			fetch: async () => {
				throw new Error("offline");
			},
		});
		const networkResult = await networkClient.getStatus();
		expect(networkResult).toBeInstanceOf(ApiNetworkError);
	});

	it("requests stochastic projections as POST-SSE and returns the response for the parser", async () => {
		const fetcher = vi.fn<FetchLike>(async (_input, init) => {
			expect(init?.method).toBe("POST");
			expect(new Headers(init?.headers).get("accept")).toBe(
				"text/event-stream",
			);
			return response("event: result\ndata: {}\n\n", {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		});
		const client = new ApiClient({ baseUrl: "/api", fetch: fetcher });
		const result = await client.projectStochastic({
			settings: {
				fallbackProjectionStartDate: "2026-01-01",
				horizonYears: 1,
				evaluations: {
					financialIndependence: [],
					netWorthThreshold: [],
					accountBalance: [],
					postingFulfillment: [],
				},
			},
			config: { runCount: 1, seed: null },
		});
		expect(result).toBeInstanceOf(Response);
		expect(fetcher).toHaveBeenCalledWith(
			"/api/v1/projections/stochastic",
			expect.objectContaining({ method: "POST" }),
		);
	});
});
