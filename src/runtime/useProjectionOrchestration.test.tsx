// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

		expect(vi.mocked(useProjection).mock.calls[0]?.[3]).toBe(true);
		expect(vi.mocked(useStochastic).mock.calls[0]?.[4]).toBe(true);
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
});
