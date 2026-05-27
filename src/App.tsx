import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import {
	createBrowserCsvDataSource,
	createCsvDataSource,
	type ProjectionRuntimeSettings,
} from "@/lib/projection";
import { ContributionWhatIfControls } from "./components/CsvContributionWhatIfControls";
import { ProjectionDashboard } from "./components/CsvProjectionDashboard";
import { ScenarioInspector } from "./components/CsvScenarioInspector";
import { TemplateWizard } from "./components/patterns/TemplateWizard";
import { ScenarioComparison } from "./components/ScenarioComparison";
import { SectionNav } from "./components/SectionNav";
import { ProjectionConfigSidebar } from "./components/sidebar/ProjectionConfigSidebar";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { LazySection } from "./components/ui/lazy-section";
import { useProjection } from "./hooks/useProjection";
import {
	useScenarioMutation,
	useScenarioQuery,
	useScenarioResetMutation,
} from "./hooks/useScenario";
import { useStochastic } from "./hooks/useStochastic";
import { summarizeValidationIssues } from "./lib/projection";
import {
	selectActiveOverrideCount,
	selectWhatIfState,
	useStore,
} from "./store";

function formatTodayIsoDate() {
	return new Date().toISOString().slice(0, 10);
}

function createScenarioDataSource() {
	return import.meta.env.DEV
		? createCsvDataSource()
		: createBrowserCsvDataSource();
}

