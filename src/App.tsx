import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Outlet } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import {
	useFinancialModelMutation,
	useFinancialModelQuery,
	useFinancialModelResetMutation,
} from "@/hooks/useFinancialModel";
import type { TemplateOutput } from "@/lib/patterns";
import {
	createBrowserCsvDataSource,
	createCsvDataSource,
	summarizeValidationIssues,
} from "@/lib/projection";
import {
	ModelRuntimeProvider,
	type ModelSourceInfo,
} from "@/runtime/modelRuntime";
import { ProjectionRuntimeProvider } from "@/runtime/projectionRuntime";
import { useProjectionOrchestration } from "@/runtime/useProjectionOrchestration";
import { useStore } from "@/store";

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
	const replaceEvaluations = useStore((state) => state.replaceEvaluations);

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
	});

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
