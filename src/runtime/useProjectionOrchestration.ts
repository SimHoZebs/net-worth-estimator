import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useProjection } from "@/hooks/useProjection";
import { useStochastic } from "@/hooks/useStochastic";
import {
	EVALUATION_TYPE_ORDER,
	type FinancialModelDocument,
} from "@/lib/projection";
import type { IncomeDataSnapshot } from "@/lib/projection/types/income";
import { selectCurrentChangeCount, useStore } from "@/store";

function formatTodayIsoDate() {
	return new Date().toISOString().slice(0, 10);
}

const HORIZON_DEBOUNCE_MS = 200;

export function useProjectionOrchestration({
	document,
	validationIsValid,
	evaluationsAreHydrated,
	isSourceUpdating,
	incomeData,
	incomeDataReady = true,
}: {
	document: FinancialModelDocument | null;
	validationIsValid: boolean;
	evaluationsAreHydrated: boolean;
	isSourceUpdating: boolean;
	incomeData?: IncomeDataSnapshot;
	incomeDataReady?: boolean;
}) {
	const {
		currentChangeCount,
		evaluations,
		horizonYears,
		stochasticPreference,
		stochasticConfig,
		workingDocument,
	} = useStore(
		useShallow((state) => ({
			currentChangeCount: selectCurrentChangeCount(state),
			evaluations: state.evaluations,
			horizonYears: state.horizonYears,
			stochasticPreference: state.stochasticPreference,
			stochasticConfig: state.stochasticConfig,
			workingDocument: state.workingDocument,
		})),
	);
	const projectionStartDate = useMemo(() => formatTodayIsoDate(), []);
	const settledHorizonYears = useDebouncedValue(
		horizonYears,
		HORIZON_DEBOUNCE_MS,
	);
	const projectionSettings = useMemo(
		() => ({
			fallbackProjectionStartDate: projectionStartDate,
			horizonYears: settledHorizonYears,
			evaluations,
		}),
		[projectionStartDate, settledHorizonYears, evaluations],
	);
	const effectiveDocument = useMemo(
		() => workingDocument ?? document,
		[document, workingDocument],
	);
	const {
		result,
		runtimeError,
		isRunning: isProjecting,
		resultIsStale: projectionResultIsStale,
	} = useProjection(
		effectiveDocument,
		projectionSettings,
		validationIsValid &&
			evaluationsAreHydrated &&
			incomeDataReady &&
			!isSourceUpdating,
		incomeData,
	);
	const hasStochasticAccounts =
		effectiveDocument?.postings.some(
			(posting) => posting.volatility > 0 && posting.enabled,
		) ?? false;
	const stochasticEnabled =
		stochasticPreference !== "disabled" &&
		hasStochasticAccounts &&
		validationIsValid &&
		evaluationsAreHydrated &&
		incomeDataReady &&
		!isSourceUpdating;
	const {
		result: stochasticResult,
		runtimeError: stochasticError,
		isRunning: isStochasticRunning,
		progress: stochasticProgress,
		resultIsStale: stochasticResultIsStale,
	} = useStochastic(
		effectiveDocument,
		projectionSettings,
		stochasticConfig,
		stochasticEnabled,
		incomeData,
	);
	const stochasticIsProvisional =
		isStochasticRunning &&
		stochasticResult !== null &&
		!stochasticResultIsStale;
	const hasStochasticResult = stochasticResult !== null;

	const currentMetrics = useMemo(() => {
		const evaluationResults =
			stochasticResult && !stochasticResultIsStale
				? stochasticResult
				: projectionResultIsStale
					? null
					: result;
		return {
			currentNetWorth: result?.summary.currentNetWorth ?? 0,
			finalNetWorth: result?.summary.finalNetWorth ?? 0,
			evaluationOutcomes:
				evaluationResults === null
					? []
					: EVALUATION_TYPE_ORDER.flatMap(
							(type) =>
								evaluationResults?.evaluations[type].map((envelope) => ({
									instanceId: envelope.instanceId,
									label:
										evaluations[type].find(
											(item) => item.instanceId === envelope.instanceId,
										)?.label ?? envelope.label,
									status: envelope.status,
								})) ?? [],
						),
			currentChangeCount,
		};
	}, [
		currentChangeCount,
		evaluations,
		projectionResultIsStale,
		result,
		stochasticResult,
		stochasticResultIsStale,
	]);

	return {
		effectiveDocument,
		projectionStartDate,
		artifacts: {
			result,
			projectionResultIsStale,
			stochasticResult,
			stochasticResultIsStale,
			stochasticIsProvisional,
			currentMetrics,
		},
		execution: {
			runtimeError,
			isProjecting,
			stochasticError,
			isStochasticRunning,
		},
		capabilities: {
			hasStochasticAccounts,
			hasStochasticResult,
			canCaptureComparison:
				!isProjecting && !isStochasticRunning && !isSourceUpdating,
		},
		stochasticProgress,
	};
}
