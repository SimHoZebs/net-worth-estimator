// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectionEngineProvider } from "@/engine/ProjectionEngineContext";
import type { ScenarioWhatIfState } from "@/lib/projection";
import { createBasePack, makeSettings } from "@/lib/projection/__fixtures__";
import type { ProjectionEngine } from "@/lib/projection/engine/ProjectionEngine";
import { projectScenarioPack } from "@/lib/projection/engine/scenarioProject";
import { stochasticProject } from "@/lib/projection/engine/stochasticProject";
import { useProjection } from "../useProjection";
import { useStochastic } from "../useStochastic";

const whatIfState: ScenarioWhatIfState = {
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
	it("never exposes an obsolete deterministic result", async () => {
		const pack = createBasePack();
		const firstSettings = makeSettings({ horizonYears: 1 });
		const secondSettings = makeSettings({ horizonYears: 2 });
		const first = deferred<ReturnType<typeof projectScenarioPack>>();
		const second = deferred<ReturnType<typeof projectScenarioPack>>();
		const engine: ProjectionEngine = {
			project: vi
				.fn()
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise),
			projectStochastic: vi.fn(),
		};
		const hook = renderHook(
			({ settings }) => useProjection(pack, settings, whatIfState, true),
			{
				initialProps: { settings: firstSettings },
				wrapper: wrapper(engine),
			},
		);

		await waitFor(() => expect(engine.project).toHaveBeenCalledTimes(1));
		hook.rerender({ settings: secondSettings });
		await waitFor(() => expect(engine.project).toHaveBeenCalledTimes(2));
		act(() =>
			first.resolve(projectScenarioPack(pack, firstSettings, whatIfState)),
		);
		expect(hook.result.current.result).toBeNull();
		act(() =>
			second.resolve(projectScenarioPack(pack, secondSettings, whatIfState)),
		);
		await waitFor(() =>
			expect(hook.result.current.result?.timeline.rows.length).toBeGreaterThan(
				0,
			),
		);
	});

	it("ignores obsolete stochastic partial callbacks", async () => {
		const pack = createBasePack();
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
			({ config }) => useStochastic(pack, settings, whatIfState, config, true),
			{
				initialProps: { config: { runCount: 1, seed: 1 } },
				wrapper: wrapper(engine),
			},
		);

		await waitFor(() => expect(callbacks).toHaveLength(1));
		hook.rerender({ config: { runCount: 2, seed: 1 } });
		await waitFor(() => expect(callbacks).toHaveLength(2));
		const obsolete = stochasticProject(pack, settings, whatIfState, {
			runCount: 1,
			seed: 1,
		});
		act(() => callbacks[0](1, obsolete));
		expect(hook.result.current.result).toBeNull();
		const current = stochasticProject(pack, settings, whatIfState, {
			runCount: 2,
			seed: 1,
		});
		act(() => callbacks[1](0.5, current));
		expect(hook.result.current.result).toBe(current);
	});
});
