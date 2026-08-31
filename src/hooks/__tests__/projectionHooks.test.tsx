// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModelOverrides, StochasticProgress } from "@/lib/projection";
import {
	createBaseDocument,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import { projectFinancialModelDocument } from "@/lib/projection/analysis/projectFinancialModel";
import { stochasticProject } from "@/lib/projection/analysis/projectStochastic";
import type { ProjectionEngine } from "@/lib/projection/runtime/ProjectionEngine";
import { deferred } from "@/test/deferred";
import { wrapperWithEngine } from "@/test/projectionEngineWrapper";
import { useProjection } from "../useProjection";
import { useStochastic } from "../useStochastic";

const overrides: ModelOverrides = {
	addedAccounts: [],
	addedPostings: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

describe("projection hook request provenance", () => {
	it("does not restart workers for structurally equal cloned inputs", async () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const engine: ProjectionEngine = {
			project: vi
				.fn()
				.mockResolvedValue(
					projectFinancialModelDocument(document, settings, overrides),
				),
			projectStochastic: vi.fn().mockResolvedValue(
				stochasticProject(document, settings, overrides, {
					runCount: 1,
					seed: 1,
				}),
			),
		};
		const hook = renderHook(
			({ currentDocument, currentSettings, currentOverrides }) => ({
				deterministic: useProjection(
					currentDocument,
					currentSettings,
					currentOverrides,
					true,
				),
				stochastic: useStochastic(
					currentDocument,
					currentSettings,
					currentOverrides,
					{ runCount: 1, seed: 1 },
					true,
				),
			}),
			{
				initialProps: {
					currentDocument: document,
					currentSettings: settings,
					currentOverrides: overrides,
				},
				wrapper: wrapperWithEngine(engine),
			},
		);

		await waitFor(() => {
			expect(engine.project).toHaveBeenCalledOnce();
			expect(engine.projectStochastic).toHaveBeenCalledOnce();
		});
		hook.rerender({
			currentDocument: structuredClone(document),
			currentSettings: structuredClone(settings),
			currentOverrides: structuredClone(overrides),
		});
		await act(async () => Promise.resolve());

		expect(engine.project).toHaveBeenCalledOnce();
		expect(engine.projectStochastic).toHaveBeenCalledOnce();
	});

	it("does not restart either worker for presentation-only label edits", async () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const deterministic = projectFinancialModelDocument(
			document,
			settings,
			overrides,
		);
		const stochastic = stochasticProject(document, settings, overrides, {
			runCount: 1,
			seed: 1,
		});
		const engine: ProjectionEngine = {
			project: vi.fn().mockResolvedValue(deterministic),
			projectStochastic: vi.fn().mockResolvedValue(stochastic),
		};
		const hook = renderHook(
			({ currentSettings }) => ({
				deterministic: useProjection(
					document,
					currentSettings,
					overrides,
					true,
				),
				stochastic: useStochastic(
					document,
					currentSettings,
					overrides,
					{ runCount: 1, seed: 1 },
					true,
				),
			}),
			{
				initialProps: { currentSettings: settings },
				wrapper: wrapperWithEngine(engine),
			},
		);

		await waitFor(() => {
			expect(engine.project).toHaveBeenCalledTimes(1);
			expect(engine.projectStochastic).toHaveBeenCalledTimes(1);
		});
		const labelOnlySettings = structuredClone(settings);
		labelOnlySettings.evaluations.financialIndependence[0]!.label =
			"Retirement readiness";
		hook.rerender({ currentSettings: labelOnlySettings });

		await act(async () => Promise.resolve());
		expect(engine.project).toHaveBeenCalledTimes(1);
		expect(engine.projectStochastic).toHaveBeenCalledTimes(1);
		expect(
			hook.result.current.deterministic.result?.evaluations
				.financialIndependence[0]?.label,
		).toBe("Retirement readiness");
		expect(
			hook.result.current.stochastic.result?.evaluations
				.financialIndependence[0]?.label,
		).toBe("Retirement readiness");
	});

	it("restores presentation labels on stochastic workload progress", async () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const completion = deferred<ReturnType<typeof stochasticProject>>();
		const engine: ProjectionEngine = {
			project: vi.fn(),
			projectStochastic: vi.fn().mockImplementation((_request, onProgress) => {
				onProgress({
					phase: "deterministic-evaluations",
					completedRuns: 0,
					totalRuns: 1,
					fraction: 0,
					evaluationWorkloads: [
						{
							type: "financialIndependence",
							instanceId: "fi",
							label: "",
							completedUnits: 0,
							totalUnits: 1,
							unitLabel: "monthly start dates",
							unitAction: "checked",
						},
					],
				});
				return completion.promise;
			}),
		};
		const hook = renderHook(
			() =>
				useStochastic(
					document,
					settings,
					overrides,
					{ runCount: 1, seed: 1 },
					true,
				),
			{ wrapper: wrapperWithEngine(engine) },
		);

		await waitFor(() =>
			expect(hook.result.current.progress?.evaluationWorkloads[0]?.label).toBe(
				"Financial independence",
			),
		);
	});

	it("keeps labeled results stable across unrelated stochastic progress", async () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const deterministic = projectFinancialModelDocument(
			document,
			settings,
			overrides,
		);
		const partialResult = stochasticProject(document, settings, overrides, {
			runCount: 1,
			seed: 1,
		});
		const completion = deferred<typeof partialResult>();
		let onProgress:
			| ((progress: StochasticProgress, partial?: typeof partialResult) => void)
			| undefined;
		const engine: ProjectionEngine = {
			project: vi.fn().mockResolvedValue(deterministic),
			projectStochastic: vi.fn().mockImplementation((_request, callback) => {
				onProgress = callback;
				return completion.promise;
			}),
		};
		const hook = renderHook(
			() => ({
				deterministic: useProjection(document, settings, overrides, true),
				stochastic: useStochastic(
					document,
					settings,
					overrides,
					{ runCount: 1, seed: 1 },
					true,
				),
			}),
			{ wrapper: wrapperWithEngine(engine) },
		);

		await waitFor(() => {
			expect(hook.result.current.deterministic.result).not.toBeNull();
			expect(onProgress).toBeDefined();
		});
		const deterministicResult = hook.result.current.deterministic.result;
		act(() =>
			onProgress?.(
				{
					phase: "stochastic-runs",
					completedRuns: 1,
					totalRuns: 1,
					fraction: 1,
					evaluationWorkloads: [],
				},
				partialResult,
			),
		);
		const stochasticResult = hook.result.current.stochastic.result;

		expect(hook.result.current.deterministic.result).toBe(deterministicResult);
		expect(stochasticResult).not.toBeNull();

		act(() =>
			onProgress?.({
				phase: "deterministic-evaluations",
				completedRuns: 1,
				totalRuns: 1,
				fraction: 1,
				evaluationWorkloads: [],
			}),
		);

		expect(hook.result.current.deterministic.result).toBe(deterministicResult);
		expect(hook.result.current.stochastic.result).toBe(stochasticResult);
	});

	it("retains base results but marks evaluation-only replacements stale", async () => {
		const document = createBaseDocument();
		const firstSettings = makeSettings();
		const secondSettings = structuredClone(firstSettings);
		secondSettings.evaluations
			.financialIndependence[0]!.config.annualExpenseTarget = 50_000;
		const firstResult = projectFinancialModelDocument(
			document,
			firstSettings,
			overrides,
		);
		const replacement =
			deferred<ReturnType<typeof projectFinancialModelDocument>>();
		const engine: ProjectionEngine = {
			project: vi
				.fn()
				.mockResolvedValueOnce(firstResult)
				.mockReturnValueOnce(replacement.promise),
			projectStochastic: vi.fn(),
		};
		const hook = renderHook(
			({ settings }) => useProjection(document, settings, overrides, true),
			{
				initialProps: { settings: firstSettings },
				wrapper: wrapperWithEngine(engine),
			},
		);

		await waitFor(() =>
			expect(hook.result.current.result?.timeline).toEqual(
				firstResult.timeline,
			),
		);
		hook.rerender({ settings: secondSettings });

		expect(hook.result.current.result?.timeline).toEqual(firstResult.timeline);
		expect(hook.result.current.resultIsStale).toBe(true);
		await waitFor(() => expect(engine.project).toHaveBeenCalledTimes(2));
	});

	it("never exposes an obsolete deterministic result", async () => {
		const document = createBaseDocument();
		const firstSettings = makeSettings({ horizonYears: 1 });
		const secondSettings = makeSettings({ horizonYears: 2 });
		const first = deferred<ReturnType<typeof projectFinancialModelDocument>>();
		const second = deferred<ReturnType<typeof projectFinancialModelDocument>>();
		const engine: ProjectionEngine = {
			project: vi
				.fn()
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise),
			projectStochastic: vi.fn(),
		};
		const hook = renderHook(
			({ settings }) => useProjection(document, settings, overrides, true),
			{
				initialProps: { settings: firstSettings },
				wrapper: wrapperWithEngine(engine),
			},
		);

		await waitFor(() => expect(engine.project).toHaveBeenCalledTimes(1));
		hook.rerender({ settings: secondSettings });
		await waitFor(() => expect(engine.project).toHaveBeenCalledTimes(2));
		act(() =>
			first.resolve(
				projectFinancialModelDocument(document, firstSettings, overrides),
			),
		);
		expect(hook.result.current.result).toBeNull();
		act(() =>
			second.resolve(
				projectFinancialModelDocument(document, secondSettings, overrides),
			),
		);
		await waitFor(() =>
			expect(hook.result.current.result?.timeline.rows.length).toBeGreaterThan(
				0,
			),
		);
	});

	it("ignores obsolete stochastic partial callbacks", async () => {
		const document = createBaseDocument();
		const settings = makeSettings({ horizonYears: 2 });
		const first = deferred<ReturnType<typeof stochasticProject>>();
		const second = deferred<ReturnType<typeof stochasticProject>>();
		const callbacks: Array<
			(
				progress: StochasticProgress,
				partial?: ReturnType<typeof stochasticProject>,
			) => void
		> = [];
		const engine: ProjectionEngine = {
			project: vi.fn(),
			projectStochastic: vi
				.fn()
				.mockImplementationOnce((_request, onProgress) => {
					callbacks.push(onProgress);
					return first.promise;
				})
				.mockImplementationOnce((_request, onProgress) => {
					callbacks.push(onProgress);
					return second.promise;
				}),
		};
		const hook = renderHook(
			({ config }) =>
				useStochastic(document, settings, overrides, config, true),
			{
				initialProps: { config: { runCount: 1, seed: 1 } },
				wrapper: wrapperWithEngine(engine),
			},
		);

		await waitFor(() => expect(callbacks).toHaveLength(1));
		hook.rerender({ config: { runCount: 2, seed: 1 } });
		await waitFor(() => expect(callbacks).toHaveLength(2));
		const obsolete = stochasticProject(document, settings, overrides, {
			runCount: 1,
			seed: 1,
		});
		act(() =>
			callbacks[0](
				{
					phase: "stochastic-runs",
					completedRuns: 1,
					totalRuns: 1,
					fraction: 1,
					evaluationWorkloads: [],
				},
				obsolete,
			),
		);
		expect(hook.result.current.result).toBeNull();
		const current = stochasticProject(document, settings, overrides, {
			runCount: 2,
			seed: 1,
		});
		act(() =>
			callbacks[1](
				{
					phase: "stochastic-runs",
					completedRuns: 1,
					totalRuns: 2,
					fraction: 0.5,
					evaluationWorkloads: [],
				},
				current,
			),
		);
		expect(hook.result.current.result?.bands).toEqual(current.bands);
	});
});
