// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjection } from "@/hooks/useProjection";
import { useStochastic } from "@/hooks/useStochastic";
import {
	createBaseDocument,
	makePosting,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import { projectFinancialModelDocument } from "@/lib/projection/analysis/projectFinancialModel";
import { useStore } from "@/store";
import { useProjectionOrchestration } from "./useProjectionOrchestration";

vi.mock("@/hooks/useProjection", () => ({ useProjection: vi.fn() }));
vi.mock("@/hooks/useStochastic", () => ({ useStochastic: vi.fn() }));

const initialStoreState = useStore.getInitialState();
const emptyOverrides = {
	addedAccounts: [],
	addedPostings: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

describe("useProjectionOrchestration", () => {
	beforeEach(() => {
		useStore.setState(initialStoreState, true);
		vi.mocked(useProjection).mockReset();
		vi.mocked(useStochastic).mockReset();
		vi.mocked(useProjection).mockReturnValue({
			result: null,
			runtimeError: null,
			isRunning: false,
			progress: null,
			resultIsStale: false,
		});
		vi.mocked(useStochastic).mockReturnValue({
			result: null,
			runtimeError: null,
			isRunning: false,
			progress: null,
			resultIsStale: false,
		});
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("owns worker enablement and projection capability derivation", () => {
		const document = createBaseDocument({
			postings: [
				makePosting({
					id: "variable-income",
					destinations: ["checking"],
					volatility: 0.15,
				}),
			],
		});

		const { result } = renderHook(() =>
			useProjectionOrchestration({
				document,
				validationIsValid: true,
				evaluationsAreHydrated: true,
				isSourceUpdating: true,
			}),
		);

		expect(vi.mocked(useProjection).mock.calls[0]?.[3]).toBe(false);
		expect(vi.mocked(useStochastic).mock.calls[0]?.[4]).toBe(false);
		expect(result.current.effectiveDocument).toEqual(document);
		expect(result.current.capabilities).toEqual({
			hasStochasticAccounts: true,
			hasStochasticResult: false,
			canCaptureComparison: false,
		});
	});

	it("constructs execution and stale-safe comparison values", () => {
		const document = createBaseDocument();
		const projectionResult = projectFinancialModelDocument(
			document,
			makeSettings(),
			emptyOverrides,
		);
		useStore.setState({ disabledPostingIds: ["salary"] });
		vi.mocked(useProjection).mockReturnValue({
			result: projectionResult,
			runtimeError: "projection warning",
			isRunning: true,
			progress: null,
			resultIsStale: true,
		});

		const { result } = renderHook(() =>
			useProjectionOrchestration({
				document,
				validationIsValid: true,
				evaluationsAreHydrated: true,
				isSourceUpdating: false,
			}),
		);

		expect(result.current.execution).toEqual({
			runtimeError: "projection warning",
			isProjecting: true,
			stochasticError: null,
			isStochasticRunning: false,
		});
		expect(result.current.artifacts.currentMetrics).toEqual({
			currentNetWorth: projectionResult.summary.currentNetWorth,
			finalNetWorth: projectionResult.summary.finalNetWorth,
			evaluationOutcomes: [],
			currentChangeCount: 1,
		});
		expect(result.current.artifacts.projectionResultIsStale).toBe(true);
	});

	it("waits for horizon changes to settle before restarting projections", () => {
		vi.useFakeTimers();
		const document = createBaseDocument();
		const initialHorizon = useStore.getState().horizonYears;
		renderHook(() =>
			useProjectionOrchestration({
				document,
				validationIsValid: true,
				evaluationsAreHydrated: true,
				isSourceUpdating: false,
			}),
		);

		act(() => useStore.getState().setHorizonYears(initialHorizon + 1));
		act(() => vi.advanceTimersByTime(100));
		act(() => useStore.getState().setHorizonYears(initialHorizon + 2));
		act(() => vi.advanceTimersByTime(100));
		act(() => useStore.getState().setHorizonYears(initialHorizon + 3));

		expect(useStore.getState().horizonYears).toBe(initialHorizon + 3);
		expect(vi.mocked(useProjection).mock.lastCall?.[1].horizonYears).toBe(
			initialHorizon,
		);
		expect(vi.mocked(useStochastic).mock.lastCall?.[1].horizonYears).toBe(
			initialHorizon,
		);

		act(() => vi.advanceTimersByTime(199));
		expect(vi.mocked(useProjection).mock.lastCall?.[1].horizonYears).toBe(
			initialHorizon,
		);

		act(() => vi.advanceTimersByTime(1));
		expect(vi.mocked(useProjection).mock.lastCall?.[1].horizonYears).toBe(
			initialHorizon + 3,
		);
		expect(vi.mocked(useStochastic).mock.lastCall?.[1].horizonYears).toBe(
			initialHorizon + 3,
		);
	});

	it("clears a pending horizon update on unmount", () => {
		vi.useFakeTimers();
		const { unmount } = renderHook(() =>
			useProjectionOrchestration({
				document: createBaseDocument(),
				validationIsValid: true,
				evaluationsAreHydrated: true,
				isSourceUpdating: false,
			}),
		);

		expect(vi.getTimerCount()).toBe(0);
		act(() => useStore.getState().setHorizonYears(25));
		expect(vi.getTimerCount()).toBe(1);

		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});
