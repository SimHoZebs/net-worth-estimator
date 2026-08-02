// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectionEngine } from "@/engine/ProjectionEngineContext";
import { WorkerProjectionEngine } from "@/engine/WorkerProjectionEngine";
import type {
	EvaluationResultCollection,
	ProjectionPath,
	ProjectionResult,
	RawProjectionOutput,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	projectFinancialModelDocument,
	projectRawFinancialModelDocument,
} from "@/lib/projection";
import {
	createBaseDocument,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import type { ProjectionEngine } from "@/lib/projection/runtime/ProjectionEngine";
import { decodeRawProjectionOutput } from "@/workers/types";
import { wrapperWithEngine } from "./test-helpers";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeProjectionResult(): ProjectionResult {
	return projectFinancialModelDocument(createBaseDocument(), makeSettings());
}

function makeRawProjectionOutput(): RawProjectionOutput {
	return projectRawFinancialModelDocument(
		createBaseDocument(),
		makeSettings(),
		makeDefaultOverrides(),
	);
}

function makeStochasticResult(): StochasticProjectionResult {
	const deterministic = makeProjectionResult();
	const date = deterministic.timeline.rows[0]?.date ?? "2026-01-01";
	return {
		config: { runCount: 1, seed: 1 },
		deterministic,
		bands: [
			{
				date,
				isHistorical: false,
				netWorth: { p10: 1, p25: 1, p50: 1, p75: 1, p90: 1 },
			},
		],
		milestones: {
			finalNetWorthPercentiles: {
				p10: 1,
				p25: 1,
				p50: 1,
				p75: 1,
				p90: 1,
			},
		},
		evaluations: deterministic.evaluations,
	};
}

function makeDefaultOverrides() {
	return {
		addedAccounts: [],
		addedPostings: [],
		disabledAccountIds: [],
		disabledPostingIds: [],
	};
}

function makeMockEngine(
	overrides: Partial<ProjectionEngine> = {},
): ProjectionEngine {
	return {
		project: vi.fn(async () => makeProjectionResult()),
		projectStochastic: vi.fn(async () => makeStochasticResult()),
		...overrides,
	};
}

class MockWorker {
	static instances: MockWorker[] = [];
	static postMessageError: Error | null = null;

	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: (() => void) | null = null;
	onmessageerror: (() => void) | null = null;
	terminate = vi.fn();
	postMessage = vi.fn(() => {
		if (MockWorker.postMessageError) throw MockWorker.postMessageError;
	});

	constructor() {
		MockWorker.instances.push(this);
	}
}

/* ------------------------------------------------------------------ */
/*  Context tests                                                        */
/* ------------------------------------------------------------------ */

describe("ProjectionEngineContext", () => {
	it("throws when used outside a provider", () => {
		expect(() => {
			const { result } = renderHook(() => useProjectionEngine());
			void result.current;
		}).toThrow(
			"useProjectionEngine must be used within a <ProjectionEngineProvider>",
		);
	});

	it("returns the engine provided via context", () => {
		const engine = makeMockEngine();
		const { result } = renderHook(() => useProjectionEngine(), {
			wrapper: wrapperWithEngine(engine),
		});
		expect(result.current).toBe(engine);
	});
});

/* ------------------------------------------------------------------ */
/*  WorkerProjectionEngine contract validation                         */
/* ------------------------------------------------------------------ */

describe("WorkerProjectionEngine", () => {
	beforeEach(() => {
		MockWorker.instances = [];
		MockWorker.postMessageError = null;
		vi.stubGlobal("Worker", MockWorker);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("resolves projection responses and terminates the worker", async () => {
		const engine = new WorkerProjectionEngine();
		const expected = makeProjectionResult();
		const request = {
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
		};
		const promise = engine.project(request);
		const worker = MockWorker.instances[0]!;
		expect(worker.postMessage).toHaveBeenCalledWith({
			id: 1,
			type: "complete",
			...request,
		});
		expect(structuredClone({ request, expected })).toEqual({
			request,
			expected,
		});

		worker.onmessage?.({
			data: {
				id: 1,
				type: "complete",
				result: expected,
				runtimeError: null,
			},
		} as MessageEvent);

		await expect(promise).resolves.toBe(expected);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("streams stochastic progress before resolving", async () => {
		const engine = new WorkerProjectionEngine();
		const onProgress = vi.fn();
		const expected = makeStochasticResult();
		const partial = makeStochasticResult();
		const progress = {
			phase: "stochastic-runs" as const,
			completedRuns: 1,
			totalRuns: 2,
			fraction: 0.5,
			evaluationWorkloads: [],
		};
		const request = {
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
			config: { runCount: 1, seed: 1 },
		};
		const promise = engine.projectStochastic(request, onProgress);
		const worker = MockWorker.instances[0]!;
		expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, ...request });

		worker.onmessage?.({
			data: { id: 1, type: "progress", progress, partial },
		} as MessageEvent);
		worker.onmessage?.({
			data: { id: 1, type: "result", result: expected, runtimeError: null },
		} as MessageEvent);

		expect(onProgress).toHaveBeenCalledWith(progress, partial);
		await expect(promise).resolves.toBe(expected);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("supports staged base projection worker requests", async () => {
		const engine = new WorkerProjectionEngine();
		const expected = makeRawProjectionOutput();
		const promise = engine.projectBase({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
		});
		const worker = MockWorker.instances[0]!;

		expect(worker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ id: 1, type: "base" }),
		);
		worker.onmessage?.({
			data: { id: 1, type: "base", result: expected, runtimeError: null },
		} as MessageEvent);

		await expect(promise).resolves.toEqual(expected);
	});

	it("supports generic path evaluation worker requests", async () => {
		const engine = new WorkerProjectionEngine();
		const projected = projectFinancialModelDocument(
			createBaseDocument(),
			makeSettings(),
		);
		const expected = {
			evaluations: projected.evaluations,
		} as EvaluationResultCollection;
		const path: ProjectionPath = {
			rows: [],
			movementEvents: [],
			projectionStartPostingState: {
				latestRealizedPostingAmounts: new Map(),
				realizedPostingAmountsByYear: new Map(),
			},
			effectiveDocument: createBaseDocument(),
			projectionStartDate: "2025-01-01",
			projectionEndDate: "2026-01-01",
		};
		const promise = engine.evaluateProjection({
			path,
			evaluations: makeSettings().evaluations,
		});
		const worker = MockWorker.instances[0]!;

		expect(worker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ id: 1, type: "evaluation", path }),
		);
		worker.onmessage?.({
			data: {
				id: 1,
				type: "evaluation",
				result: expected,
				runtimeError: null,
			},
		} as MessageEvent);

		await expect(promise).resolves.toBe(expected);
	});

	it("rejects malformed deterministic worker messages", async () => {
		const engine = new WorkerProjectionEngine();
		const promise = engine.project({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
		});
		const worker = MockWorker.instances[0]!;

		worker.onmessage?.({
			data: { id: 1, type: "complete", runtimeError: null },
		} as MessageEvent);

		await expect(promise).rejects.toThrow(
			"Projection worker returned a malformed message.",
		);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("rejects deterministic responses with an invalid result payload", async () => {
		const engine = new WorkerProjectionEngine();
		const promise = engine.project({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
		});
		const worker = MockWorker.instances[0]!;

		worker.onmessage?.({
			data: { id: 1, type: "complete", result: {}, runtimeError: null },
		} as MessageEvent);

		await expect(promise).rejects.toThrow("invalid result");
	});

	it("rejects raw results with a malformed effective document", () => {
		const malformed = structuredClone(makeRawProjectionOutput());
		const posting = malformed.path.effectiveDocument.postings[0]!;
		posting.destinations = [42] as unknown as string[];

		expect(decodeRawProjectionOutput(malformed)).toBeNull();

		posting.destinations = ["checking"];
		posting.frequency = "invalid" as typeof posting.frequency;
		expect(decodeRawProjectionOutput(malformed)).toBeNull();
	});

	it("returns the canonical document produced by raw result decoding", () => {
		const result = structuredClone(makeRawProjectionOutput());
		const account = result.path.effectiveDocument.accounts[0]!;
		const accountId = account.id;
		account.id = ` ${accountId} `;

		expect(
			decodeRawProjectionOutput(result)?.path.effectiveDocument.accounts[0]?.id,
		).toBe(accountId);
	});

	it("preserves validated income data when decoding raw results", () => {
		const result = structuredClone(makeRawProjectionOutput());
		const incomeData = {
			incomeSources: [
				{
					id: "salary",
					label: "Salary",
					effectiveFrom: "2026-01-01",
					effectiveTo: null,
					annualGrossIncome: 120_000,
				},
			],
			taxProfiles: [],
		};
		result.path.incomeData = incomeData;

		expect(decodeRawProjectionOutput(result)?.path.incomeData).toEqual(
			incomeData,
		);
	});

	it("rejects deterministic responses for the wrong request type", async () => {
		const engine = new WorkerProjectionEngine();
		const promise = engine.project({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
		});
		const worker = MockWorker.instances[0]!;

		worker.onmessage?.({
			data: { id: 1, type: "base", result: {}, runtimeError: null },
		} as MessageEvent);

		await expect(promise).rejects.toThrow(
			"Projection worker returned the wrong result type.",
		);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("rejects malformed stochastic worker messages", async () => {
		const engine = new WorkerProjectionEngine();
		const promise = engine.projectStochastic({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
			config: { runCount: 1, seed: 1 },
		});
		const worker = MockWorker.instances[0]!;

		worker.onmessage?.({
			data: { id: 1, type: "result", result: {} },
		} as MessageEvent);

		await expect(promise).rejects.toThrow(
			"Stochastic worker returned a malformed message.",
		);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("rejects stochastic progress with an invalid workload", async () => {
		const engine = new WorkerProjectionEngine();
		const promise = engine.projectStochastic({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
			config: { runCount: 1, seed: 1 },
		});
		const worker = MockWorker.instances[0]!;

		worker.onmessage?.({
			data: {
				id: 1,
				type: "progress",
				progress: {
					phase: "stochastic-runs",
					completedRuns: 1,
					totalRuns: 1,
					fraction: 1,
					evaluationWorkloads: [{ type: "financialIndependence" }],
				},
			},
		} as MessageEvent);

		await expect(promise).rejects.toThrow("malformed message");
	});

	it("rejects unknown stochastic message types", async () => {
		const engine = new WorkerProjectionEngine();
		const promise = engine.projectStochastic({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
			config: { runCount: 1, seed: 1 },
		});
		const worker = MockWorker.instances[0]!;

		worker.onmessage?.({
			data: { id: 1, type: "complete", result: {}, runtimeError: null },
		} as MessageEvent);

		await expect(promise).rejects.toThrow(
			"Stochastic worker returned a malformed message.",
		);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("terminates without posting when already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const engine = new WorkerProjectionEngine();

		const promise = engine.project({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
			signal: controller.signal,
		});
		const worker = MockWorker.instances[0]!;

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("terminates stochastic work when aborted in flight", async () => {
		const controller = new AbortController();
		const engine = new WorkerProjectionEngine();
		const promise = engine.projectStochastic({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
			config: { runCount: 1, seed: 1 },
			signal: controller.signal,
		});
		const worker = MockWorker.instances[0]!;

		controller.abort();

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBeNull();
	});

	it.each([
		[
			"deterministic",
			(engine: WorkerProjectionEngine) =>
				engine.project({
					document: createBaseDocument(),
					projectionSettings: makeSettings(),
					overrides: makeDefaultOverrides(),
				}),
			"Projection worker crashed.",
		],
		[
			"stochastic",
			(engine: WorkerProjectionEngine) =>
				engine.projectStochastic({
					document: createBaseDocument(),
					projectionSettings: makeSettings(),
					overrides: makeDefaultOverrides(),
					config: { runCount: 1, seed: 1 },
				}),
			"Stochastic worker crashed.",
		],
	])(
		"terminates and rejects %s worker crashes",
		async (_name, run, message) => {
			const promise = run(new WorkerProjectionEngine());
			const worker = MockWorker.instances[0]!;

			worker.onerror?.();

			await expect(promise).rejects.toThrow(message);
			expect(worker.terminate).toHaveBeenCalledOnce();
		},
	);

	it("terminates when posting a worker request fails", async () => {
		MockWorker.postMessageError = new DOMException(
			"Could not clone request",
			"DataCloneError",
		);
		const engine = new WorkerProjectionEngine();

		const promise = engine.project({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
		});
		const worker = MockWorker.instances[0]!;

		await expect(promise).rejects.toThrow("Could not clone request");
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("terminates and rejects unreadable worker messages", async () => {
		const engine = new WorkerProjectionEngine();
		const promise = engine.project({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
		});
		const worker = MockWorker.instances[0]!;

		worker.onmessageerror?.();

		await expect(promise).rejects.toThrow(
			"Projection worker returned an unreadable message.",
		);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("terminates stochastic work when the progress callback fails", async () => {
		const engine = new WorkerProjectionEngine();
		const promise = engine.projectStochastic(
			{
				document: createBaseDocument(),
				projectionSettings: makeSettings(),
				overrides: makeDefaultOverrides(),
				config: { runCount: 1, seed: 1 },
			},
			() => {
				throw new Error("Progress failed");
			},
		);
		const worker = MockWorker.instances[0]!;

		worker.onmessage?.({
			data: {
				id: 1,
				type: "progress",
				progress: {
					phase: "stochastic-runs",
					completedRuns: 1,
					totalRuns: 2,
					fraction: 0.5,
					evaluationWorkloads: [],
				},
			},
		} as MessageEvent);

		await expect(promise).rejects.toThrow("Progress failed");
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
});
