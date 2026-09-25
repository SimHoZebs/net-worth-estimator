import { describe, expect, it, vi } from "vitest";
import { parseSSE, SSEParser } from "./sse.ts";

const progress = {
	phase: "stochastic-runs",
	completedRuns: 2,
	totalRuns: 4,
	fraction: 0.5,
	evaluationWorkloads: [],
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
		postingFulfillment: [],
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

	it("returns a parse error for malformed event JSON", async () => {
		const error = await parseSSE("event: result\ndata: {not-json}\n\n");
		expect(error).toBeInstanceOf(Error);
		expect(error?.message).toContain("invalid server-sent event");
	});
});
