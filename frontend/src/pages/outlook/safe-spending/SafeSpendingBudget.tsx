import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { amountText } from "./amountText.ts";
import {
	BudgetAmount,
	budgetDate,
	BudgetMetric,
	BudgetSplit,
	firstBudgetShare,
} from "./budgetDisplay.tsx";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
import { SafeSpendingPayday } from "./SafeSpendingPayday.tsx";

function missingBudgetEvidence(summary: SafeSpendingSummary): string | null {
	if (summary.fundingRoom != null) return null;
	if (summary.checkingAvailable == null) return "Available cash unverified";
	if (summary.expectedPay == null) return "Next paycheck unknown";
	if (summary.statementReserve == null) return "Next card payoff unverified";
	return "Upcoming payments unverified";
}

export function SafeSpendingBudget({
	summary,
	savingsTarget,
}: {
	summary: SafeSpendingSummary;
	savingsTarget: number;
}) {
	const {
		cycleReset,
		daysUntilReset,
		nextCycleEnd,
		nextCycleDiscretionary,
		nextCycleIncome,
		nextCycleCarryover,
		forecastCashRoom,
		payday,
	} = summary;
	const reset = budgetDate(cycleReset);
	const nextEnd = budgetDate(nextCycleEnd);
	const fundingPaycheck = budgetDate(payday);
	const missingEvidence = missingBudgetEvidence(summary);
	const showComposition =
		firstBudgetShare(nextCycleIncome, nextCycleCarryover) !== null;
	return (
		<div className="grid min-w-0 gap-4">
			<section aria-label={labels.cycleBudget} className="grid gap-2">
				<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
					<h3 className="m-0 text-sm font-semibold">{labels.cycleBudget}</h3>
					{fundingPaycheck && (
						<p className="m-0 text-xs text-muted-foreground">
							<time dateTime={payday ?? undefined}>{fundingPaycheck}</time>{" "}
							paycheck
						</p>
					)}
				</div>
				{reset && (
					<p className="m-0 text-xs text-muted-foreground">
						{daysUntilReset === 0
							? "Resets today"
							: daysUntilReset > 0
								? `Resets in ${daysUntilReset} ${daysUntilReset === 1 ? "day" : "days"}`
								: "Resets"}{" "}
						· <time dateTime={cycleReset}>{reset}</time>
					</p>
				)}
				{missingEvidence && (
					<p className="m-0 text-xs text-muted-foreground">{missingEvidence}</p>
				)}
				<dl className="m-0 grid gap-2 text-sm">
					<BudgetMetric
						primary
						label={labels.withCashCushion}
						value={summary.fundingRoom}
						testId="with-cash-cushion"
					/>
					<BudgetMetric
						primary
						label={labels.withoutCashCushion}
						value={summary.incomeFunded}
						testId="income-funded"
						describeShortfall={(amount) => `Over by ${amount}`}
					/>
					<BudgetMetric
						primary
						label={`${labels.afterSavingsGoal} (${amountText(savingsTarget)} goal)`}
						value={summary.savingsAllowance}
						testId="savings-allowance"
						describeShortfall={(amount) => `Short of goal by ${amount}`}
					/>
					<BudgetMetric
						label={labels.additionalSavings}
						value={summary.additionalSavings}
						testId="additional-savings"
						describeShortfall={(amount) => `Uses ${amount} from your cushion`}
					/>
				</dl>
			</section>
			<SafeSpendingPayday summary={summary} />
			<section
				aria-label="Next cycle spending"
				className="grid gap-2 border-t border-border pt-3"
			>
				<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
					<h3 className="m-0 text-sm font-semibold">Next cycle spending</h3>
					{(reset || nextEnd) && (
						<p className="m-0 text-xs text-muted-foreground">
							{reset && (
								<>
									{!nextEnd && "Starts "}
									<time dateTime={cycleReset}>{reset}</time>
								</>
							)}
							{reset && nextEnd ? " – " : nextEnd ? "Through " : ""}
							{nextEnd && (
								<time dateTime={nextCycleEnd ?? undefined}>{nextEnd}</time>
							)}
						</p>
					)}
				</div>
				<p className="m-0 text-xl font-semibold">
					<BudgetAmount
						value={nextCycleDiscretionary}
						testId="discretionary-next-cycle"
					/>
				</p>
				{forecastCashRoom != null && forecastCashRoom < 0 && (
					<p className="m-0 text-xs font-medium text-danger-text">
						Short by {amountText(-forecastCashRoom)} before a scheduled payment
					</p>
				)}
				<BudgetSplit
					first={nextCycleIncome}
					second={nextCycleCarryover}
					testId="next-cycle-composition"
				/>
				<dl className="m-0 grid gap-1 text-sm">
					<BudgetMetric
						label="From income"
						value={nextCycleIncome}
						testId="next-cycle-income"
						segment={showComposition ? "first" : undefined}
					/>
					<BudgetMetric
						label="Cash carried forward"
						value={nextCycleCarryover}
						testId="next-cycle-carryover"
						segment={showComposition ? "second" : undefined}
					/>
				</dl>
			</section>
		</div>
	);
}
