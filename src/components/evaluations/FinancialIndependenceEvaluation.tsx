import { FinancialIndependenceChart } from "@/components/dashboard/FinancialIndependenceChart";
import { OverviewCard } from "@/components/dashboard/OverviewCard";
import { currency, formatDate, pct } from "@/lib/format";
import type {
	EvaluationInstance,
	FinancialIndependenceAnalysis,
	FinancialIndependenceCandidateWithdrawalDiagnostic,
	FinancialIndependencePlan,
	FinancialModelDocument,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	getFinancialIndependenceResult,
	validateFinancialIndependencePlan,
} from "@/lib/projection";

interface FinancialIndependenceEvaluationProps {
	evaluation: EvaluationInstance<unknown>;
	document: FinancialModelDocument;
	result: ProjectionResult;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
	sourceRevision: number;
	resultsAreStale?: boolean;
}

export function FinancialIndependenceEvaluation({
	evaluation,
	document,
	result,
	stochasticResult,
	stochasticIsProvisional = false,
	resultsAreStale = false,
}: FinancialIndependenceEvaluationProps) {
	let plan: FinancialIndependencePlan;
	try {
		plan = validateFinancialIndependencePlan(evaluation.config);
	} catch {
		return null;
	}
	const analysis = resultsAreStale
		? undefined
		: getFinancialIndependenceResult(result, evaluation.instanceId)
				?.deterministic;
	const probabilistic = resultsAreStale
		? undefined
		: getFinancialIndependenceResult(stochasticResult, evaluation.instanceId)
				?.probabilistic;
	const candidateDate = analysis
		? selectFinancialIndependenceCandidateDate(analysis)
		: null;
	const candidateOutcome = analysis?.runOutcomes.find(
		(outcome) => outcome.candidateDate === candidateDate,
	);
	const behaviorOutcome =
		candidateOutcome?.status === "evaluated" ? candidateOutcome : undefined;
	const withdrawalDiagnostic =
		candidateDate === null
			? undefined
			: probabilistic?.candidateWithdrawalDiagnostics.find(
					(diagnostic) => diagnostic.candidateDate === candidateDate,
				);

	return (
		<div className="space-y-4">
			{resultsAreStale ? (
				<p className="rounded-2xl border border-dashed border-primary-border/70 bg-primary-subtle/20 p-5 type-muted">
					Updating FI outcomes. The base projection remains available above.
				</p>
			) : analysis ? (
				<>
					<div>
						<div className="mb-2 type-eyebrow">Outcome and analysis</div>
						<OverviewCard
							result={result}
							document={document}
							instanceId={evaluation.instanceId}
							plan={plan}
							candidateDate={candidateDate}
							stochasticResult={stochasticResult}
							stochasticIsProvisional={stochasticIsProvisional}
						/>
					</div>
					<div>
						<div className="mb-2 type-eyebrow">Behavior evidence</div>
						<div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
							<BehaviorMetric
								label="Diagnostic candidate"
								value={
									candidateDate ? formatDate(candidateDate) : "No test window"
								}
								detail={candidateOutcomeDetail(candidateOutcome)}
							/>
							<BehaviorMetric
								label="Requested withdrawals"
								value={
									behaviorOutcome
										? currency.format(
												behaviorOutcome.withdrawals.requestedAmount,
											)
										: "Not evaluated"
								}
								detail={
									behaviorOutcome
										? `${currency.format(behaviorOutcome.withdrawals.realizedAmount)} realized by account movement constraints`
										: unavailableBehaviorDetail(candidateOutcome)
								}
							/>
							<BehaviorMetric
								label="Deterministic shortfall"
								value={
									behaviorOutcome
										? currency.format(
												behaviorOutcome.withdrawals.shortfallAmount,
											)
										: "Not evaluated"
								}
								detail={
									behaviorOutcome?.withdrawals.firstShortfallDate
										? `First on ${formatDate(behaviorOutcome.withdrawals.firstShortfallDate)}`
										: behaviorOutcome
											? "No unfunded behavior withdrawals"
											: "No behavior branch was run"
								}
							/>
							<BehaviorMetric
								label={`${stochasticIsProvisional ? "Provisional " : ""}shortfall probability`}
								value={shortfallProbabilityValue(
									candidateDate,
									probabilistic !== undefined && probabilistic !== null,
									withdrawalDiagnostic,
								)}
								detail={
									withdrawalDiagnostic
										? withdrawalDiagnostic.diagnosticRunCount > 0
											? `${withdrawalDiagnostic.shortfallRunCount} of ${withdrawalDiagnostic.diagnosticRunCount} eligible independent Monte Carlo samples`
											: `0 of ${withdrawalDiagnostic.totalRunCount} independent Monte Carlo samples were eligible`
										: candidateDate
											? "Candidate-aligned behavior diagnostic"
											: "No FI candidate could be tested"
								}
							/>
						</div>
						<FinancialIndependenceChart analysis={analysis} />
					</div>
				</>
			) : (
				<p className="rounded-2xl border border-dashed border-border/80 p-5 type-muted">
					No healthy deterministic outcome is available for this evaluation.
				</p>
			)}
		</div>
	);
}

export function selectFinancialIndependenceCandidateDate(
	analysis: FinancialIndependenceAnalysis,
) {
	const successful = analysis.runOutcomes.find(
		(outcome) => outcome.cycleEstablished,
	);
	if (successful) return successful.candidateDate;
	for (let index = analysis.runOutcomes.length - 1; index >= 0; index--) {
		const outcome = analysis.runOutcomes[index];
		if (outcome?.status === "evaluated") return outcome.candidateDate;
	}
	return analysis.rows[analysis.rows.length - 1]?.date ?? null;
}

function candidateOutcomeDetail(
	outcome: FinancialIndependenceAnalysis["runOutcomes"][number] | undefined,
) {
	if (!outcome) return "No complete behavior cycle fits in the horizon";
	if (outcome.cycleEstablished) return "Behavior sustained the complete cycle";
	if (outcome.status === "ineligible")
		return "Candidate did not pass the net worth and capacity gates";
	if (!outcome.expensesFullyCovered)
		return "Behavior produced unfunded withdrawals during the cycle";
	if (!outcome.principalReplenished)
		return "Spending was funded, but the principal policy was not met";
	return "Behavior did not establish the complete cycle";
}

function unavailableBehaviorDetail(
	outcome: FinancialIndependenceAnalysis["runOutcomes"][number] | undefined,
) {
	return outcome
		? "Candidate did not pass the initial FI gates"
		: "No complete FI test fits in the projection horizon";
}

function shortfallProbabilityValue(
	candidateDate: string | null,
	hasProbabilisticResult: boolean,
	diagnostic: FinancialIndependenceCandidateWithdrawalDiagnostic | undefined,
) {
	if (candidateDate === null) return "Not evaluated";
	if (!hasProbabilisticResult) return "Run Monte Carlo";
	if (!diagnostic || diagnostic.diagnosticRunCount === 0)
		return "Not evaluated";
	return pct.format(diagnostic.shortfallProbability);
}

function BehaviorMetric({
	label,
	value,
	detail,
}: {
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className="rounded-2xl border border-primary-border/45 bg-primary-subtle/45 p-4">
			<div className="type-label">{label}</div>
			<div className="mt-1 type-metric text-foreground">{value}</div>
			<div className="type-muted">{detail}</div>
		</div>
	);
}
