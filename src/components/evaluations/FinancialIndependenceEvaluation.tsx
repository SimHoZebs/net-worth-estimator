import { FinancialIndependenceChart } from "@/components/dashboard/FinancialIndependenceChart";
import { OverviewCard } from "@/components/dashboard/OverviewCard";
import type {
	EvaluationInstance,
	FinancialIndependenceAnalysis,
	FinancialIndependencePlan,
	FinancialModelDocument,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	getFinancialIndependenceResult,
	selectFinancialIndependenceOutcomeIndex,
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
}: FinancialIndependenceEvaluationProps) {
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
	const selectedIndex = analysis
		? selectFinancialIndependenceOutcomeIndex(analysis.runOutcomes)
		: -1;
	const candidateRow = analysis?.rows[selectedIndex];
	const candidateOutcome = analysis?.runOutcomes[selectedIndex];
	const detailedOutcome =
		candidateOutcome?.status === "summary" ? undefined : candidateOutcome;

	return (
		<div className="space-y-4">
			{analysis ? (
				<>
					<OverviewCard
						document={document}
						plan={plan}
						row={candidateRow}
						outcome={detailedOutcome}
					/>
					{candidateRow && detailedOutcome ? (
						<FinancialIndependenceChart
							document={document}
							outcome={detailedOutcome}
						/>
					) : null}
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
	const index = selectFinancialIndependenceOutcomeIndex(analysis.runOutcomes);
	return analysis.runOutcomes[index]?.candidateDate ?? null;
}
