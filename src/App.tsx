import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import {
	applyModelOverrides,
	createBrowserCsvDataSource,
	createCsvDataSource,
	EVALUATION_TYPE_ORDER,
	type ProjectionRuntimeSettings,
} from "@/lib/projection";
import { CurrentChangesComparison } from "./components/CurrentChangesComparison";
import { CurrentChangesControls } from "./components/CurrentChangesControls";
import { ModelInputsInspector } from "./components/ModelInputsInspector";
import { ProjectionDashboard } from "./components/ProjectionDashboard";
import { TemplateWizard } from "./components/patterns/TemplateWizard";
import { SectionNav } from "./components/SectionNav";
import { ProjectionConfigSidebar } from "./components/sidebar/ProjectionConfigSidebar";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { LazySection } from "./components/ui/lazy-section";
import {
	useFinancialModelMutation,
	useFinancialModelQuery,
	useFinancialModelResetMutation,
} from "./hooks/useFinancialModel";
import { useProjection } from "./hooks/useProjection";
import { useStochastic } from "./hooks/useStochastic";
import { summarizeValidationIssues } from "./lib/projection";
import {
	selectCurrentChangeCount,
	selectModelOverrides,
	useStore,
} from "./store";

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

	const document = modelData?.document ?? null;
	const issues = modelData?.issues ?? [];
	const loadError = modelError?.message ?? null;
	const sourceActionError =
		modelMutation.error?.message ?? modelResetMutation.error?.message ?? null;
	const isSourceUpdating = isModelFetching || modelResetMutation.isPending;
	const isLoading = isModelLoading || isSourceUpdating;

	const modelOverrides = useStore(useShallow(selectModelOverrides));
	const {
		currentChangeCount,
		isEditing,
		isDirty,
		evaluations,
		horizonYears,
		setHorizonYears,
		replaceEvaluations,
		stochasticPreference,
		stochasticConfig,
		theme,
		setTheme,
	} = useStore(
		useShallow((s) => ({
			currentChangeCount: selectCurrentChangeCount(s),
			isEditing: s.isEditing,
			isDirty: s.isDirty,
			evaluations: s.evaluations,
			horizonYears: s.horizonYears,
			setHorizonYears: s.setHorizonYears,
			replaceEvaluations: s.replaceEvaluations,
			stochasticPreference: s.stochasticPreference,
			stochasticConfig: s.stochasticConfig,
			theme: s.theme,
			setTheme: s.setTheme,
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
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = () => {
			if (useStore.getState().theme === "system") {
				const resolved = mq.matches ? "dark" : "light";
				window.document.documentElement.classList.toggle(
					"dark",
					resolved === "dark",
				);
				useStore.setState({ resolvedTheme: resolved });
			}
		};
		mq.addEventListener("change", handleChange);
		return () => mq.removeEventListener("change", handleChange);
	}, []);

	const validation = summarizeValidationIssues(issues);
	const fallbackProjectionStartDate = useMemo(() => formatTodayIsoDate(), []);
	const projectionSettings = useMemo(
		() => ({
			fallbackProjectionStartDate,
			horizonYears,
			evaluations,
		}),
		[fallbackProjectionStartDate, horizonYears, evaluations],
	);
	const effectiveDocument = useMemo(
		() => (document ? applyModelOverrides(document, modelOverrides) : null),
		[document, modelOverrides],
	);
	const projectionStartDate =
		effectiveDocument?.checkpoints.reduce<string | null>(
			(latestDate, checkpoint) =>
				latestDate === null || checkpoint.Date > latestDate
					? checkpoint.Date
					: latestDate,
			null,
		) ?? fallbackProjectionStartDate;
	const {
		result,
		runtimeError,
		isRunning: isProjecting,
	} = useProjection(
		document,
		projectionSettings,
		modelOverrides,
		validation.isValid && evaluationsAreHydrated,
	);

	const hasStochasticAccounts =
		effectiveDocument?.postings.some((p) => p.volatility > 0 && p.enabled) ??
		false;

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
	} = useStochastic(
		document,
		projectionSettings,
		modelOverrides,
		stochasticConfig,
		stochasticWorkerEnabled,
	);
	const stochasticIsProvisional =
		isStochasticRunning && stochasticResult !== null;

	const handleSave = useCallback(() => {
		const store = useStore.getState();
		if (!store.workingDocument || modelMutation.isPending || !dataSource.save)
			return;

		modelMutation.mutate(store.workingDocument, {
			onSuccess: () => {
				useStore.setState({
					isDirty: false,
					isEditing: false,
					workingDocument: null,
				});
			},
		});
	}, [dataSource.save, modelMutation]);

	const handleResetSource = useCallback(() => {
		if (!dataSource.reset || modelResetMutation.isPending) return;
		requestEvaluationReload();

		modelResetMutation.mutate(undefined, {
			onSuccess: () => {
				useStore.setState({
					isDirty: false,
					isEditing: false,
					workingDocument: null,
				});
			},
		});
	}, [dataSource.reset, requestEvaluationReload, modelResetMutation]);

	const [showWizard, setShowWizard] = useState(false);
	const handleCloseWizard = useCallback(() => setShowWizard(false), []);

	const handleApplyTemplate = useCallback(
		(output: import("@/lib/patterns").TemplateOutput) => {
			const store = useStore.getState();
			if (!store.isEditing && document) {
				store.startEditing(document);
			}
			for (const account of output.accounts) {
				store.addAccount(account);
			}
			for (const posting of output.postings) {
				store.addPosting(posting);
			}
		},
		[document],
	);

	const onProjectionSettingsChange = useCallback(
		(partial: Partial<ProjectionRuntimeSettings>) => {
			if (partial.horizonYears !== undefined)
				setHorizonYears(partial.horizonYears);
		},
		[setHorizonYears],
	);

	const handleReload = useCallback(() => {
		requestEvaluationReload();
		return refetchModel();
	}, [refetchModel, requestEvaluationReload]);

	const currentMetrics = useMemo(() => {
		const evaluationResults = stochasticResult ?? result;
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
									label: envelope.label,
									status: envelope.status,
								})) ?? [],
						),
			currentChangeCount,
		};
	}, [result, stochasticResult, currentChangeCount]);

	const currentChangesControls = useMemo(
		() => (document ? <CurrentChangesControls document={document} /> : null),
		[document],
	);

	return (
		<div className="app-shell min-h-screen bg-background text-foreground">
			<div className="space-y-0 px-0 md:px-0">
				<div className="mx-auto max-w-[106rem] px-4 py-4 md:px-8">
					<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="type-caption">
							{document ? (
								<span>
									Baseline loaded from{" "}
									<span className="font-medium text-foreground/75">
										{dataSource.label}
									</span>
									{currentChangeCount > 0
										? ` · ${currentChangeCount} temporary change${currentChangeCount === 1 ? "" : "s"}`
										: ""}
									{isEditing && isDirty ? " · Unsaved baseline edits" : ""}
									{isEditing && !isDirty ? " · Editing baseline" : ""}
									{currentChangeCount === 0 && !isEditing
										? " · Projection settings are session-only"
										: ""}
								</span>
							) : (
								<span className="inline-flex items-center gap-2">
									<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary/70" />
									Loading financial model...
								</span>
							)}
						</div>
						<div className="flex flex-wrap gap-2 no-print">
							<ThemeToggle theme={theme} setTheme={setTheme} />
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => window.print()}
								disabled={!document}
							>
								Print
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={handleReload}
								disabled={isLoading}
							>
								{isLoading ? "Loading..." : "Reload source data"}
							</Button>
							{document ? (
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => setShowWizard(true)}
								>
									Templates
								</Button>
							) : null}
						</div>
					</div>
				</div>

				<SectionNav />

				<div className="mx-auto max-w-[106rem] space-y-6 px-4 py-6 md:px-8">
					{isLoading && !document ? (
						<div className="grid gap-4 md:grid-cols-3">
							{[1, 2, 3].map((i) => (
								<div
									key={i}
									className="animate-pulse rounded-[1.8rem] border border-border/80 bg-card/85 p-6 shadow-sm dark:border-white/10"
								>
									<div className="mb-2 h-3 w-20 rounded bg-muted" />
									<div className="h-6 w-32 rounded bg-muted" />
									<div className="mt-2 h-3 w-24 rounded bg-muted" />
								</div>
							))}
						</div>
					) : null}

					{isProjecting ? (
						<Alert variant="tertiary" className="rounded-[1.6rem]">
							<AlertTitle>Updating projection</AlertTitle>
							<AlertDescription>
								Recomputing historical and projected balances from the loaded
								financial model
								{currentChangeCount > 0
									? ` with ${currentChangeCount} temporary change${currentChangeCount === 1 ? "" : "s"}`
									: ""}
								.
							</AlertDescription>
						</Alert>
					) : null}

					{!validation.isValid ? (
						<Alert variant="destructive" className="rounded-[1.6rem]">
							<AlertTitle>Projection blocked by validation errors</AlertTitle>
							<AlertDescription>
								Fix the financial model issues above, then reload the data to
								resume projection.
							</AlertDescription>
						</Alert>
					) : null}

					{stochasticError ? (
						<Alert variant="destructive" className="rounded-[1.6rem]">
							<AlertTitle>Stochastic simulation failed</AlertTitle>
							<AlertDescription>{stochasticError}</AlertDescription>
						</Alert>
					) : null}

					{runtimeError ? (
						<Alert variant="destructive" className="rounded-[1.6rem]">
							<AlertTitle>Projection failed</AlertTitle>
							<AlertDescription>{runtimeError}</AlertDescription>
						</Alert>
					) : null}

					{document && validation.isValid && result ? (
						<div className="grid items-start gap-6 min-[90rem]:grid-cols-[minmax(0,1fr)_24rem] min-[90rem]:justify-center">
							<main className="min-w-0 space-y-6">
								<ProjectionDashboard
									document={effectiveDocument ?? document}
									result={result}
									stochasticResult={stochasticResult}
									stochasticIsProvisional={stochasticIsProvisional}
								/>

								<section id="model-inputs">
									<LazySection>
										<ModelInputsInspector
											projectionStartDate={
												result.milestones.projectionStartDate
											}
											document={document}
											issues={issues}
											dataSource={dataSource}
											isLoading={isLoading}
											loadError={loadError}
											sourceActionError={sourceActionError}
											onReload={handleReload}
											onSave={handleSave}
											isSaving={modelMutation.isPending}
											currentChangesSlot={currentChangesControls}
										/>
									</LazySection>
								</section>

								<section id="comparison-snapshots">
									<CurrentChangesComparison
										currentMetrics={currentMetrics}
										currentChangeCount={currentChangeCount}
										canCaptureComparison={
											!isProjecting && !isStochasticRunning && !isSourceUpdating
										}
									/>
								</section>
							</main>

							<aside id="projection-settings" className="space-y-4">
								<ProjectionConfigSidebar
									document={effectiveDocument ?? document}
									projectionSettings={projectionSettings}
									projectionStartDate={result.milestones.projectionStartDate}
									currentChangeCount={currentChangeCount}
									hasStochasticAccounts={hasStochasticAccounts}
									stochasticResult={stochasticResult}
									isStochasticRunning={isStochasticRunning}
									stochasticProgress={stochasticProgress}
									dataSource={dataSource}
									dataUpdatedAt={dataUpdatedAt}
									isLoading={isLoading}
									loadError={loadError}
									sourceActionError={sourceActionError}
									onProjectionSettingsChange={onProjectionSettingsChange}
									onReload={handleReload}
									onResetSource={
										dataSource.reset ? handleResetSource : undefined
									}
									isResetting={modelResetMutation.isPending}
								/>
							</aside>
						</div>
					) : (
						<section id="model-inputs">
							<LazySection>
								<ModelInputsInspector
									projectionStartDate={
										result?.milestones.projectionStartDate ??
										projectionStartDate
									}
									document={document}
									issues={issues}
									dataSource={dataSource}
									isLoading={isLoading}
									loadError={loadError}
									sourceActionError={sourceActionError}
									onReload={handleReload}
									onSave={handleSave}
									isSaving={modelMutation.isPending}
									currentChangesSlot={currentChangesControls}
								/>
							</LazySection>
						</section>
					)}

					{showWizard && document ? (
						<TemplateWizard
							document={document}
							onApply={handleApplyTemplate}
							onClose={handleCloseWizard}
						/>
					) : null}
				</div>
			</div>
		</div>
	);
}

