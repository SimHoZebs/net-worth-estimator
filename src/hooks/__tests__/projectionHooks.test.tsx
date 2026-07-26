// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectionEngineProvider } from "@/engine/ProjectionEngineContext";
import type { ModelOverrides } from "@/lib/projection";
import {
	createBaseDocument,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import { projectFinancialModelDocument } from "@/lib/projection/analysis/projectFinancialModel";
import { stochasticProject } from "@/lib/projection/analysis/projectStochastic";
import type { ProjectionEngine } from "@/lib/projection/runtime/ProjectionEngine";
import { useProjection } from "../useProjection";
import { useStochastic } from "../useStochastic";

const overrides: ModelOverrides = {
	addedAccounts: [],
	addedPostings: [],
	addedCheckpoints: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((fulfill) => {
		resolve = fulfill;
	});
	return { promise, resolve };
}

function wrapper(engine: ProjectionEngine) {
	return function EngineWrapper({ children }: { children: ReactNode }) {
		return (
			<ProjectionEngineProvider engine={engine}>
				{children}
			</ProjectionEngineProvider>
		);
	};
}

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
				wrapper: wrapper(engine),
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
				wrapper: wrapper(engine),
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
			(progress: number, partial?: ReturnType<typeof stochasticProject>) => void
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
				wrapper: wrapper(engine),
			},
		);

		await waitFor(() => expect(callbacks).toHaveLength(1));
		hook.rerender({ config: { runCount: 2, seed: 1 } });
		await waitFor(() => expect(callbacks).toHaveLength(2));
		const obsolete = stochasticProject(document, settings, overrides, {
			runCount: 1,
			seed: 1,
		});
		act(() => callbacks[0](1, obsolete));
		expect(hook.result.current.result).toBeNull();
		const current = stochasticProject(document, settings, overrides, {
			runCount: 2,
			seed: 1,
		});
		act(() => callbacks[1](0.5, current));
		expect(hook.result.current.result?.bands).toEqual(current.bands);
	});
});
