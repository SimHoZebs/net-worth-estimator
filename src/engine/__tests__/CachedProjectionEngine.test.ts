import { indexedDB } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createApplicationProjectionEngine } from "@/engine/applicationProjectionEngine";
import { CachedProjectionEngine } from "@/engine/CachedProjectionEngine";
import {
	EMPTY_MODEL_OVERRIDES,
	projectFinancialModelDocument,
	stochasticProject,
} from "@/lib/projection";
import {
	createBaseDocument,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import {
	IndexedDbProjectionArtifactStore,
	InMemoryProjectionArtifactStore,
} from "@/lib/projection/artifacts";
import type {
	ProjectionComputationEngine,
	ProjectionRequest,
	StochasticRequest,
} from "@/lib/projection/runtime/ProjectionEngine";

function createComputationEngine(): ProjectionComputationEngine {
	return {
		project: vi.fn(async (request: ProjectionRequest) =>
			projectFinancialModelDocument(
				request.document,
				request.projectionSettings,
				request.overrides,
			),
		),
		projectBase: vi.fn(async () => {
			throw new Error("projectBase is not used by the cached engine.");
		}),
		evaluateProjection: vi.fn(async () => {
			throw new Error("evaluateProjection is not used by the cached engine.");
		}),
		projectStochastic: vi.fn(async (request: StochasticRequest, onProgress) =>
			stochasticProject(
				request.document,
				request.projectionSettings,
				request.overrides,
				request.config,
				(progress, partial) => onProgress?.(progress, partial),
			),
		),
	};
}

function projectionRequest(): ProjectionRequest {
	return {
		document: createBaseDocument(),
		projectionSettings: makeSettings({ horizonYears: 1 }),
		overrides: structuredClone(EMPTY_MODEL_OVERRIDES),
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((fulfill) => {
		resolve = fulfill;
	});
	return { promise, resolve };
}

describe("CachedProjectionEngine", () => {
	it("reuses deterministic artifacts across fresh engines sharing a store", async () => {
		const store = new InMemoryProjectionArtifactStore();
		const firstCompute = createComputationEngine();
		const first = new CachedProjectionEngine(firstCompute, store);
		const request = projectionRequest();
		const expected = await first.project(request);

		const secondCompute = createComputationEngine();
		const second = new CachedProjectionEngine(secondCompute, store);
		const actual = await second.project(structuredClone(request));

		expect(actual).toEqual(expected);
		expect(firstCompute.project).toHaveBeenCalledOnce();
		expect(secondCompute.project).not.toHaveBeenCalled();
	});

	it("reuses deterministic artifacts across independent persistent stores", async () => {
		const databaseName = `projection-artifacts-reload-${crypto.randomUUID()}`;
		const request = projectionRequest();
		const firstCompute = createComputationEngine();
		const first = new CachedProjectionEngine(
			firstCompute,
			new IndexedDbProjectionArtifactStore({ databaseName, indexedDB }),
		);
		const expected = await first.project(request);

		const secondCompute = createComputationEngine();
		const second = new CachedProjectionEngine(
			secondCompute,
			new IndexedDbProjectionArtifactStore({ databaseName, indexedDB }),
		);
		const actual = await second.project(structuredClone(request));

		expect(actual).toEqual(expected);
		expect(firstCompute.project).toHaveBeenCalledOnce();
		expect(secondCompute.project).not.toHaveBeenCalled();
	});

	it("composes the backend computation engine with a session-local store", () => {
		vi.stubGlobal("indexedDB", indexedDB);
		const engine = createApplicationProjectionEngine();
		expect(engine).toBeInstanceOf(CachedProjectionEngine);
		vi.unstubAllGlobals();
	});

	it("recomputes when evaluation configuration changes", async () => {
		const compute = createComputationEngine();
		const engine = new CachedProjectionEngine(
			compute,
			new InMemoryProjectionArtifactStore(),
		);
		const request = projectionRequest();
		await engine.project(request);

		const changed = structuredClone(request);
		changed.projectionSettings.evaluations
			.financialIndependence[0]!.config.annualExpenseTarget += 1_000;
		await engine.project(changed);

		expect(compute.project).toHaveBeenCalledTimes(2);
	});

	it("recomputes FI evaluations when the expense basis changes", async () => {
		const compute = createComputationEngine();
		const engine = new CachedProjectionEngine(
			compute,
			new InMemoryProjectionArtifactStore(),
		);
		const request = projectionRequest();
		await engine.project(request);

		const changed = structuredClone(request);
		changed.projectionSettings.evaluations
			.financialIndependence[0]!.config.annualExpenseTargetBasis =
			"projection-start-purchasing-power";
		await engine.project(changed);

		expect(compute.project).toHaveBeenCalledTimes(2);
	});

	it("returns current labels without invalidating cached computation", async () => {
		const compute = createComputationEngine();
		const engine = new CachedProjectionEngine(
			compute,
			new InMemoryProjectionArtifactStore(),
		);
		const request = projectionRequest();
		await engine.project(request);
		const renamed = structuredClone(request);
		renamed.projectionSettings.evaluations.financialIndependence[0]!.label =
			"Retirement readiness";

		const result = await engine.project(renamed);

		expect(result.evaluations.financialIndependence[0]?.label).toBe(
			"Retirement readiness",
		);
		expect(compute.project).toHaveBeenCalledOnce();
	});

	it("ignores configuration changes for disabled evaluations", async () => {
		const compute = createComputationEngine();
		const engine = new CachedProjectionEngine(
			compute,
			new InMemoryProjectionArtifactStore(),
		);
		const request = projectionRequest();
		request.projectionSettings.evaluations.financialIndependence[0]!.enabled =
			false;
		await engine.project(request);
		const changed = structuredClone(request);
		changed.projectionSettings.evaluations
			.financialIndependence[0]!.config.annualExpenseTarget += 1_000;
		await engine.project(changed);

		expect(compute.project).toHaveBeenCalledOnce();
	});

	it("invalidates cached results when simulation inputs change", async () => {
		const compute = createComputationEngine();
		const engine = new CachedProjectionEngine(
			compute,
			new InMemoryProjectionArtifactStore(),
		);
		const request = projectionRequest();
		await engine.project(request);
		const changed = structuredClone(request);
		changed.projectionSettings.horizonYears = 2;
		await engine.project(changed);

		expect(compute.project).toHaveBeenCalledTimes(2);
	});

	it("persists one concrete outcome for null-seed requests", async () => {
		const store = new InMemoryProjectionArtifactStore();
		const request = {
			...projectionRequest(),
			config: { runCount: 2, seed: null },
		};
		const firstCompute = createComputationEngine();
		const firstResult = await new CachedProjectionEngine(
			firstCompute,
			store,
		).projectStochastic(request);

		const secondCompute = createComputationEngine();
		const secondResult = await new CachedProjectionEngine(
			secondCompute,
			store,
		).projectStochastic(structuredClone(request));

		expect(firstResult.config.seed).not.toBeNull();
		expect(secondResult).toEqual(firstResult);
		expect(firstCompute.projectStochastic).toHaveBeenCalledOnce();
		expect(secondCompute.projectStochastic).not.toHaveBeenCalled();
	});

	it("returns the persisted winner for concurrent null-seed requests", async () => {
		const persisted = new InMemoryProjectionArtifactStore();
		const store = {
			get: vi.fn().mockResolvedValue(undefined),
			delete: (key: string) => persisted.delete(key),
			putIfAbsent: (
				key: string,
				artifact: Parameters<typeof persisted.putIfAbsent>[1],
			) => persisted.putIfAbsent(key, artifact),
		};
		const request = {
			...projectionRequest(),
			config: { runCount: 1, seed: null },
		};
		const firstCompute = createComputationEngine();
		const secondCompute = createComputationEngine();

		const results = await Promise.all([
			new CachedProjectionEngine(firstCompute, store).projectStochastic(
				request,
			),
			new CachedProjectionEngine(secondCompute, store).projectStochastic(
				request,
			),
		]);

		expect(results[0]).toEqual(results[1]);
		expect(firstCompute.projectStochastic).toHaveBeenCalledOnce();
		expect(secondCompute.projectStochastic).toHaveBeenCalledOnce();
	});

	it("fails open when artifact storage is unavailable", async () => {
		const compute = createComputationEngine();
		const store = {
			get: vi.fn().mockRejectedValue(new Error("storage unavailable")),
			delete: vi.fn().mockRejectedValue(new Error("storage unavailable")),
			putIfAbsent: vi.fn().mockRejectedValue(new Error("quota exceeded")),
		};
		const result = await new CachedProjectionEngine(compute, store).project(
			projectionRequest(),
		);

		expect(result.timeline.rows.length).toBeGreaterThan(0);
		expect(compute.project).toHaveBeenCalledOnce();
	});

	it("fails open without deleting artifacts when storage reads fail", async () => {
		const compute = createComputationEngine();
		const store = {
			get: vi.fn().mockRejectedValue(new TypeError("invalid artifact")),
			delete: vi.fn().mockResolvedValue(undefined),
			putIfAbsent: vi
				.fn()
				.mockImplementation(async (_key, artifact) => artifact),
		};

		await new CachedProjectionEngine(compute, store).project(
			projectionRequest(),
		);

		expect(store.delete).not.toHaveBeenCalled();
		expect(compute.project).toHaveBeenCalledOnce();
	});

	it("deletes corrupt artifacts and recomputes them", async () => {
		const compute = createComputationEngine();
		const store = {
			get: vi.fn().mockResolvedValue({
				kind: "corrupt",
				inputDigest: "corrupt",
				createdAt: new Date().toISOString(),
				payload: { evaluations: {} },
			}),
			delete: vi.fn().mockResolvedValue(undefined),
			putIfAbsent: vi
				.fn()
				.mockImplementation(async (_key, artifact) => artifact),
		};

		const result = await new CachedProjectionEngine(compute, store).project(
			projectionRequest(),
		);

		expect(result.timeline.rows.length).toBeGreaterThan(0);
		expect(store.delete).toHaveBeenCalled();
		expect(compute.project).toHaveBeenCalledOnce();
	});

	it("does not return a stochastic result aborted during persistence", async () => {
		const pending = deferred<unknown>();
		const store = {
			get: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
			putIfAbsent: vi.fn().mockImplementation(async (_key, artifact) => {
				await pending.promise;
				return artifact;
			}),
		};
		const controller = new AbortController();
		const promise = new CachedProjectionEngine(
			createComputationEngine(),
			store,
		).projectStochastic({
			...projectionRequest(),
			config: { runCount: 1, seed: 1 },
			signal: controller.signal,
		});
		await vi.waitFor(() => expect(store.putIfAbsent).toHaveBeenCalledOnce());
		controller.abort();
		pending.resolve(store.putIfAbsent.mock.calls[0]![1]);

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
	});

	it("does not expose mutable references held by the store", async () => {
		const store = new InMemoryProjectionArtifactStore();
		const compute = createComputationEngine();
		const engine = new CachedProjectionEngine(compute, store);
		const request = projectionRequest();
		const first = await engine.project(request);
		const expectedFinalNetWorth = first.summary.finalNetWorth;
		first.summary.finalNetWorth = -1;

		const second = await engine.project(request);

		expect(second.summary.finalNetWorth).toBe(expectedFinalNetWorth);
	});

	it("rejects an aborted request even when an artifact is cached", async () => {
		const store = new InMemoryProjectionArtifactStore();
		const engine = new CachedProjectionEngine(createComputationEngine(), store);
		const request = projectionRequest();
		await engine.project(request);
		const controller = new AbortController();
		controller.abort();

		await expect(
			engine.project({ ...request, signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
	});
});
