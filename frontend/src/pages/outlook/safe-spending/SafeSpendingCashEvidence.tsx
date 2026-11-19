import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { Button } from "@/components/ui/button.tsx";
import { monthDay } from "@/domain/format.ts";
import type { SafeSpendingBill } from "@/api/generated/model/safeSpendingBill.ts";
import { cn } from "@/lib/utils.ts";
import { amountText } from "./amountText.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

const statusLabels = {
	paid: null,
	unpaid: null,
	pending: "Pending",
	unknown: "Payment unknown",
} satisfies Record<SafeSpendingBill["status"], string | null>;

function BillsList({ summary }: { summary: SafeSpendingSummary }) {
	const bills = (summary.bills ?? []).filter((row) => row.status !== "paid");
	return (
		<div className="mt-1 grid gap-3 border-t border-border pt-4">
			<div className="flex items-center justify-between gap-3">
				<h3 className="m-0 text-sm font-semibold">{labels.bills}</h3>
				<strong className="text-base tabular-nums">
					{amountText(summary.outstandingBillsTotal)}
				</strong>
			</div>
			{bills.length === 0 && (
				<p className="m-0 text-xs text-muted-foreground">No upcoming bills.</p>
			)}
			{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes native list semantics for list-style:none. */}
			<ul
				className="m-0 list-none divide-y divide-border p-0"
				role="list"
				aria-label={labels.billsInCycle}
			>
				{bills.map((row) => (
					<li
						key={row.id}
						className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 text-sm"
					>
						<div className="grid min-w-0 gap-1">
							<span>{row.name}</span>
							<p className="m-0 text-xs text-muted-foreground">
								{monthDay(row.date)}
								{statusLabels[row.status] && ` · ${statusLabels[row.status]}`}
							</p>
						</div>
						<span className="shrink-0 tabular-nums">
							{amountText(row.amount)}
						</span>
					</li>
				))}
			</ul>
			{/* oxlint-enable jsx-a11y/no-redundant-roles */}
		</div>
	);
}

export function SafeSpendingCashEvidence({
	summary,
	pending,
	error,
	onRetry,
	upcoming = false,
}: {
	summary?: SafeSpendingSummary;
	pending: boolean;
	error: boolean;
	onRetry: () => void;
	upcoming?: boolean;
}) {
	if (!summary)
		return (
			<div aria-busy={pending} className="grid gap-2">
				<p className="m-0 text-sm text-muted-foreground">
					{error
						? "Cash evidence could not be loaded."
						: "Loading cash evidence…"}
				</p>
				{error && (
					<Button variant="link" onClick={onRetry}>
						Retry cash evidence
					</Button>
				)}
			</div>
		);
	const cashValue = upcoming ? null : summary.cashAfterBills;
	const hasShortfall = cashValue !== null && cashValue < 0;
	return (
		<section className="grid content-start gap-3" aria-label="Cash evidence">
			<div className="flex items-center justify-between gap-3">
				<h3 className="m-0 text-sm text-muted-foreground">
					{labels.cashAfterOutstandingBills}
				</h3>
				<strong
					className={cn(
						"text-base tabular-nums",
						hasShortfall && "text-danger-text",
					)}
					data-testid="left-value"
				>
					{amountText(cashValue)}
				</strong>
			</div>
			{(upcoming || summary.status !== "available") && (
				<p className="m-0 text-sm text-muted-foreground">
					{!upcoming && summary.status === "uncertain"
						? "Remainder uncertain"
						: "Remainder unavailable"}
				</p>
			)}
			{!upcoming &&
				(summary.checkingAvailable === null ||
					summary.checkingAvailable !== cashValue) && (
					<dl className="m-0 grid gap-2 text-sm">
						{summary.checkingAvailable !== null ? (
							<div className="flex justify-between gap-3">
								<dt>Available cash</dt>
								<dd className="m-0 tabular-nums">
									{amountText(summary.checkingAvailable)}
								</dd>
							</div>
						) : (
							(summary.baselines ?? [])
								.filter(
									(baseline) =>
										baseline.availableBalance !== null ||
										(baseline.basis === "posted" &&
											baseline.postedBalance !== null),
								)
								.map((baseline) => {
									const observed = baseline.availableBalance !== null;
									return (
										<div
											key={baseline.accountId}
											className="flex justify-between gap-3"
										>
											<dt>
												{baseline.accountName} ·{" "}
												{observed ? "observed available" : "posted balance"}
											</dt>
											<dd className="m-0 tabular-nums">
												{amountText(
													observed
														? baseline.availableBalance
														: baseline.postedBalance,
												)}
											</dd>
										</div>
									);
								})
						)}
					</dl>
				)}
			<BillsList summary={summary} />
		</section>
	);
}
