import { memo, useCallback, useEffect, useMemo } from "react";
import { Outlet } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import {
	useFinancialModelMutation,
	useFinancialModelQuery,
} from "@/hooks/useFinancialModel";
import { useIncomeDataQuery } from "@/hooks/useIncomeData";
import { useServerStatusQuery } from "@/hooks/useServerStatus";
import { getAuthToken } from "@/lib/auth-token";
import type { TemplateOutput } from "@/lib/patterns";
import { summarizeValidationIssues } from "@/lib/projection";
import {
	createHttpFinancialModelRepository,
	withoutWriteCapabilities,
} from "@/lib/projection/sources/http/httpFinancialModelRepository";
import { createHttpIncomeDataSource } from "@/lib/projection/sources/http/httpIncomeDataSource";
import {
	ModelRuntimeProvider,
	type ModelSourceInfo,
} from "@/runtime/modelRuntime";
import { ProjectionRuntimeProvider } from "@/runtime/projectionRuntime";
import { useProjectionOrchestration } from "@/runtime/useProjectionOrchestration";
import { useStore } from "@/store";
import { useThemeStore } from "@/themeStore";

function createModelRepository() {
	return createHttpFinancialModelRepository({ getAuthToken });
}

function createIncomeDataSource() {
	return createHttpIncomeDataSource();
}

export default function App() {
	const baseRepository = useMemo(() => createModelRepository(), []);
	const { data: serverStatus } = useServerStatusQuery();
	// On fetch failure data stays undefined and write UI stays visible;
	// the server enforces read-only itself.
	const serverReadOnly = serverStatus?.readOnly ?? false;
	const modelRepository = useMemo(
		() =>
			serverReadOnly
				? withoutWriteCapabilities(baseRepository)
				: baseRepository,
		[baseRepository, serverReadOnly],
	);
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
	const saveModel = modelMutation.mutate;
	const isSaving = modelMutation.isPending;
	const document = modelData?.document ?? null;
	const issues = useMemo(() => {
		// Diagnostics come from the Go backend (model + income endpoints);
		// the client performs no business-rule validation of its own.
		const candidates = [
			...(modelData?.issues ?? []),
			...(incomeDataResult?.issues ?? []),
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
	const sourceActionError = modelMutation.error?.message ?? null;
	const isSourceUpdating = isModelFetching || isIncomeDataFetching;
	const isLoading = isModelLoading || isIncomeDataLoading || isSourceUpdating;
	const syncEvaluationsFromDocument = useStore(
		(state) => state.syncEvaluationsFromDocument,
	);
	const lastEvaluationSyncAt = useStore((state) => state.lastEvaluationSyncAt);
	const finishEditing = useStore((state) => state.finishEditing);
	const syncSystemTheme = useThemeStore((state) => state.syncSystemTheme);

	// Session evaluations are the single truth for projection and UI (see
	// store.ts). Sync them from the loaded document; the store guard makes
	// repeat calls with the same timestamp no-ops, so session edits survive
	// re-renders while reloads re-seed.
	useEffect(() => {
		if (document)
			syncEvaluationsFromDocument(document.evaluations, dataUpdatedAt);
	}, [document, dataUpdatedAt, syncEvaluationsFromDocument]);
	const evaluationsAreHydrated =
		document === null || lastEvaluationSyncAt === dataUpdatedAt;
	const requestEvaluationReload = useCallback(() => {
		if (document)
			syncEvaluationsFromDocument(document.evaluations, dataUpdatedAt, {
				force: true,
			});
	}, [document, dataUpdatedAt, syncEvaluationsFromDocument]);

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
			reload: handleReload,
			save: handleSave,
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
			handleReload,
			handleSave,
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