export default function App() {
	const dataSource = useMemo(() => createScenarioDataSource(), []);
	const {
		data: scenarioData,
		isLoading: isScenarioLoading,
		error: scenarioError,
		refetch: refetchScenario,
		dataUpdatedAt,
	} = useScenarioQuery(dataSource);
	const scenarioMutation = useScenarioMutation(dataSource);
	const scenarioResetMutation = useScenarioResetMutation(dataSource);

	const pack = scenarioData?.pack ?? null;
	const issues = scenarioData?.issues ?? [];
	const loadError = scenarioError?.message ?? null;
	const sourceActionError =
		scenarioMutation.error?.message ??
		scenarioResetMutation.error?.message ??
		null;
	const isLoading = isScenarioLoading;

	const whatIfState = useStore(useShallow(selectWhatIfState));
	const {
		activeOverrideCount,
		isEditing,
		isDirty,
		targetNetWorth,
		setTargetNetWorth,
		horizonYears,
		setHorizonYears,
		stochasticPreference,
		stochasticConfig,
		theme,
		setTheme,
	} = useStore(
		useShallow((s) => ({
			activeOverrideCount: selectActiveOverrideCount(s),
			isEditing: s.isEditing,
			isDirty: s.isDirty,
			targetNetWorth: s.targetNetWorth,
			setTargetNetWorth: s.setTargetNetWorth,
			horizonYears: s.horizonYears,
			setHorizonYears: s.setHorizonYears,
			stochasticPreference: s.stochasticPreference,
			stochasticConfig: s.stochasticConfig,
			theme: s.theme,
			setTheme: s.setTheme,
		})),
	);

	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = () => {
			if (useStore.getState().theme === "system") {
				const resolved = mq.matches ? "dark" : "light";
				document.documentElement.classList.toggle("dark", resolved === "dark");
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
			targetNetWorth,
			fallbackProjectionStartDate,
			horizonYears,
		}),
		[fallbackProjectionStartDate, targetNetWorth, horizonYears],
	);
	const projectionStartDate =
		pack?.checkpoints.reduce<string | null>(
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
	} = useProjection(pack, projectionSettings, whatIfState, validation.isValid);

	const hasStochasticAccounts =
		pack?.postings.some((p) => p.volatility > 0 && p.enabled) ?? false;

	const stochasticWorkerEnabled =
		stochasticPreference !== "disabled" &&
		hasStochasticAccounts &&
		validation.isValid;
	const {
		result: stochasticResult,
		runtimeError: stochasticError,
		isRunning: isStochasticRunning,
		progress: stochasticProgress,
	} = useStochastic(
		pack,
		projectionSettings,
		whatIfState,
		stochasticConfig,
		stochasticWorkerEnabled,
	);

	const handleSave = useCallback(() => {
		const store = useStore.getState();
		if (!store.workingPack || scenarioMutation.isPending || !dataSource.save)
			return;

		scenarioMutation.mutate(store.workingPack, {
			onSuccess: () => {
				useStore.setState({
					isDirty: false,
					isEditing: false,
					workingPack: null,
				});
			},
		});
	}, [dataSource.save, scenarioMutation]);

	const handleResetSource = useCallback(() => {
		if (!dataSource.reset || scenarioResetMutation.isPending) return;

		scenarioResetMutation.mutate(undefined, {
			onSuccess: () => {
				useStore.setState({
					isDirty: false,
					isEditing: false,
					workingPack: null,
				});
			},
		});
	}, [dataSource.reset, scenarioResetMutation]);

	const [showWizard, setShowWizard] = useState(false);
	const handleCloseWizard = useCallback(() => setShowWizard(false), []);

	const handleApplyTemplate = useCallback(
		(output: import("@/lib/patterns").TemplateOutput) => {
			const store = useStore.getState();
			if (!store.isEditing && pack) {
				store.startEditing(pack);
			}
			for (const account of output.accounts) {
				store.addAccount(account);
			}
			for (const posting of output.postings) {
				store.addPosting(posting);
			}
		},
		[pack],
	);

	const onProjectionSettingsChange = useCallback(
		(partial: Partial<ProjectionRuntimeSettings>) => {
			if (partial.horizonYears !== undefined)
				setHorizonYears(partial.horizonYears);
		},
		[setHorizonYears],
	);

	const handleReload = useCallback(() => refetchScenario(), [refetchScenario]);

	const currentMetrics = useMemo(
		() => ({
			currentNetWorth: result?.summary.currentNetWorth ?? 0,
			finalNetWorth: result?.summary.finalNetWorth ?? 0,
			hitTargetDate: result?.milestones.hitTargetDate ?? null,
			shortfallAmount: result?.totals.clampedPostingShortfallAmount ?? 0,
			overrideCount: activeOverrideCount,
		}),
		[
			result?.summary.currentNetWorth,
			result?.summary.finalNetWorth,
			result?.milestones.hitTargetDate,
			result?.totals.clampedPostingShortfallAmount,
			activeOverrideCount,
		],
	);

	const whatIfControls = useMemo(
		() => (pack ? <ContributionWhatIfControls pack={pack} /> : null),
		[pack],
	);

	return (
		<div className="app-shell min-h-screen bg-background text-foreground">
			<div className="space-y-0 px-0 md:px-0">
				<div className="mx-auto max-w-[106rem] px-4 py-4 md:px-8">
					<div className="flex items-center justify-between gap-2">
						<div className="type-caption">
							{pack ? (
								<span>
									Baseline loaded from{" "}
									<span className="font-medium text-foreground/75">
										{dataSource.label}
									</span>
									{activeOverrideCount > 0
										? ` · ${activeOverrideCount} temporary scenario override${activeOverrideCount === 1 ? "" : "s"}`
										: ""}
									{isEditing && isDirty ? " · Unsaved baseline edits" : ""}
									{isEditing && !isDirty ? " · Editing baseline" : ""}
									{activeOverrideCount === 0 && !isEditing
										? " · Projection settings are session-only"
										: ""}
								</span>
							) : (
								<span className="inline-flex items-center gap-2">
									<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary/70" />
									Loading scenario data...
								</span>
							)}
						</div>
						<div className="flex gap-2 no-print">
							<ThemeToggle theme={theme} setTheme={setTheme} />
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => window.print()}
								disabled={!pack}
							>
								Print
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => refetchScenario()}
								disabled={isLoading}
							>
								{isLoading ? "Loading..." : "Reload source data"}
							</Button>
							{pack ? (
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
					{isLoading && !pack ? (
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
								data pack
								{activeOverrideCount > 0
									? ` with ${activeOverrideCount} temporary change${activeOverrideCount === 1 ? "" : "s"}`
									: ""}
								.
							</AlertDescription>
						</Alert>
					) : null}

					{!validation.isValid ? (
						<Alert variant="destructive" className="rounded-[1.6rem]">
							<AlertTitle>Projection blocked by validation errors</AlertTitle>
							<AlertDescription>
								Fix the data pack issues above, then reload the data to resume
								projection.
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

					{pack && validation.isValid && result ? (
						<div className="grid items-start gap-6 min-[110rem]:grid-cols-[minmax(0,80rem)_24rem] min-[110rem]:justify-center">
							<main className="min-w-0 space-y-6">
								<ProjectionDashboard
									pack={pack}
									result={result}
									projectionSettings={projectionSettings}
									stochasticResult={stochasticResult}
								/>

								<section id="model-inputs">
									<LazySection>
										<ScenarioInspector
											projectionStartDate={
												result.milestones.projectionStartDate
											}
											pack={pack}
											issues={issues}
											dataSource={dataSource}
											isLoading={isLoading}
											loadError={loadError}
											sourceActionError={sourceActionError}
											onReload={handleReload}
											onSave={handleSave}
											isSaving={scenarioMutation.isPending}
											overridesSlot={whatIfControls}
										/>
									</LazySection>
								</section>

								<section id="scenario-snapshots">
									<ScenarioComparison
										currentMetrics={currentMetrics}
										currentOverrideCount={activeOverrideCount}
									/>
								</section>
							</main>

							<aside id="projection-settings" className="space-y-4">
								<ProjectionConfigSidebar
									pack={pack}
									projectionSettings={projectionSettings}
									projectionStartDate={result.milestones.projectionStartDate}
									activeOverrideCount={activeOverrideCount}
									hasStochasticAccounts={hasStochasticAccounts}
									stochasticResult={stochasticResult}
									isStochasticRunning={isStochasticRunning}
									stochasticProgress={stochasticProgress}
									dataSource={dataSource}
									dataUpdatedAt={dataUpdatedAt}
									isLoading={isLoading}
									loadError={loadError}
									sourceActionError={sourceActionError}
									onTargetNetWorthChange={setTargetNetWorth}
									onProjectionSettingsChange={onProjectionSettingsChange}
									onReload={handleReload}
									onResetSource={
										dataSource.reset ? handleResetSource : undefined
									}
									isResetting={scenarioResetMutation.isPending}
								/>
							</aside>
						</div>
					) : (
						<section id="model-inputs">
							<LazySection>
								<ScenarioInspector
									projectionStartDate={
										result?.milestones.projectionStartDate ??
										projectionStartDate
									}
									pack={pack}
									issues={issues}
									dataSource={dataSource}
									isLoading={isLoading}
									loadError={loadError}
									sourceActionError={sourceActionError}
									onReload={handleReload}
									onSave={handleSave}
									isSaving={scenarioMutation.isPending}
									overridesSlot={whatIfControls}
								/>
							</LazySection>
						</section>
					)}

					{showWizard && pack ? (
						<TemplateWizard
							pack={pack}
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
