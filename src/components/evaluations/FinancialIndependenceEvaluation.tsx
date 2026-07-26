import { FinancialIndependenceChart } from "@/components/dashboard/FinancialIndependenceChart";
import { OverviewCard } from "@/components/dashboard/OverviewCard";
import { currency, formatDate, pct } from "@/lib/format";
import type {
	EvaluationInstance,
	FinancialIndependencePlan,
	FinancialModelDocument,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	getFinancialIndependenceResult,
	validateFinancialIndependencePlan,
} from "@/lib/projection";
import { useStore } from "@/store";
import { FinancialIndependencePlanEditor } from "./FinancialIndependencePlanEditor";

interface FinancialIndependenceEvaluationProps {
	evaluation: EvaluationInstance<unknown>;
	document: FinancialModelDocument;
	result: ProjectionResult;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
	blockerValue: string;
	blockerDetail: string;
}

export function FinancialIndependenceEvaluation({
	evaluation,
	document,
	result,
	stochasticResult,
	stochasticIsProvisional = false,
	blockerValue,
	blockerDetail,
}: FinancialIndependenceEvaluationProps) {
	const updateEvaluationConfig = useStore(
		(state) => state.updateEvaluationConfig,
	);
	let plan: FinancialIndependencePlan;
	try {
		plan = validateFinancialIndependencePlan(evaluation.config);
	} catch {
		return null;
	}
	const analysis = getFinancialIndependenceResult(
		result,
		evaluation.instanceId,
	)?.deterministic;
	const probabilistic = getFinancialIndependenceResult(
		stochasticResult,
		evaluation.instanceId,
	)?.probabilistic;
	const behaviorOutcome =
		analysis?.runOutcomes.find(
			(outcome) =>
				outcome.status === "evaluated" &&
				outcome.candidateDate === analysis.milestones.firstSelfSustainingDate,
		) ??
		analysis?.runOutcomes.find((outcome) => outcome.status === "evaluated");
	const withdrawalDiagnostic = behaviorOutcome
		? probabilistic?.candidateWithdrawalDiagnostics.find(
				(diagnostic) =>
					diagnostic.candidateDate === behaviorOutcome.candidateDate,
			)
		: probabilistic?.candidateWithdrawalDiagnostics[0];

	return (
		<div className="space-y-4">
			<FinancialIndependencePlanEditor
				document={document}
				plan={plan}
				onChange={(changes) =>
					updateEvaluationConfig(
						"financialIndependence",
						evaluation.instanceId,
						changes,
					)
				}
			/>
			{analysis ? (
				<>
					<div>
						<div className="mb-2 type-eyebrow">Outcome and analysis</div>
						<OverviewCard
							result={result}
							instanceId={evaluation.instanceId}
							plan={plan}
							stochasticResult={stochasticResult}
							stochasticIsProvisional={stochasticIsProvisional}
							document={document}
							blockerValue={blockerValue}
							blockerDetail={blockerDetail}
						/>
					</div>
					<div>
						<div className="mb-2 type-eyebrow">Behavior evidence</div>
						<div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
							<BehaviorMetric
								label="Evaluated branch"
								value={
									behaviorOutcome
										? formatDate(behaviorOutcome.candidateDate)
										: "No eligible branch"
								}
								detail={
									behaviorOutcome?.cycleEstablished
										? "Behavior sustained the complete cycle"
										: "No evaluated branch established the cycle"
								}
							/>
							<BehaviorMetric
								label="Requested withdrawals"
								value={currency.format(
									behaviorOutcome?.withdrawals.requestedAmount ?? 0,
								)}
								detail={`${currency.format(behaviorOutcome?.withdrawals.realizedAmount ?? 0)} realized by account movement constraints`}
							/>
							<BehaviorMetric
								label="Deterministic shortfall"
								value={currency.format(
									behaviorOutcome?.withdrawals.shortfallAmount ?? 0,
								)}
								detail={
									behaviorOutcome?.withdrawals.firstShortfallDate
										? `First on ${formatDate(behaviorOutcome.withdrawals.firstShortfallDate)}`
										: "No unfunded behavior withdrawals"
								}
							/>
							<BehaviorMetric
								label={`${stochasticIsProvisional ? "Provisional " : ""}shortfall probability`}
								value={
									withdrawalDiagnostic
										? pct.format(withdrawalDiagnostic.shortfallProbability)
										: "Run Monte Carlo"
								}
								detail={
									withdrawalDiagnostic
										? `${withdrawalDiagnostic.shortfallRunCount} of ${withdrawalDiagnostic.diagnosticRunCount} eligible independent Monte Carlo samples`
										: "Candidate-aligned behavior diagnostic"
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
