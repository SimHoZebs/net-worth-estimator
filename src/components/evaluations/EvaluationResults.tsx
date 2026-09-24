import {
	EmptyState,
	PageHeader,
	Pill,
	SectionCard,
} from "@/components/present/Present";
import { SimulationProgressPanel } from "@/components/SimulationProgressPanel";
import { StochasticProgressDetails } from "@/components/StochasticProgressDetails";
import type {
	EvaluationInstance,
	EvaluationResultCollection,
	FinancialModelDocument,
	ProjectionResult,
	StochasticProgress,
	StochasticProjectionResult,
} from "@/lib/projection";
import { EVALUATION_TYPE_ORDER, type EvaluationType } from "@/lib/projection";
import { useStore } from "@/store";
import { evaluationUiRegistry, validatedConfig } from "./EvaluationUiRegistry";

interface EvaluationResultsProps {
	results?: EvaluationResultCollection | null;
	document: FinancialModelDocument;
	result: ProjectionResult;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
	sourceRevision?: number;
	resultsAreStale?: boolean;
	stochasticIsRunning?: boolean;
	stochasticProgress?: StochasticProgress | null;
	blockerValue?: string;
	blockerDetail?: string;
}

export function EvaluationResults({
	results,
	document,
	result,
	stochasticResult,
	stochasticIsProvisional = false,
	resultsAreStale = false,
	stochasticIsRunning = false,
	stochasticProgress = null,
	sourceRevision = 0,
	blockerValue = "No blocking constraint",
	blockerDetail = "No evaluation blocker was identified.",
}: EvaluationResultsProps) {
	const resultCollection = resultsAreStale
		? null
		: (stochasticResult ?? results ?? result);

	return (
		<section id="evaluations" className="space-y-3">
			<PageHeader level="h2" title="Evaluations" titleClassName="sr-only" />

			{EVALUATION_TYPE_ORDER.map((type) => (
				<EvaluationTypeSection
					key={type}
					type={type}
					resultCollection={resultCollection}
					document={document}
					result={result}
					stochasticResult={stochasticResult}
					stochasticIsProvisional={stochasticIsProvisional}
					resultsAreStale={resultsAreStale}
					stochasticIsRunning={stochasticIsRunning}
					stochasticProgress={stochasticProgress}
					sourceRevision={sourceRevision}
					blockerValue={blockerValue}
					blockerDetail={blockerDetail}
				/>
			))}
		</section>
	);
}

interface EvaluationTypeSectionProps {
	type: EvaluationType;
	resultCollection: EvaluationResultCollection | null;
	document: FinancialModelDocument;
	result: ProjectionResult;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional: boolean;
	resultsAreStale: boolean;
	stochasticIsRunning: boolean;
	stochasticProgress: StochasticProgress | null;
	sourceRevision: number;
	blockerValue: string;
	blockerDetail: string;
}

