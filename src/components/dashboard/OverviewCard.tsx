import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { currency, formatDate, pct } from "@/lib/format";
import type {
	FinancialIndependenceDetailedRunOutcome,
	FinancialIndependencePlan,
	FinancialIndependenceRow,
	FinancialModelDocument,
} from "@/lib/projection";

interface OverviewCardProps {
	document: FinancialModelDocument;
	plan: FinancialIndependencePlan;
	row: FinancialIndependenceRow | undefined;
	outcome: FinancialIndependenceDetailedRunOutcome | undefined;
}

export const OverviewCard = memo(function OverviewCard({
	document,
	plan,
	row,
	outcome,
}: OverviewCardProps) {
	const accountsById = new Map(
		document.accounts.map((account) => [account.id, account]),
	);
	const postingsById = new Map(
		document.postings.map((posting) => [posting.id, posting]),
	);
	const directIncomeLabels = [
		...new Set(
			plan.sources.flatMap((source) => {
				if (source.type !== "cashflow" || !source.included) return [];
				const posting = postingsById.get(source.postingId);
				return posting?.enabled ? [posting.label] : [];
			}),
		),
	];

	return (
		<Card className="rounded-[1.8rem] border-primary-border/55 bg-gradient-to-br from-card/96 via-card/92 to-primary-subtle/30">
			<CardContent className="p-5 md:p-6">
				{row && outcome ? (
					<>
						<div className="border-b border-border/70 pb-5">
							<div className="type-eyebrow">Financial independence result</div>
							<h3 className="mt-2 text-balance text-xl font-semibold tracking-tight text-foreground md:text-2xl">
								On {formatDate(row.date)}, relying on:
							</h3>
							<div className="mt-1 type-caption">
								Spending input: {expenseBasisLabel(plan)}
							</div>
						</div>

						{directIncomeLabels.length > 0 || row.annualDirectIncome > 0 ? (
							<div className="border-b border-border/70 py-4">
								<div className="type-label">Selected direct income</div>
								<div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
									<span className="text-foreground/85">
										{directIncomeLabels.length > 0
											? formatList(directIncomeLabels)
											: "Selected cash flow"}
									</span>
									<strong className="type-value tabular-nums">
										{currency.format(row.annualDirectIncome)} / year
									</strong>
								</div>
								<p className="mt-1 type-caption">
									Initial annualized contribution used by the FI test.
								</p>
							</div>
						) : null}

						{row.assetContributions.length > 0 ? (
							<div className="py-4">
								<div className="mb-3 type-label">Selected accounts</div>
								<div className="overflow-x-auto">
									<div className="min-w-[34rem]">
										<div className="grid grid-cols-[minmax(10rem,1fr)_8rem_7rem_9rem] gap-3 border-b border-border/70 pb-2 type-label">
											<span>Account</span>
											<span className="text-right">FI-date balance</span>
											<span className="text-right">Withdrawal rate</span>
											<span className="text-right">Available / year</span>
										</div>
										{row.assetContributions.map((contribution) => {
											const account = accountsById.get(contribution.accountId);
											return (
												<div
													key={contribution.accountId}
													className="grid grid-cols-[minmax(10rem,1fr)_8rem_7rem_9rem] gap-3 border-b border-border/45 py-3 text-sm last:border-0"
												>
													<span className="flex min-w-0 items-center gap-2 text-foreground/85">
														<span
															className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground"
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
													<strong className="text-right type-value tabular-nums">
														{currency.format(
															contribution.annualWithdrawalCapacity,
														)}
													</strong>
												</div>
											);
										})}
										<div className="grid grid-cols-[minmax(10rem,1fr)_8rem_7rem_9rem] gap-3 border-t-2 border-border/80 py-3 text-sm">
											<strong className="type-value">
												Total from accounts
											</strong>
											<strong className="text-right type-value tabular-nums">
												{currency.format(row.selectedAssetBalance)}
											</strong>
											<span className="text-right text-muted-foreground">
												-
											</span>
											<strong className="text-right type-value tabular-nums">
												{currency.format(row.annualWithdrawalCapacity)}
											</strong>
										</div>
										{row.annualDirectIncome > 0 ? (
											<div className="grid grid-cols-[minmax(10rem,1fr)_8rem_7rem_9rem] gap-3 border-t border-border/60 py-3 text-sm">
												<strong className="type-value">
													Total available / year
												</strong>
												<span />
												<span />
												<strong className="text-right type-value tabular-nums text-primary">
													{currency.format(row.totalAnnualCapacity)}
												</strong>
											</div>
										) : null}
									</div>
								</div>
							</div>
						) : null}

						<div className="rounded-2xl border border-primary-border/60 bg-primary-subtle/55 px-4 py-4 md:px-5">
							<div className="type-label">Result</div>
							<p className="mt-1 text-pretty text-base leading-relaxed text-foreground">
								{describeFinancialIndependenceOutcome(plan, row, outcome)}
							</p>
						</div>
					</>
				) : (
					<div className="rounded-2xl border border-dashed border-border/80 p-5">
						<div className="type-eyebrow">Financial independence result</div>
						<p className="mt-2 text-pretty text-foreground">
							{describeFinancialIndependenceOutcome(plan, row, outcome)}
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
});

function expenseBasisLabel(plan: FinancialIndependencePlan) {
	return plan.annualExpenseTargetBasis === "projection-start-purchasing-power"
		? "projection-start purchasing power"
		: "dollars at FI start";
}

export function describeFinancialIndependenceOutcome(
	plan: FinancialIndependencePlan,
	row: FinancialIndependenceRow | undefined,
	outcome: FinancialIndependenceDetailedRunOutcome | undefined,
) {
	if (!row || !outcome) {
		return `No complete ${yearTestLabel(plan.evaluationYears)} fits in the projection horizon.`;
	}

	if (outcome.status === "ineligible") {
		const failedGates = [
			!outcome.minimumNetWorthMet ? "the minimum net worth gate" : null,
			!outcome.initialCoverageMet ? "the initial funding-capacity gate" : null,
		].filter((gate): gate is string => gate !== null);
		return `This plan cannot begin the ${yearTestLabel(plan.evaluationYears)} because it does not meet ${formatList(failedGates)}.`;
	}

	const target = `spending starting at ${currency.format(row.annualExpenseTarget)} per year${
		plan.annualExpenseGrowthRate > 0
			? ` and growing ${pct.format(plan.annualExpenseGrowthRate)} annually`
			: ""
	} for ${yearLabel(plan.evaluationYears)}`;
	if (!outcome.expensesFullyCovered) {
		return `This plan cannot fully fund ${target}. It leaves ${currency.format(outcome.withdrawals.shortfallAmount)} unfunded across the test, so it does not satisfy the chosen ${principalPolicyStrategyLabel(plan)}.`;
	}
	if (!outcome.principalReplenished) {
		return `This plan can fund ${target}, but ${failedPrincipalPolicyDescription(plan)}`;
	}
	return `This plan can fund ${target}. ${successfulPrincipalPolicyDescription(plan)}`;
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
