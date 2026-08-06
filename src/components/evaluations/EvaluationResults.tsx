import { SimulationProgressPanel } from "@/components/SimulationProgressPanel";
import { StochasticProgressDetails } from "@/components/StochasticProgressDetails";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
	EvaluationInstance,
	EvaluationResultCollection,
	FinancialModelDocument,
	ProjectionResult,
	StochasticProgress,
	StochasticProjectionResult,
} from "@/lib/projection";
import { EVALUATION_TYPE_ORDER } from "@/lib/projection";
import { useStore } from "@/store";
import { evaluationUiRegistry, validatedConfig } from "./evaluationUiRegistry";

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
	const evaluations = useStore((state) => state.evaluations);
	const resultCollection = resultsAreStale
		? null
		: (stochasticResult ?? results ?? result);

	return (
		<section id="evaluations" className="space-y-4">
			<div>
				<div className="type-eyebrow text-primary">Ordered questions</div>
				<h2 className="mt-1 type-title text-2xl">Evaluations</h2>
				<p className="mt-1 max-w-2xl type-muted">
					Outcomes, behavior evidence, diagnostics, and probabilistic analysis
					for each configured evaluation.
				</p>
			</div>

			{EVALUATION_TYPE_ORDER.map((type) => {
				const definition = evaluationUiRegistry[type];
				const table = evaluations[type] as EvaluationInstance<unknown>[];
				return table.length > 0 ? (
					<div key={type} className="space-y-3">
						<h3 className="type-eyebrow text-muted-foreground">
							{definition.label}
						</h3>
						{table.map((evaluation) => {
							const config = validatedConfig(type, evaluation.config);
							const envelope = resultCollection?.evaluations[type].find(
								(candidate) => candidate.instanceId === evaluation.instanceId,
							);
							const stochasticWorkload =
								stochasticProgress?.evaluationWorkloads.find(
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
							const ResultRenderer = definition.ResultRenderer;
							const workloadProgressPct = stochasticProgress
								? Math.round(stochasticProgress.fraction * 100)
								: null;
							return (
								<Card
									key={evaluation.instanceId}
									className="overflow-hidden rounded-[1.8rem] border-border/80 bg-card/92"
								>
									<CardHeader className="border-b border-border/70 bg-surface/45 dark:border-white/10">
										<div className="flex items-start justify-between gap-4">
											<div>
												<div className="type-title text-xl">
													{evaluation.label}
												</div>
												<div className="mt-1 type-caption">
													{evaluation.instanceId}
												</div>
											</div>
											{hasLocalProgress ? null : (
												<span className="rounded-full border border-border/70 px-3 py-1 type-label uppercase tracking-[0.12em]">
													{status}
												</span>
											)}
										</div>
									</CardHeader>
									<CardContent className="space-y-4 p-4 md:p-6">
										{hasLocalProgress &&
										stochasticProgress &&
										stochasticWorkload ? (
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
														: "Monte Carlo analysis is recomputing this evaluation's outcome."
												}
												progressPct={workloadProgressPct}
												progressLabel={`${evaluation.label} Monte Carlo progress`}
											>
												<StochasticProgressDetails
													progress={stochasticProgress}
													showPhase={false}
													showWorkloadLabels={false}
													showWorkloadTotals={false}
													showDescriptions={false}
													workloads={[stochasticWorkload]}
												/>
											</SimulationProgressPanel>
										) : null}
										{config.error ? (
											<Diagnostic message={config.error} error />
										) : null}
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
										) : resultsAreStale &&
											evaluation.enabled &&
											!hasLocalProgress ? (
											<p className="rounded-2xl border border-dashed border-border/80 p-5 type-muted">
												Updating this evaluation with the current settings.
											</p>
										) : null}
									</CardContent>
								</Card>
							);
						})}
					</div>
				) : null;
			})}
		</section>
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
