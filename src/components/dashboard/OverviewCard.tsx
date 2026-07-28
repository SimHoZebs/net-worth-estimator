import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { currency, formatDate, pct } from "@/lib/format";
import type {
	FinancialIndependencePlan,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import { getFinancialIndependenceResult } from "@/lib/projection";

interface OverviewCardProps {
	result: ProjectionResult;
	instanceId: string;
	plan: FinancialIndependencePlan;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
	blockerValue: string;
	blockerDetail: string;
}

export const OverviewCard = memo(function OverviewCard({
	result,
	instanceId,
	plan,
	stochasticResult,
	stochasticIsProvisional = false,
	blockerValue,
	blockerDetail,
}: OverviewCardProps) {
	const analysis = getFinancialIndependenceResult(
		result,
		instanceId,
	)?.deterministic;
	const stochasticAnalysis = getFinancialIndependenceResult(
		stochasticResult,
		instanceId,
	);
	const firstCoverageDate = analysis?.milestones.firstCoverageDate ?? null;
	const selfSustainingDate =
		analysis?.milestones.firstSelfSustainingDate ?? null;
	const displayDate = firstCoverageDate;
	const coverageRow =
		analysis?.rows.find((row) => row.date === displayDate) ?? analysis?.rows[0];
	const confidenceDate = stochasticAnalysis?.probabilistic?.selfSustainingDate;
	const confidence =
		stochasticAnalysis?.probabilistic?.fiCycleSuccessProbability;
	const qualifyingConfidence =
		stochasticAnalysis?.probabilistic?.selfSustainingProbability;

	return (
		<Card className="rounded-[1.8rem] border-primary-border/45 bg-gradient-to-br from-card/96 via-card/90 to-primary-subtle/35">
			<CardContent className="p-5 md:p-6">
				<div className="mb-4 flex flex-col gap-1 rounded-2xl border border-primary-border/50 bg-primary-subtle/35 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
					<div>
						<div className="type-label">Success test</div>
						<div className="type-muted">{successPolicyDescription(plan)}</div>
					</div>
					<div className="type-value text-foreground">
						{plan.evaluationYears}-year test · {principalPolicyLabel(plan)}
					</div>
				</div>
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">FI coverage</div>
						<div className="mt-1 type-metric text-foreground">
							{coverageRow ? pct.format(coverageRow.coverageRatio) : "0%"}
						</div>
						<div className="type-muted">
							{coverageRow
								? `${currency.format(coverageRow.totalAnnualCapacity)} of ${currency.format(coverageRow.annualExpenseTarget)} per year`
								: "Select at least one FI source"}
						</div>
					</div>

					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">Deterministic first coverage</div>
						<div className="mt-1 type-metric text-foreground">
							{firstCoverageDate
								? formatDate(firstCoverageDate)
								: "Beyond horizon"}
						</div>
						<div className="type-muted">
							Selected capacity first meets annual expenses
						</div>
					</div>

					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">
							Deterministic first self-sustaining
						</div>
						<div className="mt-1 type-metric text-primary">
							{selfSustainingDate
								? formatDate(selfSustainingDate)
								: "Not established"}
						</div>
						<div className="type-muted">
							Requires at least {currency.format(plan.minimumNetWorth)} net
							worth before cycle evaluation
						</div>
					</div>

					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">
							{stochasticIsProvisional ? "Provisional " : ""}
							Confidence-qualified FI date
						</div>
						<div className="mt-1 type-metric text-primary">
							{confidenceDate === undefined
								? "Run Monte Carlo"
								: confidenceDate
									? formatDate(confidenceDate)
									: "Not established"}
						</div>
						<div className="type-muted line-clamp-2">
							{confidence === undefined
								? blockerDetail
								: confidenceDate === null
									? `${pct.format(confidence)} of independent Monte Carlo samples succeeded at some candidate; no date reached ${pct.format(plan.requiredConfidence)}`
									: stochasticIsProvisional
										? `${pct.format(qualifyingConfidence ?? 0)} at this date from completed independent Monte Carlo samples; still converging`
										: `${pct.format(qualifyingConfidence ?? 0)} at this date; requires ${pct.format(plan.requiredConfidence)}`}
						</div>
					</div>
				</div>

				<div className="mt-5 grid gap-2 border-t border-border/70 pt-4 type-muted sm:grid-cols-2 xl:grid-cols-4">
					<span>
						Direct income:{" "}
						<b className="type-value">
							{currency.format(coverageRow?.annualDirectIncome ?? 0)}/yr
						</b>
					</span>
					<span>
						Withdrawal capacity:{" "}
						<b className="type-value">
							{currency.format(coverageRow?.annualWithdrawalCapacity ?? 0)}/yr
						</b>
					</span>
					<span>
						Selected assets:{" "}
						<b className="type-value">
							{currency.format(coverageRow?.selectedAssetBalance ?? 0)}
						</b>
					</span>
					<span>
						Main constraint: <b className="type-value">{blockerValue}</b>
					</span>
				</div>
			</CardContent>
		</Card>
	);
});

function principalPolicyLabel(plan: FinancialIndependencePlan) {
	switch (plan.principalPolicy) {
		case "preserve-real-principal":
			return "preserve purchasing power";
		case "preserve-nominal-principal":
			return "preserve starting dollars";
		case "allow-drawdown":
			return "allow portfolio drawdown";
	}
}

function successPolicyDescription(plan: FinancialIndependencePlan) {
	switch (plan.principalPolicy) {
		case "preserve-real-principal":
			return "All spending must be funded and selected assets must retain their inflation-adjusted starting value.";
		case "preserve-nominal-principal":
			return "All spending must be funded and selected assets must retain their starting dollar value.";
		case "allow-drawdown":
			return "All spending must be funded; selected assets may finish below their starting value.";
	}
}
