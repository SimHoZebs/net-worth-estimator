import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { makeSettings } from "@/lib/projection/__fixtures__/settings";
import type {
	ProjectionRequest,
	StochasticRequest,
} from "@/lib/projection/runtime/ProjectionEngine";
import { BackendProjectionEngine } from "./BackendProjectionEngine";

afterEach(() => {
	vi.unstubAllGlobals();
});

function sseResponse(chunks: string[], status = 200): Response {
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
				controller.close();
			},
		}),
		{
			status,
			headers: { "Content-Type": "text/event-stream" },
		},
	);
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function stubFetch(impl: (input: unknown, init?: RequestInit) => unknown) {
	return vi.stubGlobal(
		"fetch",
		vi.fn(async (...args: unknown[]) => impl(args[0], args[1] as RequestInit)),
	);
}

function firstFetchCall(
	fetchMock: ReturnType<typeof vi.fn>,
): [string, RequestInit] {
	const call = fetchMock.mock.calls[0] as unknown as
		| [string, RequestInit]
		| undefined;
	if (!call) throw new Error("Expected fetch to have been called.");
	return call;
}

const baseRequest: ProjectionRequest = {
	document: createBaseDocument(),
	projectionSettings: makeSettings(),
};

const stochasticRequest: StochasticRequest = {
	...baseRequest,
	config: { runCount: 50, seed: 42 },
};

const progressEvent = (progress: unknown) =>
	`event: progress\ndata: ${JSON.stringify({ progress })}\n\n`;
const partialEvent = (progress: unknown, partial: unknown) =>
	`event: partial\ndata: ${JSON.stringify({ progress, partial })}\n\n`;
const resultEvent = (result: unknown) =>
	`event: result\ndata: ${JSON.stringify({ result })}\n\n`;

describe("project", () => {
	it("posts the request body and returns the result", async () => {
		const result = { timeline: "ok" };
		const fetchMock = vi.fn(async () => jsonResponse({ result }));
		stubFetch(fetchMock);

		await expect(
			new BackendProjectionEngine().project(baseRequest),
		).resolves.toEqual(result);
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = firstFetchCall(fetchMock);
		expect(url).toBe("/v1/projections/deterministic");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body as string)).toEqual({
			document: baseRequest.document,
			incomeData: undefined,
			settings: baseRequest.projectionSettings,
		});
	});

	it("throws the backend error payload", async () => {
		stubFetch(async () => jsonResponse({ error: "bad horizon" }));
		await expect(
			new BackendProjectionEngine().project(baseRequest),
		).rejects.toThrow("bad horizon");
	});

	it("throws when the backend returns no result", async () => {
		stubFetch(async () => jsonResponse({}));
		await expect(
			new BackendProjectionEngine().project(baseRequest),
		).rejects.toThrow("Backend returned no projection result.");
	});

	it("throws the status when a failed response has no error payload", async () => {
		stubFetch(async () => jsonResponse({}, 500));
		await expect(
			new BackendProjectionEngine().project(baseRequest),
		).rejects.toThrow("Backend request failed (500).");
	});
});