// Subscribes only to its own evaluation table so editing one instance does
// not rerender unrelated evaluation sections.
function EvaluationTypeSection({
	type,
	resultCollection,
	document,
	result,
	stochasticResult,
	stochasticIsProvisional,
	resultsAreStale,
	stochasticIsRunning,
	stochasticProgress,
	sourceRevision,
	blockerValue,
	blockerDetail,
}: EvaluationTypeSectionProps) {
	const table = useStore(
		(state) => state.evaluations[type],
	) as EvaluationInstance<unknown>[];
	const definition = evaluationUiRegistry[type];

	if (table.length === 0) return null;

	return (
		<div className="space-y-2">
			<h3 className="type-eyebrow text-muted-foreground">{definition.label}</h3>
			{table.map((evaluation) => {
				const config = validatedConfig(type, evaluation.config);
				const envelope = resultCollection?.evaluations[type].find(
					(candidate) => candidate.instanceId === evaluation.instanceId,
				);
				const stochasticWorkload = stochasticProgress?.evaluationWorkloads.find(
					(workload) =>
						workload.type === type &&
						workload.instanceId === evaluation.instanceId,
				);
				const hasLocalProgress =
					evaluation.enabled &&
					stochasticIsRunning &&
					stochasticProgress !== null &&
					stochasticWorkload !== undefined;
				const status = evaluation.enabled
					? resultsAreStale
						? "updating"
						: `${stochasticIsProvisional && stochasticResult ? "provisional " : ""}${envelope?.status ?? "pending"}`
					: "disabled";
				const quiet =
					!hasLocalProgress &&
					(status === "satisfied" || status === "disabled");
				if (quiet) {
					return (
						<div
							key={evaluation.instanceId}
							className="flex items-center justify-between gap-3 px-1 py-1"
						>
							<span className="min-w-0 truncate type-value text-sm">
								{evaluation.label}
							</span>
							<Pill
								size="xs"
								tone={status === "satisfied" ? "primary" : "neutral"}
							>
								{status}
							</Pill>
						</div>
					);
				}
				const ResultRenderer = definition.ResultRenderer;
				const workloadProgressPct = stochasticProgress
					? Math.round(stochasticProgress.fraction * 100)
					: null;
				return (
					<SectionCard
						key={evaluation.instanceId}
						className="overflow-hidden rounded-[1.8rem] border-border/80 bg-card/92"
						headerClassName="border-b border-border/70 bg-surface/45 dark:border-white/10"
						header={
							<div className="flex items-start justify-between gap-4">
								<div className="type-title text-lg">{evaluation.label}</div>
								{hasLocalProgress ? null : <Pill>{status}</Pill>}
							</div>
						}
						contentClassName="space-y-4 p-4"
					>
						{hasLocalProgress && stochasticProgress && stochasticWorkload ? (
							<SimulationProgressPanel
								title={
									type === "financialIndependence"
										? "Running FI Monte Carlo"
										: `Updating ${evaluation.label}`
								}
								description={
									type === "financialIndependence"
										? resultsAreStale
											? "Previous FI results are hidden until recalculation completes."
											: "The deterministic FI result below is current. Monte Carlo confidence is still being calculated."
										: undefined
								}
								progressPct={workloadProgressPct}
								progressLabel={`${evaluation.label} Monte Carlo progress`}
								live={false}
							>
								<StochasticProgressDetails
									progress={stochasticProgress}
									compact
									showPhase={false}
									showWorkloadLabels={false}
									showWorkloadTotals={false}
									showDescriptions={false}
									workloads={[stochasticWorkload]}
								/>
							</SimulationProgressPanel>
						) : null}
						{config.error ? <Diagnostic message={config.error} error /> : null}
						{envelope?.diagnostics.map((diagnostic) => (
							<Diagnostic
								key={`${diagnostic.code}-${diagnostic.message}`}
								message={diagnostic.message}
								error={diagnostic.severity === "error"}
							/>
						))}
						{evaluation.enabled &&
						config.normalized !== null &&
						!resultsAreStale ? (
							<ResultRenderer
								evaluation={{
									...evaluation,
									config: config.normalized,
								}}
								document={document}
								result={result}
								stochasticResult={stochasticResult}
								stochasticIsProvisional={stochasticIsProvisional}
								sourceRevision={sourceRevision}
								resultsAreStale={resultsAreStale}
								blockerValue={blockerValue}
								blockerDetail={blockerDetail}
							/>
						) : resultsAreStale && evaluation.enabled && !hasLocalProgress ? (
							<EmptyState>
								Updating this evaluation with the current settings.
							</EmptyState>
						) : null}
					</SectionCard>
				);
			})}
		</div>
	);
}

function Diagnostic({
	message,
	error = false,
}: {
	message: string;
	error?: boolean;
}) {
	return (
		<p
			role={error ? "alert" : "status"}
			className={`rounded-xl border px-3 py-2 type-caption ${error ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border/70"}`}
		>
			{message}
		</p>
	);
}
