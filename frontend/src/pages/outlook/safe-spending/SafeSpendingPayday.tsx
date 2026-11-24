import type { SafeSpendingBill } from "@/api/generated/model/safeSpendingBill.ts";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { SegmentedBar } from "@/components/SegmentedBar.tsx";
import { exactMoney } from "@/domain/format.ts";
import {
	budgetDate,
	BudgetMetric,
	firstBudgetShare,
} from "./budgetDisplay.tsx";
import { ObligationRows } from "./ObligationRows.tsx";
import type { ObligationRow } from "./safeSpendingDetailModel.ts";

function billRow(bill: SafeSpendingBill): ObligationRow {
	return {
		id: bill.id,
		name: bill.name,
		date: bill.actualDate || bill.date,
		amount: bill.amount,
		detail: null,
	};
}

export function SafeSpendingPayday({
	summary,
}: {
	summary: SafeSpendingSummary;
}) {
	const { payoffDate, paymentPeriodStart, paidByPayday, unpaidByPayday } =
		summary;
	const payoffLabel = budgetDate(payoffDate);
	const periodStart = budgetDate(paymentPeriodStart);
	const progress =
		paidByPayday != null &&
		unpaidByPayday != null &&
		firstBudgetShare(paidByPayday, unpaidByPayday) !== null
			? { paid: paidByPayday, unpaid: unpaidByPayday }
			: null;
	const bills = (summary.bills ?? [])
		.filter((bill) => {
			if (payoffDate && bill.date > payoffDate) return false;
			return bill.status !== "paid";
		})
		.map((bill) => ({
			...billRow(bill),
			detail:
				bill.status === "pending"
					? "Pending · Estimated"
					: bill.status === "unknown"
						? "Payment unverified"
						: "Still to pay · Estimated",
		}));

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
			{progress ? (
				<SegmentedBar
					caption="Payment progress"
					captionClassName="sr-only"
					formatAmount={exactMoney}
					ariaLabel={`Payment progress: Already paid ${exactMoney(progress.paid)}. Still to pay ${exactMoney(progress.unpaid)}.`}
					segments={[
						{
							label: "Already paid",
							amount: progress.paid,
							tone: "sage",
							pattern: "solid",
							testId: "paid-by-payday",
						},
						{
							label: "Still to pay",
							amount: progress.unpaid,
							tone: "tan",
							pattern: "dots",
							testId: "unpaid-by-payday",
						},
					]}
				/>
			) : (
				<dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
					<BudgetMetric
						label="Already paid"
						value={paidByPayday}
						testId="paid-by-payday"
						stacked
					/>
					<BudgetMetric
						label="Still to pay"
						value={unpaidByPayday}
						testId="unpaid-by-payday"
						stacked
					/>
				</dl>
			)}
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
					<p className="m-0 text-xs text-muted-foreground">No bill details</p>
				)}
			</details>
		</section>
	);
}
