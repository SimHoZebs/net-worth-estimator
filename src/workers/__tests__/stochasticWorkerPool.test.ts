import { describe, expect, it, vi } from "vitest";
import {
	projectRawFinancialModelDocument,
	type StochasticProjectionResult,
} from "@/lib/projection";
import {
	createBaseDocument,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import type {
	StochasticPathWorkerRequest,
	StochasticPathWorkerResponse,
} from "../stochasticPathTypes";
import {
	getStochasticPathWorkerCount,
	runStochasticWorkerPool,
	type StochasticPoolSession,
} from "../stochasticWorkerPool";

const path = projectRawFinancialModelDocument(
	createBaseDocument(),
	makeSettings(),
).path;
const result = {} as StochasticProjectionResult;

class MockWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	readonly requests: StochasticPathWorkerRequest[] = [];
	readonly terminate = vi.fn();
	postError: Error | null = null;

	postMessage(request: StochasticPathWorkerRequest) {
		if (this.postError) throw this.postError;
		this.requests.push(request);
	}

	emit(response: StochasticPathWorkerResponse | unknown) {
		this.onmessage?.({ data: response } as MessageEvent<unknown>);
	}
}

function createSession(runCount: number) {
	let sampleIndex = 0;
	const consumed: number[] = [];
	const samples = new Map<object, number>();
	const session = {
		config: { runCount },
		prepared: {} as StochasticPoolSession["prepared"],
		createSample() {
			const sample = { annualRatesByPostingId: new Map() };
			samples.set(sample, sampleIndex++);
			return sample;
		},
		consumeSample(_path, sample) {
			consumed.push(samples.get(sample) ?? -1);
		},
		result: () => result,
	} satisfies StochasticPoolSession;
	return { session, consumed };
}

function initializePool(runCount: number, workerCount: number) {
	const workers: MockWorker[] = [];
	const { session, consumed } = createSession(runCount);
	const promise = runStochasticWorkerPool(session, workerCount, () => {
		const worker = new MockWorker();
		workers.push(worker);
		return worker as unknown as Worker;
	});
	for (const worker of workers) worker.emit({ type: "ready" });
	return { workers, consumed, promise };
}

function assignedRuns(workers: MockWorker[]) {
	return workers.flatMap((worker) =>
		worker.requests.flatMap((request) =>
			request.type === "run" ? [request.runIndex] : [],
		),
	);
}

describe("stochastic path worker count", () => {
	it("caps parallelism by work, hardware, and the hard ceiling", () => {
		expect(getStochasticPathWorkerCount(1_000, 32)).toBe(4);
		expect(getStochasticPathWorkerCount(100, 32)).toBe(2);
		expect(getStochasticPathWorkerCount(49, 32)).toBe(1);
		expect(getStochasticPathWorkerCount(1_000, 4)).toBe(2);
		expect(getStochasticPathWorkerCount(1_000, 2)).toBe(1);
	});

	it("uses a conservative fallback for unavailable hardware data", () => {
		expect(getStochasticPathWorkerCount(1_000, undefined)).toBe(1);
		expect(getStochasticPathWorkerCount(1_000, Number.NaN)).toBe(1);
		expect(getStochasticPathWorkerCount(1_000, 0)).toBe(1);
	});
});

describe("stochastic worker pool", () => {
	it("bounds assigned paths and consumes out-of-order results in run order", async () => {
		const { workers, consumed, promise } = initializePool(6, 3);
		expect(assignedRuns(workers)).toEqual([0, 1, 2]);

		workers[1]!.emit({ type: "result", runIndex: 1, path });
		workers[2]!.emit({ type: "result", runIndex: 2, path });
		expect(assignedRuns(workers)).toEqual([0, 1, 2]);
		expect(consumed).toEqual([]);

		workers[0]!.emit({ type: "result", runIndex: 0, path });
		expect(consumed).toEqual([0, 1, 2]);
		expect(assignedRuns(workers)).toEqual([0, 3, 1, 4, 2, 5]);

		workers[2]!.emit({ type: "result", runIndex: 5, path });
		workers[0]!.emit({ type: "result", runIndex: 3, path });
		workers[1]!.emit({ type: "result", runIndex: 4, path });
		await expect(promise).resolves.toBe(result);
		expect(consumed).toEqual([0, 1, 2, 3, 4, 5]);
		for (const worker of workers)
			expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("rejects malformed responses and terminates the whole pool", async () => {
		const { workers, promise } = initializePool(3, 2);
		workers[0]!.emit({ nope: true });

		await expect(promise).rejects.toThrow(
			"Stochastic path worker returned a malformed message.",
		);
		for (const worker of workers)
			expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("rejects a result envelope containing an invalid projection path", async () => {
		const { workers, promise } = initializePool(3, 2);
		workers[0]!.emit({ type: "result", runIndex: 0, path: { rows: [] } });

		await expect(promise).rejects.toThrow(
			"Stochastic path worker returned a malformed message.",
		);
		for (const worker of workers)
			expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("rejects worker crashes and terminates sibling workers", async () => {
		const { workers, promise } = initializePool(3, 2);
		workers[0]!.onerror?.({ message: "boom" } as ErrorEvent);

		await expect(promise).rejects.toThrow(
			"Stochastic path worker crashed. boom",
		);
		for (const worker of workers)
			expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("rejects synchronous postMessage failures", async () => {
		const workers: MockWorker[] = [];
		const { session } = createSession(2);
		const promise = runStochasticWorkerPool(session, 2, () => {
			const worker = new MockWorker();
			worker.postError = new Error("clone failed");
			workers.push(worker);
			return worker as unknown as Worker;
		});

		await expect(promise).rejects.toThrow("clone failed");
		for (const worker of workers)
			expect(worker.terminate).toHaveBeenCalledOnce();
	});
});
