import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Outlet } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import {
	useFinancialModelMutation,
	useFinancialModelQuery,
	useFinancialModelResetMutation,
} from "@/hooks/useFinancialModel";
import { useIncomeDataQuery } from "@/hooks/useIncomeData";
import type { TemplateOutput } from "@/lib/patterns";
import {
	createBrowserFinancialModelRepository,
	createCsvApiFinancialModelRepository,
	createCsvIncomeDataSource,
	INCOME_DATA_API_PATH,
	summarizeValidationIssues,
	validateCsvFinancialModel,
} from "@/lib/projection";
import {
	ModelRuntimeProvider,
	type ModelSourceInfo,
} from "@/runtime/modelRuntime";
import { ProjectionRuntimeProvider } from "@/runtime/projectionRuntime";
import { useProjectionOrchestration } from "@/runtime/useProjectionOrchestration";
import { useStore } from "@/store";

function createModelRepository() {
	return import.meta.env.DEV
		? createCsvApiFinancialModelRepository()
		: createBrowserFinancialModelRepository();
}

function createIncomeDataSource() {
	return createCsvIncomeDataSource(
		import.meta.env.DEV ? { basePath: INCOME_DATA_API_PATH } : undefined,
	);
}

export default function App() {
	const modelRepository = useMemo(() => createModelRepository(), []);
	const incomeDataSource = useMemo(() => createIncomeDataSource(), []);
	const {
		data: modelData,
		isLoading: isModelLoading,
		isFetching: isModelFetching,
		error: modelError,
		refetch: refetchModel,
		dataUpdatedAt,
	} = useFinancialModelQuery(modelRepository);
	const {
		data: incomeDataResult,
		isLoading: isIncomeDataLoading,
		isFetching: isIncomeDataFetching,
		error: incomeDataError,
		refetch: refetchIncomeData,
	} = useIncomeDataQuery(incomeDataSource);
	const modelMutation = useFinancialModelMutation(modelRepository);
	const modelResetMutation = useFinancialModelResetMutation(modelRepository);
	const saveModel = modelMutation.mutate;
	const resetModel = modelResetMutation.mutate;
	const isSaving = modelMutation.isPending;
	const isResetting = modelResetMutation.isPending;
	const document = modelData?.document ?? null;
	const issues = useMemo(() => {
		const modelIssues = modelData?.issues ?? [];
		const candidates = [
			...modelIssues,
			...(incomeDataResult?.issues ?? []),
			...(modelData?.document && incomeDataResult?.data
				? validateCsvFinancialModel(modelData.document, incomeDataResult.data)
				: []),
		];
		const seen = new Set<string>();
		return candidates.filter((issue) => {
			const key = `${issue.severity}:${issue.code}:${issue.path.join(".")}:${issue.message}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}, [incomeDataResult, modelData]);
	const loadError = modelError?.message ?? incomeDataError?.message ?? null;
	const sourceActionError =
		modelMutation.error?.message ?? modelResetMutation.error?.message ?? null;
	const isSourceUpdating =
		isModelFetching || isIncomeDataFetching || modelResetMutation.isPending;
	const isLoading = isModelLoading || isIncomeDataLoading || isSourceUpdating;
	const replaceEvaluations = useStore((state) => state.replaceEvaluations);
	const finishEditing = useStore((state) => state.finishEditing);
	const syncSystemTheme = useStore((state) => state.syncSystemTheme);

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
		const handleChange = () => syncSystemTheme();
		media.addEventListener("change", handleChange);
		syncSystemTheme();
		return () => media.removeEventListener("change", handleChange);
	}, [syncSystemTheme]);

	const validation = summarizeValidationIssues(issues);
	const {
		effectiveDocument,
		projectionStartDate,
		artifacts: projectionArtifacts,
		execution: projectionExecution,
		capabilities: projectionCapabilities,
		stochasticProgress,
	} = useProjectionOrchestration({
		document,
		validationIsValid: validation.isValid,
		evaluationsAreHydrated,
		isSourceUpdating,
		incomeData: incomeDataResult?.data ?? undefined,
		incomeDataReady:
			incomeDataResult?.data !== null && incomeDataResult?.data !== undefined,
	});

	const handleSave = useCallback(() => {
		const store = useStore.getState();
		if (!store.workingDocument || isSaving || !modelRepository.save) return;
		saveModel(store.workingDocument, {
			onSuccess: finishEditing,
		});
	}, [finishEditing, isSaving, modelRepository.save, saveModel]);
	const handleResetSource = useCallback(() => {
		if (!modelRepository.reset || isResetting) return;
		requestEvaluationReload();
		resetModel(undefined, {
			onSuccess: finishEditing,
		});
	}, [
		modelRepository.reset,
		finishEditing,
		isResetting,
		requestEvaluationReload,
		resetModel,
	]);
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
		void refetchIncomeData();
	}, [refetchIncomeData, refetchModel, requestEvaluationReload]);

	const source = useMemo<ModelSourceInfo>(
		() => ({
			label: modelRepository.label,
			description: modelRepository.description,
			repositoryType: modelRepository.repositoryType,
			saveLabel: modelRepository.save?.label ?? null,
			resetLabel: modelRepository.reset?.label ?? null,
		}),
		[modelRepository],
	);
	const modelRuntime = useMemo(
		() => ({
			source,
			document,
			incomeData: incomeDataResult?.data ?? null,
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
			reset: modelRepository.reset ? handleResetSource : undefined,
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
			modelRepository.reset,
			handleResetSource,
			handleApplyTemplate,
			incomeDataResult?.data,
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
