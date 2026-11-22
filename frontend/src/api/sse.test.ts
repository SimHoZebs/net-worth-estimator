import { describe, expect, it, vi } from "vitest";
import { parseSSE, SSEParseError, SSEParser } from "./sse.ts";

const progress = {
	phase: "stochastic-runs",
	completedRuns: 2,
	totalRuns: 4,
	fraction: 0.5,
	evaluationWorkloads: [],
} as const;
const result = {
	config: { runCount: 4, seed: 7 },
	bands: [
		{
			date: "2026-02-01",
			isHistorical: false,
			netWorth: { p10: 1, p25: 2, p50: 3, p75: 4, p90: 5 },
		},
	],
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

	it("returns a parse error for malformed event JSON", async () => {
		const error = await parseSSE("event: result\ndata: {not-json}\n\n");
		expect(error).toBeInstanceOf(Error);
	});
});

function eventStream(name: string, data: unknown): string {
	return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("SSE payload shape validation", () => {
	const typedCallbacks = () => ({
		onProgress: vi.fn(),
		onPartial: vi.fn(),
		onResult: vi.fn(),
		onError: vi.fn(),
		onParseError: vi.fn(),
	});

	it("rejects a progress event whose fraction field was renamed", async () => {
		const callbacks = typedCallbacks();
		const error = await parseSSE(
			eventStream("progress", {
				progress: {
					phase: "stochastic-runs",
					completedRuns: 2,
					totalRuns: 4,
					fractionRenamed: 0.5,
					evaluationWorkloads: [],
				},
			}),
			callbacks,
		);

		expect(error).toBeInstanceOf(SSEParseError);
		expect(callbacks.onParseError).toHaveBeenCalledOnce();
		expect(callbacks.onProgress).not.toHaveBeenCalled();
	});

	it("rejects a partial event with a malformed result payload", async () => {
		const callbacks = typedCallbacks();
		const error = await parseSSE(
			eventStream("partial", { progress, partial: { unexpected: true } }),
			callbacks,
		);

		expect(error).toBeInstanceOf(SSEParseError);
		expect(callbacks.onParseError).toHaveBeenCalledOnce();
		expect(callbacks.onPartial).not.toHaveBeenCalled();
	});

	it("rejects a result event that only carries an unrelated field", async () => {
		const callbacks = typedCallbacks();
		const error = await parseSSE(
			eventStream("result", { somethingElse: true }),
			callbacks,
		);

		expect(error).toBeInstanceOf(SSEParseError);
		expect(callbacks.onParseError).toHaveBeenCalledOnce();
		expect(callbacks.onResult).not.toHaveBeenCalled();
	});

	it("rejects a result event with a band missing netWorth", async () => {
		const callbacks = typedCallbacks();
		const error = await parseSSE(
			eventStream("result", {
				result: {
					...result,
					bands: [{ date: "2026-02-01", isHistorical: false }],
				},
			}),
			callbacks,
		);

		expect(error).toBeInstanceOf(SSEParseError);
		expect(callbacks.onParseError).toHaveBeenCalledOnce();
		expect(callbacks.onResult).not.toHaveBeenCalled();
	});

	it("rejects a result event missing an evaluation table", async () => {
		const callbacks = typedCallbacks();
		const error = await parseSSE(
			eventStream("result", {
				result: {
					...result,
					evaluations: {
						financialIndependence: [],
						netWorthThreshold: [],
						transactionFulfillment: [],
					},
				},
			}),
			callbacks,
		);

		expect(error).toBeInstanceOf(SSEParseError);
		expect(callbacks.onParseError).toHaveBeenCalledOnce();
		expect(callbacks.onResult).not.toHaveBeenCalled();
	});

	it("rejects an error event whose error field was renamed", async () => {
		const callbacks = typedCallbacks();
		const error = await parseSSE(
			eventStream("error", { message: "failed" }),
			callbacks,
		);

		expect(error).toBeInstanceOf(SSEParseError);
		expect(callbacks.onParseError).toHaveBeenCalledOnce();
		expect(callbacks.onError).not.toHaveBeenCalled();
	});

	it("still drives valid progress, partial, result, and error events", async () => {
		const callbacks = typedCallbacks();
		const stream = [
			eventStream("progress", { progress }),
			eventStream("partial", { progress, partial: result }),
			eventStream("result", { result }),
			eventStream("error", { error: "failed" }),
		].join("");
		const error = await parseSSE(stream, callbacks);

		expect(error).toBeNull();
		expect(callbacks.onParseError).not.toHaveBeenCalled();
		expect(callbacks.onProgress).toHaveBeenCalledWith({ progress });
		expect(callbacks.onPartial).toHaveBeenCalledWith({
			progress,
			partial: result,
		});
		expect(callbacks.onResult).toHaveBeenCalledWith({ result });
		expect(callbacks.onError).toHaveBeenCalledWith({ error: "failed" });
	});
});
