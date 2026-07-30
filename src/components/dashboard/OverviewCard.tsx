import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { currency, formatDate, pct } from "@/lib/format";
import type {
	FinancialIndependencePlan,
	FinancialIndependenceRow,
	FinancialIndependenceRunOutcome,
	FinancialModelDocument,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import { getFinancialIndependenceResult } from "@/lib/projection";

interface OverviewCardProps {
	result: ProjectionResult;
	document: FinancialModelDocument;
	instanceId: string;
	plan: FinancialIndependencePlan;
	candidateDate: string | null;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
}

export const OverviewCard = memo(function OverviewCard({
	result,
	document,
	instanceId,
	plan,
	candidateDate,
	stochasticResult,
	stochasticIsProvisional = false,
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
	const coverageRow = analysis?.rows.find((row) => row.date === candidateDate);
	const candidateOutcome = analysis?.runOutcomes.find(
		(outcome) => outcome.candidateDate === candidateDate,
	);
	const confidenceDate = stochasticAnalysis?.probabilistic?.selfSustainingDate;
	const confidence =
		stochasticAnalysis?.probabilistic?.fiCycleSuccessProbability;
	const qualifyingConfidence =
		stochasticAnalysis?.probabilistic?.selfSustainingProbability;
	const accountsById = new Map(
		document.accounts.map((account) => [account.id, account]),
	);
	const selectedAccountLabels =
		coverageRow?.assetContributions.map(
			(contribution) =>
				accountsById.get(contribution.accountId)?.label ??
				contribution.accountId,
		) ?? [];

	return (
		<Card className="rounded-[1.8rem] border-primary-border/45 bg-gradient-to-br from-card/96 via-card/90 to-primary-subtle/35">
			<CardContent className="p-5 md:p-6">
				<div className="mb-4 flex flex-col gap-1 rounded-2xl border border-primary-border/50 bg-primary-subtle/35 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
					<div>
						<div className="type-label">Success test</div>
						<div className="type-muted">{successPolicyDescription(plan)}</div>
					</div>
					<div className="text-left sm:text-right">
						<div className="type-value text-foreground">
							{plan.evaluationYears}-year test · {principalPolicyLabel(plan)}
						</div>
						<div className="type-caption">
							{candidateDate
								? `Snapshot ${formatDate(candidateDate)}`
								: "No complete test window"}
						</div>
					</div>
				</div>
				<div className="mb-4 rounded-2xl border border-primary-border/60 bg-primary-subtle/55 px-4 py-4 md:px-5">
					<div className="type-label">What this result means</div>
					<p className="mt-1 text-pretty text-base leading-relaxed text-foreground">
						{describeFinancialIndependenceOutcome(
							plan,
							coverageRow,
							candidateOutcome,
						)}
					</p>
					{coverageRow ? (
						<p className="mt-2 type-muted">
							{fundingSourceDescription(coverageRow, selectedAccountLabels)}
						</p>
					) : null}
				</div>
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-label">FI coverage</div>
						<div className="mt-1 type-metric text-foreground">
							{coverageRow
								? pct.format(coverageRow.coverageRatio)
								: "Not evaluated"}
						</div>
						<div className="type-muted">
							{coverageRow
								? `${currency.format(coverageRow.totalAnnualCapacity)} of ${currency.format(coverageRow.annualExpenseTarget)} per year`
								: `A complete ${plan.evaluationYears}-year test does not fit in the projection horizon`}
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
							{candidateDate === null
								? "Not evaluated"
								: confidenceDate === undefined
									? "Run Monte Carlo"
									: confidenceDate
										? formatDate(confidenceDate)
										: "Not established"}
						</div>
						<div className="type-muted line-clamp-2">
							{candidateDate === null
								? "A complete FI test does not fit in the projection horizon"
								: confidence === undefined
									? "Run Monte Carlo to evaluate confidence across independent samples"
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
						Candidate status:{" "}
						<b className="type-value">
							{candidateStatus(coverageRow, candidateOutcome)}
						</b>
					</span>
					<span>
						Direct income:{" "}
						<b className="type-value">
							{coverageRow
								? `${currency.format(coverageRow.annualDirectIncome)}/yr`
								: "Not evaluated"}
						</b>
					</span>
					<span>
						Withdrawal capacity:{" "}
						<b className="type-value">
							{coverageRow
								? `${currency.format(coverageRow.annualWithdrawalCapacity)}/yr`
								: "Not evaluated"}
						</b>
					</span>
					<span>
						Selected assets:{" "}
						<b className="type-value">
							{coverageRow
								? currency.format(coverageRow.selectedAssetBalance)
								: "Not evaluated"}
						</b>
					</span>
				</div>

				{coverageRow && coverageRow.assetContributions.length > 0 ? (
					<div className="mt-5 border-t border-border/70 pt-4">
						<div className="mb-3">
							<div className="type-label">
								Withdrawal capacity at this snapshot
							</div>
							<div className="type-muted">
								Selected account balance × maximum annual withdrawal rate
							</div>
						</div>
						<div className="overflow-x-auto">
							<div className="min-w-[34rem]">
								<div className="grid grid-cols-[minmax(10rem,1fr)_8rem_6rem_9rem] gap-3 border-b border-border/70 pb-2 type-label">
									<span>Account</span>
									<span className="text-right">Balance</span>
									<span className="text-right">Rate</span>
									<span className="text-right">Capacity / yr</span>
								</div>
								{coverageRow.assetContributions.map((contribution) => {
									const account = accountsById.get(contribution.accountId);
									return (
										<div
											key={contribution.accountId}
											className="grid grid-cols-[minmax(10rem,1fr)_8rem_6rem_9rem] gap-3 border-b border-border/45 py-2.5 text-sm last:border-0"
										>
											<span className="flex min-w-0 items-center gap-2 text-foreground/85">
												<span
													className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground"
													style={
														account?.color
															? { backgroundColor: account.color }
															: undefined
													}
												/>
												<span className="truncate">
													{account?.label ?? contribution.accountId}
												</span>
											</span>
											<span className="text-right tabular-nums">
												{currency.format(contribution.balance)}
											</span>
											<span className="text-right tabular-nums">
												{pct.format(contribution.withdrawalRate)}
											</span>
											<span className="text-right type-value tabular-nums">
												{currency.format(contribution.annualWithdrawalCapacity)}
											</span>
										</div>
									);
								})}
							</div>
						</div>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
});

function candidateStatus(
	row: FinancialIndependenceRow | undefined,
	outcome: FinancialIndependenceRunOutcome | undefined,
) {
	if (!row || !outcome) return "Not evaluated";
	if (outcome.cycleEstablished) return "Cycle established";
	if (outcome.status === "evaluated") {
		if (!outcome.expensesFullyCovered) return "Withdrawal shortfall";
		if (!outcome.principalReplenished) return "Principal policy not met";
		return "Cycle evaluated";
	}
	if (!row.minimumNetWorthMet && !row.isCovered)
		return "Net worth and capacity below gates";
	if (!row.minimumNetWorthMet) return "Net worth below gate";
	return "Capacity below expenses";
}

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

export function describeFinancialIndependenceOutcome(
	plan: FinancialIndependencePlan,
	row: FinancialIndependenceRow | undefined,
	outcome: FinancialIndependenceRunOutcome | undefined,
) {
	if (!row || !outcome) {
		return `No complete ${yearTestLabel(plan.evaluationYears)} fits in the projection horizon.`;
	}

	const target = `spending starting at ${currency.format(row.annualExpenseTarget)} per year${
		plan.annualExpenseGrowthRate > 0
			? ` and growing ${pct.format(plan.annualExpenseGrowthRate)} annually`
			: ""
	} for ${yearLabel(plan.evaluationYears)}`;
	const date = formatDate(row.date);
	if (outcome.status === "ineligible") {
		const failedGates = [
			!outcome.minimumNetWorthMet ? "the minimum net worth gate" : null,
			!outcome.initialCoverageMet ? "the initial funding-capacity gate" : null,
		].filter((gate): gate is string => gate !== null);
		return `On ${date}, this plan cannot begin the ${yearTestLabel(plan.evaluationYears)} because it does not meet ${formatList(failedGates)}.`;
	}
	if (!outcome.expensesFullyCovered) {
		return `On ${date}, this plan cannot fully fund ${target}. It leaves ${currency.format(outcome.withdrawals.shortfallAmount)} unfunded across the test, so it does not satisfy the chosen ${principalPolicyStrategyLabel(plan)}.`;
	}
	if (!outcome.principalReplenished) {
		return `On ${date}, this plan can fund ${target}, but ${failedPrincipalPolicyDescription(plan)}`;
	}
	return `On ${date}, this plan can fund ${target}. ${successfulPrincipalPolicyDescription(plan)}`;
}

function fundingSourceDescription(
	row: FinancialIndependenceRow,
	accountLabels: string[],
) {
	const directIncome =
		row.annualDirectIncome > 0
			? `At this snapshot, selected direct income contributes ${currency.format(row.annualDirectIncome)} per year.`
			: "";
	const withdrawalSources =
		accountLabels.length > 0
			? `The test selects ${formatList(accountLabels)} as withdrawal sources; their maximum annual rates and current capacities are shown below.`
			: "";
	return (
		[directIncome, withdrawalSources].filter(Boolean).join(" ") ||
		"No selected income or withdrawal sources contribute at this snapshot."
	);
}

function successfulPrincipalPolicyDescription(plan: FinancialIndependencePlan) {
	switch (plan.principalPolicy) {
		case "preserve-real-principal":
			return "Selected assets collectively retain their inflation-adjusted starting value.";
		case "preserve-nominal-principal":
			return "Selected assets collectively retain their starting dollar value.";
		case "allow-drawdown":
			return "Selected assets may finish below their starting balance under the chosen drawdown strategy.";
	}
}

function failedPrincipalPolicyDescription(plan: FinancialIndependencePlan) {
	switch (plan.principalPolicy) {
		case "preserve-real-principal":
			return "selected assets collectively do not retain their inflation-adjusted starting value.";
		case "preserve-nominal-principal":
			return "selected assets collectively do not retain their starting dollar value.";
		case "allow-drawdown":
			return "the selected drawdown strategy is not satisfied.";
	}
}

function principalPolicyStrategyLabel(plan: FinancialIndependencePlan) {
	switch (plan.principalPolicy) {
		case "preserve-real-principal":
			return "purchasing-power preservation strategy";
		case "preserve-nominal-principal":
			return "starting-dollar preservation strategy";
		case "allow-drawdown":
			return "portfolio-drawdown strategy";
	}
}

function yearLabel(years: number) {
	return `${years} ${years === 1 ? "year" : "years"}`;
}

function yearTestLabel(years: number) {
	return `${years}-year test`;
}

function formatList(items: string[]) {
	if (items.length < 2) return items[0] ?? "the required gates";
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
