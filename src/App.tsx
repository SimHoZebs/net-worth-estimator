import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Outlet } from "react-router-dom";
import { useShallow } from "zustand/shallow";
import { AppShell } from "@/components/AppShell";
import {
	useFinancialModelMutation,
	useFinancialModelQuery,
	useFinancialModelResetMutation,
} from "@/hooks/useFinancialModel";
import { useProjection } from "@/hooks/useProjection";
import { useStochastic } from "@/hooks/useStochastic";
import type { TemplateOutput } from "@/lib/patterns";
import {
	applyModelOverrides,
	createBrowserCsvDataSource,
	createCsvDataSource,
	EVALUATION_TYPE_ORDER,
	summarizeValidationIssues,
} from "@/lib/projection";
import {
	ModelRuntimeProvider,
	type ModelSourceInfo,
} from "@/runtime/modelRuntime";
import {
	type ProjectionArtifacts,
	type ProjectionCapabilities,
	type ProjectionExecution,
	ProjectionRuntimeProvider,
} from "@/runtime/projectionRuntime";
import {
	selectCurrentChangeCount,
	selectModelOverrides,
	useStore,
} from "@/store";

function formatTodayIsoDate() {
	return new Date().toISOString().slice(0, 10);
}

function createModelDataSource() {
	return import.meta.env.DEV
		? createCsvDataSource()
		: createBrowserCsvDataSource();
}

