import { describe, expect, it, vi } from "vitest";
import { parseSSE, SSEParseError, SSEParser } from "./sse.ts";

const progress = {
	completedRuns: 2,
	totalRuns: 4,
	fraction: 0.5,
} as const;
const result = {
	config: { runCount: 4, seed: 7 },
	bands: [],
	milestones: {
		finalNetWorthPercentiles: { p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 },
	},
	evaluations: {
		financialIndependence: [],
		netWorthThreshold: [],
		accountBalance: [],
		transactionFulfillment: [],
	},
} as const;

describe("incremental POST-SSE parser", () => {
	it("handles split blocks, retry hints, comments, and typed callbacks", () => {
		const callbacks = {
			onRetry: vi.fn(),
			onComment: vi.fn(),
			onProgress: vi.fn(),
			onPartial: vi.fn(),
			onResult: vi.fn(),
			onError: vi.fn(),
		};
		const parser = new SSEParser(callbacks);
		const first = new TextEncoder().encode(
			': heartbeat\n\nretry: 3000\n\nevent: progress\ndata: {"progress":',
		);
		const second = new TextEncoder().encode(`${JSON.stringify(progress)}}\n\n`);
		const third = new TextEncoder().encode(
			`event: partial\r\ndata: ${JSON.stringify({ progress, partial: result })}\r\n\r\n`,
		);
		const fourth = new TextEncoder().encode(
			`event: result\ndata: ${JSON.stringify({ result })}\n\nevent: error\ndata: {"error":"failed"}\n`,
		);

		expect(parser.feed(first)).toHaveLength(0);
		expect(parser.feed(second)).toHaveLength(1);
		expect(parser.feed(third)).toHaveLength(1);
		expect(parser.feed(fourth)).toHaveLength(1);
		expect(parser.finish()).toHaveLength(1);

		expect(callbacks.onRetry).toHaveBeenCalledWith(3000);
		expect(callbacks.onComment).toHaveBeenCalledWith("heartbeat");
		expect(callbacks.onProgress).toHaveBeenCalledWith({ progress });
		expect(callbacks.onPartial).toHaveBeenCalledWith({
			progress,
			partial: result,
		});
		expect(callbacks.onResult).toHaveBeenCalledWith({ result });
		expect(callbacks.onError).toHaveBeenCalledWith({ error: "failed" });
	});

	it("parses a complete transport-independent SSE string", async () => {
		const onResult = vi.fn();
		const error = await parseSSE(
			`event: result\ndata: ${JSON.stringify({ result })}\n\n`,
			{ onResult },
		);
		expect(error).toBeNull();
		expect(onResult).toHaveBeenCalledWith({ result });
	});

	it("accepts an empty evaluation name from the server contract", async () => {
		const onResult = vi.fn();
		const emptyNameResult = {
			...result,
			evaluations: {
				...result.evaluations,
				netWorthThreshold: [
					{
						instanceId: "target",
						name: "",
						status: "satisfied",
						deterministic: null,
						probabilistic: {},
						diagnostics: [],
					},
				],
			},
		};
		const error = await parseSSE(
			`event: result\ndata: ${JSON.stringify({ result: emptyNameResult })}\n\n`,
			{ onResult },
		);
		expect(error).toBeNull();
		expect(onResult).toHaveBeenCalledWith({ result: emptyNameResult });
	});

	it.each([
		["progress", { progress: { completedRuns: 2, totalRuns: 4 } }],
		["progress", { progress: { ...progress, fraction: "0.5" } }],
		["partial", { progress, partial: { ...result, bands: "invalid" } }],
		["result", { unrelated: true }],
		["result", { result: { ...result, evaluations: {} } }],
		["error", { error: 42 }],
	] as const)(
		"rejects a malformed %s payload before typed callbacks",
		async (eventName, data) => {
			const callbacks = {
				onProgress: vi.fn(),
				onPartial: vi.fn(),
				onResult: vi.fn(),
				onError: vi.fn(),
				onParseError: vi.fn(),
			};
			const error = await parseSSE(
				`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`,
				callbacks,
			);
			expect(error).toBeInstanceOf(SSEParseError);
			expect(callbacks.onParseError).toHaveBeenCalledOnce();
			expect(callbacks.onProgress).not.toHaveBeenCalled();
			expect(callbacks.onPartial).not.toHaveBeenCalled();
			expect(callbacks.onResult).not.toHaveBeenCalled();
			expect(callbacks.onError).not.toHaveBeenCalled();
		},
	);

	it("keeps unknown events available to the raw event callback", async () => {
		const onEvent = vi.fn();
		const error = await parseSSE('event: custom\ndata: {"anything":true}\n\n', {
			onEvent,
		});
		expect(error).toBeNull();
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event: "custom", data: { anything: true } }),
		);
	});

	it("returns a parse error for malformed event JSON", async () => {
		const error = await parseSSE("event: result\ndata: {not-json}\n\n");
		expect(error).toBeInstanceOf(Error);
	});
});
