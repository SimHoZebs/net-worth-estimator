import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useProjection } from "@/hooks/useProjection";
import { useStochastic } from "@/hooks/useStochastic";
import {
	applyModelOverrides,
	EVALUATION_TYPE_ORDER,
	type FinancialModelDocument,
} from "@/lib/projection";
import type {
	ProjectionArtifacts,
	ProjectionCapabilities,
	ProjectionExecution,
} from "@/runtime/projectionRuntime";
import {
	selectCurrentChangeCount,
	selectModelOverrides,
	useStore,
} from "@/store";

function formatTodayIsoDate() {
	return new Date().toISOString().slice(0, 10);
}

const HORIZON_DEBOUNCE_MS = 200;

export function useProjectionOrchestration({
	document,
	validationIsValid,
	evaluationsAreHydrated,
	isSourceUpdating,
}: {
	document: FinancialModelDocument | null;
	validationIsValid: boolean;
	evaluationsAreHydrated: boolean;
	isSourceUpdating: boolean;
}) {
	const modelOverrides = useStore(useShallow(selectModelOverrides));
	const {
		currentChangeCount,
		evaluations,
		horizonYears,
		stochasticPreference,
		stochasticConfig,
	} = useStore(
		useShallow((state) => ({
			currentChangeCount: selectCurrentChangeCount(state),
			evaluations: state.evaluations,
			horizonYears: state.horizonYears,
			stochasticPreference: state.stochasticPreference,
			stochasticConfig: state.stochasticConfig,
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
		() => (document ? applyModelOverrides(document, modelOverrides) : null),
		[document, modelOverrides],
	);
	const {
		result,
		runtimeError,
		isRunning: isProjecting,
		resultIsStale: projectionResultIsStale,
	} = useProjection(
		document,
		projectionSettings,
		modelOverrides,
		validationIsValid && evaluationsAreHydrated,
	);
	const hasStochasticAccounts =
		effectiveDocument?.postings.some(
			(posting) => posting.volatility > 0 && posting.enabled,
		) ?? false;
	const stochasticWorkerEnabled =
		stochasticPreference !== "disabled" &&
		hasStochasticAccounts &&
		validationIsValid &&
		evaluationsAreHydrated;
	const {
		result: stochasticResult,
		runtimeError: stochasticError,
		isRunning: isStochasticRunning,
		progress: stochasticProgress,
		resultIsStale: stochasticResultIsStale,
	} = useStochastic(
		document,
		projectionSettings,
		modelOverrides,
		stochasticConfig,
		stochasticWorkerEnabled,
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
	const artifacts = useMemo<ProjectionArtifacts>(
		() => ({
			result,
			projectionResultIsStale,
			stochasticResult,
			stochasticResultIsStale,
			stochasticIsProvisional,
			currentMetrics,
		}),
		[
			result,
			projectionResultIsStale,
			stochasticResult,
			stochasticResultIsStale,
			stochasticIsProvisional,
			currentMetrics,
		],
	);
	const execution = useMemo<ProjectionExecution>(
		() => ({
			runtimeError,
			isProjecting,
			stochasticError,
			isStochasticRunning,
		}),
		[runtimeError, isProjecting, stochasticError, isStochasticRunning],
	);
	const capabilities = useMemo<ProjectionCapabilities>(
		() => ({
			hasStochasticAccounts,
			hasStochasticResult,
			canCaptureComparison:
				!isProjecting && !isStochasticRunning && !isSourceUpdating,
		}),
		[
			hasStochasticAccounts,
			hasStochasticResult,
			isProjecting,
			isStochasticRunning,
			isSourceUpdating,
		],
	);

	return {
		effectiveDocument,
		projectionStartDate,
		artifacts,
		execution,
		capabilities,
		stochasticProgress,
	};
}
