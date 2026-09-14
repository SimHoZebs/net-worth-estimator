// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
	ProjectionResult,
	StochasticProgress,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	createBaseDocument,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import type { ProjectionEngine } from "@/lib/projection/runtime/ProjectionEngine";
import { deferred } from "@/test/deferred";
import { wrapperWithEngine } from "@/test/projectionEngineWrapper";
import { useProjection } from "../useProjection";
import { useStochastic } from "../useStochastic";

function wrapper(engine: ProjectionEngine) {
	const EngineWrapper = wrapperWithEngine(engine);
	return function Wrapper({ children }: { children: ReactNode }) {
		const [queryClient] = useState(
			() =>
				new QueryClient({
					defaultOptions: { queries: { retry: false } },
				}),
		);
		return (
			<QueryClientProvider client={queryClient}>
				<EngineWrapper>{children}</EngineWrapper>
			</QueryClientProvider>
		);
	};
}

function timelineRow(date: string, netWorth: number) {
	return {
		date,
		isHistorical: false,
		netWorth,
		accountSnapshots: [],
		externalInflowAmount: 0,
		externalOutflowAmount: 0,
		internalTransferAmount: 0,
	};
}

function staticDeterministic(): ProjectionResult {
	const rows = [
		timelineRow("2026-02-01", 1600),
		timelineRow("2026-03-01", 1700),
	];
	return {
		timeline: { rows, sampledRows: rows },
		accountSummaries: [],
		totals: {
			externalInflowAmount: 0,
			externalOutflowAmount: 0,
			internalTransferAmount: 0,
		},
		milestones: {
			latestHistoricalDate: null,
			projectionStartDate: "2026-02-01",
		},
		summary: { currentNetWorth: 1600, finalNetWorth: 1700 },
		evaluations: {
			financialIndependence: [
				{
					instanceId: "fi",
					label: "Financial independence",
					status: "satisfied",
					deterministic: null,
					probabilistic: null,
					diagnostics: [],
				},
			],
			netWorthThreshold: [],
			postingFulfillment: [],
		},
	};
}

function staticStochastic(
	deterministic: ProjectionResult = staticDeterministic(),
): StochasticProjectionResult {
	return {
		config: { runCount: 1, seed: 1 },
		deterministic,
		bands: deterministic.timeline.sampledRows.map((row) => ({
			date: row.date,
			isHistorical: false,
			netWorth: {
				p10: row.netWorth - 100,
				p25: row.netWorth - 50,
				p50: row.netWorth,
				p75: row.netWorth + 50,
				p90: row.netWorth + 100,
			},
		})),
		milestones: {
			finalNetWorthPercentiles: {
				p10: 1500,
				p25: 1600,
				p50: 1700,
				p75: 1800,
				p90: 1900,
			},
		},
		evaluations: {
			financialIndependence: [
				{
					instanceId: "fi",
					label: "Financial independence",
					status: "satisfied",
					deterministic: null,
					probabilistic: null,
					diagnostics: [],
				},
			],
			netWorthThreshold: [],
			postingFulfillment: [],
		},
	};
}

