import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { billRow, statementRow } from "./allowanceLedger.ts";
import {
	BudgetAmount,
	budgetDate,
	BudgetMetric,
	BudgetSplit,
	firstBudgetShare,
} from "./budgetDisplay.tsx";
import { ObligationRows } from "./SafeSpendingObligationLedger.tsx";

export function SafeSpendingPayday({
	summary,
}: {
	summary: SafeSpendingSummary;
}) {
	const { payoffDate, paymentPeriodStart, paidByPayday, unpaidByPayday } =
		summary;
	const payoffLabel = budgetDate(payoffDate);
	const periodStart = budgetDate(paymentPeriodStart);
	const showProgress = firstBudgetShare(paidByPayday, unpaidByPayday) !== null;
	const bills = (summary.bills ?? [])
		.filter((bill) => {
			if (payoffDate && bill.date > payoffDate) return false;
			return (
				bill.status !== "paid" ||
				!paymentPeriodStart ||
				bill.date >= paymentPeriodStart ||
				(bill.actualDate !== null && bill.actualDate >= paymentPeriodStart)
			);
		})
		.map((bill) => ({
			...billRow(bill),
			detail:
				bill.status === "paid"
					? "Paid"
					: bill.status === "pending"
						? "Pending · Estimated"
						: bill.status === "unknown"
							? "Payment unverified"
							: "Still to pay · Estimated",
		}));
	const cards = (summary.statements ?? [])
		.filter(
			(statement) => statement.amount !== 0 || statement.kind === "estimated",
		)
		.map(statementRow);

	return (
		<section
			aria-label="Bills and payments"
			className="grid gap-2 border-t border-border pt-3"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h3 className="m-0 text-sm font-semibold">
					Bills and payments
					{payoffLabel && (
						<>
							{" "}
							by <time dateTime={payoffDate}>{payoffLabel}</time>
						</>
					)}
				</h3>
				{periodStart && payoffLabel && (
					<p className="m-0 text-xs text-muted-foreground">
						<time dateTime={paymentPeriodStart}>{periodStart}</time> –{" "}
						<time dateTime={payoffDate}>{payoffLabel}</time>
					</p>
				)}
			</div>
			<BudgetSplit
				first={paidByPayday}
				second={unpaidByPayday}
				testId="payment-progress"
			/>
			<dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
				<BudgetMetric
					label="Already paid"
					value={paidByPayday}
					testId="paid-by-payday"
					stacked
					segment={showProgress ? "first" : undefined}
				/>
				<BudgetMetric
					label="Still to pay"
					value={unpaidByPayday}
					testId="unpaid-by-payday"
					stacked
					segment={showProgress ? "second" : undefined}
				/>
			</dl>
			{summary.reasons?.includes("possible-pending-payment-overlap") && (
				<p className="m-0 text-xs text-muted-foreground">
					Possible pending payment overlap
				</p>
			)}
			<details className="text-sm">
				<summary className="cursor-pointer py-1.5 font-medium">
					Payment details
				</summary>
				{bills.length ? (
					<ObligationRows label="Bills through payday" rows={bills} />
				) : (
					<p className="m-0 text-xs text-muted-foreground">
						No bill details
					</p>
				)}
			</details>
			<details className="rounded-md border border-border px-2.5 text-sm">
				<summary className="cursor-pointer py-2 font-medium">
					Credit cards to pay
					{payoffLabel && (
						<>
							{" "}
							· <time dateTime={payoffDate}>{payoffLabel}</time>
						</>
					)}{" "}
					· <BudgetAmount value={summary.statementReserve} />
				</summary>
				{cards.length ? (
					<div className="pb-2">
						<ObligationRows label="Card payoff details" rows={cards} />
					</div>
				) : (
					<p className="m-0 pb-2 text-xs text-muted-foreground">
						No card payoff details
					</p>
				)}
			</details>
		</section>
	);
}
