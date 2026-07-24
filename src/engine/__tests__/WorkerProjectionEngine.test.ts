// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectionEngine } from "@/engine/ProjectionEngineContext";
import { WorkerProjectionEngine } from "@/engine/WorkerProjectionEngine";
import type {
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import { projectFinancialModelDocument } from "@/lib/projection";
import {
	createBaseDocument,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import type { ProjectionEngine } from "@/lib/projection/runtime/ProjectionEngine";
import { wrapperWithEngine } from "./test-helpers";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeProjectionResult(): ProjectionResult {
	return projectFinancialModelDocument(createBaseDocument(), makeSettings());
}

function makeDefaultOverrides() {
	return {
		addedAccounts: [],
		addedPostings: [],
		addedCheckpoints: [],
		disabledAccountIds: [],
		disabledPostingIds: [],
	};
}

function makeMockEngine(
	overrides: Partial<ProjectionEngine> = {},
): ProjectionEngine {
	return {
		project: vi.fn(async () => makeProjectionResult()),
		projectStochastic: vi.fn(async () => ({}) as StochasticProjectionResult),
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
/*  Mock engine project() tests                                        */
/* ------------------------------------------------------------------ */

describe("Mock engine project()", () => {
	let engine: ProjectionEngine & {
		project: ReturnType<typeof vi.fn>;
		projectStochastic: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		engine = makeMockEngine() as typeof engine;
	});

	it("calls project with correct arguments", async () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const overrides = makeDefaultOverrides();

		const result = await engine.project({
			document,
			projectionSettings: settings,
			overrides,
		});

		expect(engine.project).toHaveBeenCalledOnce();
		expect(engine.project).toHaveBeenCalledWith({
			document,
			projectionSettings: settings,
			overrides,
		});
		expect(result.summary.currentNetWorth).toBe(1600);
	});

	it("keeps evaluation settings and results structured-clone safe", () => {
		const request = {
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
		};
		const result = makeProjectionResult();
		expect(structuredClone(request)).toEqual(request);
		expect(structuredClone(result)).toEqual(result);
		expect(() => JSON.stringify({ request, result })).not.toThrow();
	});

	it("passes AbortSignal through to the request", async () => {
		const controller = new AbortController();

		await engine.project({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
			signal: controller.signal,
		});

		const callArgs = engine.project.mock.calls[0][0];
		expect(callArgs.signal).toBeInstanceOf(AbortSignal);
		expect(callArgs.signal).toBe(controller.signal);
	});

	it("engine rejects when signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		engine.project = vi.fn(async (request: { signal?: AbortSignal }) => {
			if (request.signal?.aborted) {
				throw new DOMException("Aborted", "AbortError");
			}
			return makeProjectionResult();
		});

		await expect(
			engine.project({
				document: createBaseDocument(),
				projectionSettings: makeSettings(),
				overrides: makeDefaultOverrides(),
				signal: controller.signal,
			}),
		).rejects.toThrow("Aborted");

		expect(engine.project).toHaveBeenCalledTimes(1);
	});
});

/* ------------------------------------------------------------------ */
/*  Mock engine projectStochastic() tests                              */
/* ------------------------------------------------------------------ */

describe("Mock engine projectStochastic()", () => {
	let engine: ProjectionEngine & {
		project: ReturnType<typeof vi.fn>;
		projectStochastic: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		engine = makeMockEngine() as typeof engine;
	});

	it("calls projectStochastic with correct arguments", async () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const overrides = makeDefaultOverrides();
		const config = { runCount: 10, seed: 42 as number | null };

		await engine.projectStochastic({
			document,
			projectionSettings: settings,
			overrides,
			config,
		});

		expect(engine.projectStochastic).toHaveBeenCalledOnce();
		const callArgs = engine.projectStochastic.mock.calls[0][0];
		expect(callArgs).toEqual({
			document,
			projectionSettings: settings,
			overrides,
			config,
		});
	});

	it("calls onProgress callback", async () => {
		const onProgress = vi.fn();

		engine.projectStochastic = vi.fn(
			async (_request, onProgress?: (p: number) => void) => {
				onProgress?.(0.5);
				onProgress?.(1.0);
				return {} as StochasticProjectionResult;
			},
		);

		await engine.projectStochastic(
			{
				document: createBaseDocument(),
				projectionSettings: makeSettings(),
				overrides: makeDefaultOverrides(),
				config: { runCount: 10, seed: null },
			},
			onProgress,
		);

		expect(onProgress).toHaveBeenCalledTimes(2);
		expect(onProgress).toHaveBeenNthCalledWith(1, 0.5);
		expect(onProgress).toHaveBeenNthCalledWith(2, 1.0);
	});

	it("aborts with AbortError when signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		engine.projectStochastic = vi.fn(
			async (request: { signal?: AbortSignal }) => {
				if (request.signal?.aborted) {
					throw new DOMException("Aborted", "AbortError");
				}
				return {} as StochasticProjectionResult;
			},
		);

		await expect(
			engine.projectStochastic({
				document: createBaseDocument(),
				projectionSettings: makeSettings(),
				overrides: makeDefaultOverrides(),
				config: { runCount: 10, seed: null },
				signal: controller.signal,
			}),
		).rejects.toThrow("Aborted");
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

	it("exports a class that satisfies ProjectionEngine", async () => {
		const mod = await import("@/engine/WorkerProjectionEngine");
		expect(mod.WorkerProjectionEngine).toBeDefined();
		const engine = new mod.WorkerProjectionEngine();
		expect(typeof engine.project).toBe("function");
		expect(typeof engine.projectStochastic).toBe("function");
	});

	it("resolves projection responses and terminates the worker", async () => {
		const engine = new WorkerProjectionEngine();
		const expected = makeProjectionResult();
		const promise = engine.project({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: makeDefaultOverrides(),
		});
		const worker = MockWorker.instances[0]!;

		worker.onmessage?.({
			data: { id: 1, result: expected, runtimeError: null },
		} as MessageEvent);

		await expect(promise).resolves.toBe(expected);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("streams stochastic progress before resolving", async () => {
		const engine = new WorkerProjectionEngine();
		const onProgress = vi.fn();
		const expected = {} as StochasticProjectionResult;
		const partial = {
			config: { runCount: 1, seed: 1 },
		} as StochasticProjectionResult;
		const promise = engine.projectStochastic(
			{
				document: createBaseDocument(),
				projectionSettings: makeSettings(),
				overrides: makeDefaultOverrides(),
				config: { runCount: 1, seed: 1 },
			},
			onProgress,
		);
		const worker = MockWorker.instances[0]!;

		worker.onmessage?.({
			data: { id: 1, type: "progress", progress: 0.5, partial },
		} as MessageEvent);
		worker.onmessage?.({
			data: { id: 1, type: "result", result: expected, runtimeError: null },
		} as MessageEvent);

		expect(onProgress).toHaveBeenCalledWith(0.5, partial);
		await expect(promise).resolves.toBe(expected);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

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
			data: { id: 1, type: "progress", progress: 0.5 },
		} as MessageEvent);

		await expect(promise).rejects.toThrow("Progress failed");
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
});