describe("projection hook request provenance", () => {
	it("does not restart workers for structurally equal cloned inputs", async () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const engine: ProjectionEngine = {
			project: vi.fn().mockResolvedValue(staticDeterministic()),
			projectStochastic: vi.fn().mockResolvedValue(staticStochastic()),
		};
		const hook = renderHook(
			({ currentDocument, currentSettings }) => ({
				deterministic: useProjection(currentDocument, currentSettings, true),
				stochastic: useStochastic(
					currentDocument,
					currentSettings,
					{ runCount: 1, seed: 1 },
					true,
				),
			}),
			{
				initialProps: {
					currentDocument: document,
					currentSettings: settings,
				},
				wrapper: wrapper(engine),
			},
		);

		await waitFor(() => {
			expect(engine.project).toHaveBeenCalledOnce();
			expect(engine.projectStochastic).toHaveBeenCalledOnce();
		});
		hook.rerender({
			currentDocument: structuredClone(document),
			currentSettings: structuredClone(settings),
		});
		await act(async () => Promise.resolve());

		expect(engine.project).toHaveBeenCalledOnce();
		expect(engine.projectStochastic).toHaveBeenCalledOnce();
	});

	it("passes labels through without restarting workers for label edits", async () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const deterministic = staticDeterministic();
		const stochastic = staticStochastic();
		const engine: ProjectionEngine = {
			project: vi.fn().mockResolvedValue(deterministic),
			projectStochastic: vi.fn().mockResolvedValue(stochastic),
		};
		const hook = renderHook(
			({ currentSettings }) => ({
				deterministic: useProjection(document, currentSettings, true),
				stochastic: useStochastic(
					document,
					currentSettings,
					{ runCount: 1, seed: 1 },
					true,
				),
			}),
			{
				initialProps: { currentSettings: settings },
				wrapper: wrapper(engine),
			},
		);

		await waitFor(() => {
			expect(engine.project).toHaveBeenCalledTimes(1);
			expect(engine.projectStochastic).toHaveBeenCalledTimes(1);
			expect(hook.result.current.deterministic.result).not.toBeNull();
			expect(hook.result.current.stochastic.result).not.toBeNull();
		});
		const labelOnlySettings = structuredClone(settings);
		labelOnlySettings.evaluations.financialIndependence[0]!.label =
			"Retirement readiness";
		hook.rerender({ currentSettings: labelOnlySettings });

		await act(async () => Promise.resolve());
		expect(engine.project).toHaveBeenCalledTimes(1);
		expect(engine.projectStochastic).toHaveBeenCalledTimes(1);
		// Labels pass through from the server response; the client no longer
		// strips and re-adds them, so the mock's original labels are kept.
		expect(
			hook.result.current.deterministic.result?.evaluations
				.financialIndependence[0]?.label,
		).toBe("Financial independence");
		expect(
			hook.result.current.stochastic.result?.evaluations
				.financialIndependence[0]?.label,
		).toBe("Financial independence");
	});

	it("passes server workload labels through to stochastic progress", async () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const completion = deferred<StochasticProjectionResult>();
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
							label: "Financial independence",
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
			() => useStochastic(document, settings, { runCount: 1, seed: 1 }, true),
			{ wrapper: wrapper(engine) },
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
		const deterministic = staticDeterministic();
		const partialResult = staticStochastic();
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
				deterministic: useProjection(document, settings, true),
				stochastic: useStochastic(
					document,
					settings,
					{ runCount: 1, seed: 1 },
					true,
				),
			}),
			{ wrapper: wrapper(engine) },
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
		const firstResult = staticDeterministic();
		const replacement = deferred<ProjectionResult>();
		const engine: ProjectionEngine = {
			project: vi
				.fn()
				.mockResolvedValueOnce(firstResult)
				.mockReturnValueOnce(replacement.promise),
			projectStochastic: vi.fn(),
		};
		const hook = renderHook(
			({ settings }) => useProjection(document, settings, true),
			{
				initialProps: { settings: firstSettings },
				wrapper: wrapper(engine),
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
		const first = deferred<ProjectionResult>();
		const second = deferred<ProjectionResult>();
		const engine: ProjectionEngine = {
			project: vi
				.fn()
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise),
			projectStochastic: vi.fn(),
		};
		const hook = renderHook(
			({ settings }) => useProjection(document, settings, true),
			{
				initialProps: { settings: firstSettings },
				wrapper: wrapper(engine),
			},
		);

		await waitFor(() => expect(engine.project).toHaveBeenCalledTimes(1));
		hook.rerender({ settings: secondSettings });
		await waitFor(() => expect(engine.project).toHaveBeenCalledTimes(2));
		act(() => first.resolve(staticDeterministic()));
		expect(hook.result.current.result).toBeNull();
		act(() => second.resolve(staticDeterministic()));
		await waitFor(() =>
			expect(hook.result.current.result?.timeline.rows.length).toBeGreaterThan(
				0,
			),
		);
	});

	it("ignores obsolete stochastic partial callbacks", async () => {
		const document = createBaseDocument();
		const settings = makeSettings({ horizonYears: 2 });
		const first = deferred<StochasticProjectionResult>();
		const second = deferred<StochasticProjectionResult>();
		const callbacks: Array<
			(
				progress: StochasticProgress,
				partial?: StochasticProjectionResult,
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
			({ config }) => useStochastic(document, settings, config, true),
			{
				initialProps: { config: { runCount: 1, seed: 1 } },
				wrapper: wrapper(engine),
			},
		);

		await waitFor(() => expect(callbacks).toHaveLength(1));
		hook.rerender({ config: { runCount: 2, seed: 1 } });
		await waitFor(() => expect(callbacks).toHaveLength(2));
		const obsolete = staticStochastic();
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
		const current = staticStochastic();
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