export default function App() {
	const dataSource = useMemo(() => createModelDataSource(), []);
	const {
		data: modelData,
		isLoading: isModelLoading,
		isFetching: isModelFetching,
		error: modelError,
		refetch: refetchModel,
		dataUpdatedAt,
	} = useFinancialModelQuery(dataSource);
	const modelMutation = useFinancialModelMutation(dataSource);
	const modelResetMutation = useFinancialModelResetMutation(dataSource);
	const saveModel = modelMutation.mutate;
	const resetModel = modelResetMutation.mutate;
	const isSaving = modelMutation.isPending;
	const isResetting = modelResetMutation.isPending;
	const document = modelData?.document ?? null;
	const issues = useMemo(() => modelData?.issues ?? [], [modelData?.issues]);
	const loadError = modelError?.message ?? null;
	const sourceActionError =
		modelMutation.error?.message ?? modelResetMutation.error?.message ?? null;
	const isSourceUpdating = isModelFetching || modelResetMutation.isPending;
	const isLoading = isModelLoading || isSourceUpdating;
	const modelOverrides = useStore(useShallow(selectModelOverrides));
	const {
		currentChangeCount,
		evaluations,
		horizonYears,
		replaceEvaluations,
		stochasticPreference,
		stochasticConfig,
	} = useStore(
		useShallow((state) => ({
			currentChangeCount: selectCurrentChangeCount(state),
			evaluations: state.evaluations,
			horizonYears: state.horizonYears,
			replaceEvaluations: state.replaceEvaluations,
			stochasticPreference: state.stochasticPreference,
			stochasticConfig: state.stochasticConfig,
		})),
	);

	const sourceEvaluationsFingerprint = document
		? JSON.stringify(document.evaluations)
		: null;
	const loadedEvaluationsFingerprint = useRef<string | null>(null);
	useEffect(() => {
		if (
			document &&
			sourceEvaluationsFingerprint !== loadedEvaluationsFingerprint.current
		) {
			replaceEvaluations(document.evaluations);
			loadedEvaluationsFingerprint.current = sourceEvaluationsFingerprint;
		}
	}, [document, replaceEvaluations, sourceEvaluationsFingerprint]);
	const evaluationsAreHydrated =
		document === null ||
		loadedEvaluationsFingerprint.current === sourceEvaluationsFingerprint;
	const requestEvaluationReload = useCallback(() => {
		if (!document) return;
		replaceEvaluations(document.evaluations);
		loadedEvaluationsFingerprint.current = sourceEvaluationsFingerprint;
	}, [document, replaceEvaluations, sourceEvaluationsFingerprint]);

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = () => {
			if (useStore.getState().theme !== "system") return;
			const resolved = media.matches ? "dark" : "light";
			window.document.documentElement.classList.toggle(
				"dark",
				resolved === "dark",
			);
			useStore.setState({ resolvedTheme: resolved });
		};
		media.addEventListener("change", handleChange);
		return () => media.removeEventListener("change", handleChange);
	}, []);

	const validation = summarizeValidationIssues(issues);
	const fallbackProjectionStartDate = useMemo(() => formatTodayIsoDate(), []);
	const projectionSettings = useMemo(
		() => ({ fallbackProjectionStartDate, horizonYears, evaluations }),
		[fallbackProjectionStartDate, horizonYears, evaluations],
	);
	const effectiveDocument = useMemo(
		() => (document ? applyModelOverrides(document, modelOverrides) : null),
		[document, modelOverrides],
	);
	const projectionStartDate = fallbackProjectionStartDate;
	const {
		result,
		runtimeError,
		isRunning: isProjecting,
		resultIsStale: projectionResultIsStale,
	} = useProjection(
		document,
		projectionSettings,
		modelOverrides,
		validation.isValid && evaluationsAreHydrated,
	);
	const hasStochasticAccounts =
		effectiveDocument?.postings.some(
			(posting) => posting.volatility > 0 && posting.enabled,
		) ?? false;
	const stochasticWorkerEnabled =
		stochasticPreference !== "disabled" &&
		hasStochasticAccounts &&
		validation.isValid &&
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

	const handleSave = useCallback(() => {
		const store = useStore.getState();
		if (!store.workingDocument || isSaving || !dataSource.save) return;
		saveModel(store.workingDocument, {
			onSuccess: () =>
				useStore.setState({
					isDirty: false,
					isEditing: false,
					workingDocument: null,
				}),
		});
	}, [dataSource.save, isSaving, saveModel]);
	const handleResetSource = useCallback(() => {
		if (!dataSource.reset || isResetting) return;
		requestEvaluationReload();
		resetModel(undefined, {
			onSuccess: () =>
				useStore.setState({
					isDirty: false,
					isEditing: false,
					workingDocument: null,
				}),
		});
	}, [dataSource.reset, isResetting, requestEvaluationReload, resetModel]);
	const handleApplyTemplate = useCallback(
		(output: TemplateOutput) => {
			const store = useStore.getState();
			if (!store.isEditing && document) store.startEditing(document);
			for (const account of output.accounts)
				useStore.getState().addAccount(account);
			for (const posting of output.postings)
				useStore.getState().addPosting(posting);
		},
		[document],
	);
	const handleReload = useCallback(() => {
		requestEvaluationReload();
		void refetchModel();
	}, [refetchModel, requestEvaluationReload]);

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

	const source = useMemo<ModelSourceInfo>(
		() => ({
			label: dataSource.label,
			description: dataSource.description,
			sourceType: dataSource.sourceType,
			saveLabel: dataSource.save?.label ?? null,
			resetLabel: dataSource.reset?.label ?? null,
		}),
		[dataSource],
	);
	const modelRuntime = useMemo(
		() => ({
			source,
			document,
			effectiveDocument,
			issues,
			validationIsValid: validation.isValid,
			loadError,
			sourceActionError,
			isLoading,
			isSourceUpdating,
			dataUpdatedAt,
			projectionStartDate,
			isSaving,
			isResetting,
			reload: handleReload,
			save: handleSave,
			reset: dataSource.reset ? handleResetSource : undefined,
			applyTemplate: handleApplyTemplate,
		}),
		[
			source,
			document,
			effectiveDocument,
			issues,
			validation.isValid,
			loadError,
			sourceActionError,
			isLoading,
			isSourceUpdating,
			dataUpdatedAt,
			projectionStartDate,
			isSaving,
			isResetting,
			handleReload,
			handleSave,
			dataSource.reset,
			handleResetSource,
			handleApplyTemplate,
		],
	);
	const projectionArtifacts = useMemo<ProjectionArtifacts>(
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
	const projectionExecution = useMemo<ProjectionExecution>(
		() => ({
			runtimeError,
			isProjecting,
			stochasticError,
			isStochasticRunning,
		}),
		[runtimeError, isProjecting, stochasticError, isStochasticRunning],
	);
	const projectionCapabilities = useMemo<ProjectionCapabilities>(
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

	return (
		<ModelRuntimeProvider value={modelRuntime}>
			<ProjectionRuntimeProvider
				artifacts={projectionArtifacts}
				execution={projectionExecution}
				capabilities={projectionCapabilities}
				stochasticProgress={stochasticProgress}
			>
				<RoutedShell />
			</ProjectionRuntimeProvider>
		</ModelRuntimeProvider>
	);
}

const RoutedShell = memo(function RoutedShell() {
	return (
		<AppShell>
			<Outlet />
		</AppShell>
	);
});