describe("projectStochastic", () => {
	it("delivers progress, partials, and the final result across chunk splits", async () => {
		const progress = { completedRuns: 25, totalRuns: 50 };
		const partial = { marker: "partial" };
		const final = { marker: "final" };
		const seen: Array<{ progress: unknown; partial?: unknown }> = [];
		stubFetch(async () =>
			sseResponse([
				// First event split mid-name across chunks; two events in one chunk.
				"event: prog",
				`ress\ndata: ${JSON.stringify({ progress })}\n\n${partialEvent(progress, partial)}`,
				"event: result\n",
				`data: ${JSON.stringify({ result: final })}\n\n`,
			]),
		);

		const engine = new BackendProjectionEngine();
		await expect(
			engine.projectStochastic(
				stochasticRequest,
				(progressUpdate, partialUpdate) => {
					seen.push({ progress: progressUpdate, partial: partialUpdate });
				},
			),
		).resolves.toEqual(final);
		expect(seen).toEqual([
			{ progress, partial: undefined },
			{ progress, partial },
		]);
	});

	it("sends the stochastic config in the request body", async () => {
		const fetchMock = vi.fn(async () =>
			sseResponse([resultEvent({ marker: "final" })]),
		);
		stubFetch(fetchMock);

		await new BackendProjectionEngine().projectStochastic(stochasticRequest);
		const [url, init] = firstFetchCall(fetchMock);
		expect(url).toBe("/v1/projections/stochastic");
		expect(JSON.parse(init.body as string).config).toEqual({
			runCount: 50,
			seed: 42,
		});
	});

	it("joins multi-line data payloads and skips malformed JSON", async () => {
		const final = { marker: "final" };
		const seen: unknown[] = [];
		stubFetch(async () =>
			sseResponse([
				`event: progress\ndata: {"progress":\ndata: {"completedRuns": 1}}\n\n`,
				`event: progress\ndata: not-json\n\n${resultEvent(final)}`,
			]),
		);

		await expect(
			new BackendProjectionEngine().projectStochastic(
				stochasticRequest,
				(progress) => {
					seen.push(progress);
				},
			),
		).resolves.toEqual(final);
		expect(seen).toEqual([{ completedRuns: 1 }]);
	});

	it("ignores heartbeats, retry hints, and event IDs", async () => {
		const final = { marker: "final" };
		const seen: unknown[] = [];
		stubFetch(async () =>
			sseResponse([
				`retry: 3000\n\n: heartbeat\n\n${progressEvent({ completedRuns: 1 })}`,
				`id: 1\n${resultEvent(final)}`,
			]),
		);

		await expect(
			new BackendProjectionEngine().projectStochastic(
				stochasticRequest,
				(progress) => {
					seen.push(progress);
				},
			),
		).resolves.toEqual(final);
		expect(seen).toEqual([{ completedRuns: 1 }]);
	});

	it("reconnects a truncated stream and preserves earlier progress", async () => {
		const progress = { completedRuns: 25, totalRuns: 50 };
		const final = { marker: "final" };
		const seen: Array<{ progress: unknown; partial?: unknown }> = [];
		const fetchMock = vi.fn(async () => sseResponse([progressEvent(progress)]));
		fetchMock.mockImplementationOnce(async () =>
			sseResponse([progressEvent(progress)]),
		);
		fetchMock.mockImplementationOnce(async () =>
			sseResponse([resultEvent(final)]),
		);
		stubFetch(fetchMock);

		await expect(
			new BackendProjectionEngine().projectStochastic(
				stochasticRequest,
				(progressUpdate, partialUpdate) => {
					seen.push({ progress: progressUpdate, partial: partialUpdate });
				},
			),
		).resolves.toEqual(final);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(seen).toEqual([{ progress, partial: undefined }]);
	});

	it("does not reconnect terminal stream errors", async () => {
		const fetchMock = vi.fn(async () =>
			sseResponse([
				`event: error\ndata: ${JSON.stringify({ error: "sampling failed" })}\n\n`,
			]),
		);
		stubFetch(fetchMock);

		await expect(
			new BackendProjectionEngine().projectStochastic(stochasticRequest),
		).rejects.toThrow("sampling failed");
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("does not reconnect HTTP 4xx failures", async () => {
		const fetchMock = vi.fn(
			async () => new Response("bad request", { status: 400 }),
		);
		stubFetch(fetchMock);

		await expect(
			new BackendProjectionEngine().projectStochastic(stochasticRequest),
		).rejects.toThrow("bad request");
		expect(fetchMock).toHaveBeenCalledOnce();
	});
	it("throws when the stream ends without a result", async () => {
		stubFetch(async () => sseResponse([progressEvent({})]));
		await expect(
			new BackendProjectionEngine().projectStochastic(stochasticRequest),
		).rejects.toThrow("Stochastic stream ended without a result.");
	});

	it("throws the response detail on HTTP failure", async () => {
		stubFetch(async () => new Response("overloaded", { status: 503 }));
		await expect(
			new BackendProjectionEngine().projectStochastic(stochasticRequest),
		).rejects.toThrow("overloaded");
	});

	it("throws the status when a failed response has no detail", async () => {
		stubFetch(async () => new Response("", { status: 500 }));
		await expect(
			new BackendProjectionEngine().projectStochastic(stochasticRequest),
		).rejects.toThrow("Stochastic stream failed (500).");
	});

	it("rejects an already-aborted request without calling fetch", async () => {
		const controller = new AbortController();
		controller.abort();
		const fetchMock = vi.fn(async () => sseResponse([]));
		stubFetch(fetchMock);

		const error = await new BackendProjectionEngine()
			.projectStochastic({ ...stochasticRequest, signal: controller.signal })
			.catch((err: unknown) => err);
		expect(error).toBeInstanceOf(DOMException);
		expect((error as DOMException).name).toBe("AbortError");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("links the outer abort signal to the fetch request", async () => {
		const controller = new AbortController();
		let fetchSignal: AbortSignal | undefined;
		stubFetch(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					fetchSignal = init?.signal ?? undefined;
					fetchSignal?.addEventListener("abort", () => {
						reject(new DOMException("Aborted", "AbortError"));
					});
				}),
		);

		const pending = new BackendProjectionEngine().projectStochastic({
			...stochasticRequest,
			signal: controller.signal,
		});
		controller.abort();
		const timeout = new Promise<never>((_resolve, reject) => {
			setTimeout(() => reject(new Error("Timed out waiting for abort.")), 1000);
		});
		const error = await Promise.race([pending, timeout]).catch(
			(err: unknown) => err,
		);
		expect(fetchSignal?.aborted).toBe(true);
		expect(error).toBeInstanceOf(DOMException);
		expect((error as DOMException).name).toBe("AbortError");
	});
});