function ThemeToggle({
	theme,
	setTheme,
}: {
	theme: "light" | "dark" | "system";
	setTheme: (t: "light" | "dark" | "system") => void;
}) {
	return (
		<div className="flex rounded-xl border border-border/80 bg-card/70 p-0.5 shadow-sm backdrop-blur-sm dark:border-white/10">
			<button
				type="button"
				aria-label="Light theme"
				onClick={() => setTheme("light")}
				className={`rounded-lg px-2 py-1 type-caption transition-colors ${
					theme === "light"
						? "bg-primary text-primary-foreground shadow-sm"
						: "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"
				}`}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<circle cx="12" cy="12" r="4" />
					<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
				</svg>
			</button>
			<button
				type="button"
				aria-label="Dark theme"
				onClick={() => setTheme("dark")}
				className={`rounded-lg px-2 py-1 type-caption transition-colors ${
					theme === "dark"
						? "bg-primary text-primary-foreground shadow-sm"
						: "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"
				}`}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
				</svg>
			</button>
			<button
				type="button"
				aria-label="System theme"
				onClick={() => setTheme("system")}
				className={`rounded-lg px-2 py-1 type-caption transition-colors ${
					theme === "system"
						? "bg-primary text-primary-foreground shadow-sm"
						: "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"
				}`}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
					<line x1="8" y1="21" x2="16" y2="21" />
					<line x1="12" y1="17" x2="12" y2="21" />
				</svg>
			</button>
		</div>
	);
}
