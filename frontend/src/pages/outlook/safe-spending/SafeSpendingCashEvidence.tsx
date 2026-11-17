import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { Button } from "@/components/ui/button.tsx";
import { monthDay } from "@/domain/format.ts";
import type { TransactionResult } from "@/domain/result.ts";
import { sumCents } from "@/domain/safeSpendingMath.ts";
import { cn } from "@/lib/utils.ts";
import { amountText } from "./amountText.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

/**
 * All cash facts come from the server response. The visible Bills list is the
 * separate, locally owned bill definition: selected recurring transactions
 * for the selected cash accounts inside the current safe card cycle.
 */
export function SafeSpendingCashEvidence({
	summary,
	pending,
	error,
	closed,
	bills,
	onRetry,
}: {
	summary?: SafeSpendingSummary;
	pending: boolean;
	error: boolean;
	closed: boolean;
	bills: readonly TransactionResult[];
	onRetry: () => void;
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
	const cashValue = closed ? summary.checkingAvailable : summary.cashAfterBills;
	const hasShortfall = !closed && cashValue !== null && cashValue < 0;
	return (
		<section className="grid content-start gap-3" aria-label="Cash evidence">
			{(!closed || cashValue !== null) && (
				<>
					<div className="flex items-center justify-between gap-3">
						<h3 className="m-0 text-sm text-muted-foreground">
							{closed
								? "Available cash at close"
								: labels.cashAfterOutstandingBills}
						</h3>
						<strong
							className={cn(
								"text-base tabular-nums",
								hasShortfall && "text-danger-text",
							)}
							data-testid={closed ? "close-cash-value" : "left-value"}
						>
							{amountText(cashValue)}
						</strong>
					</div>
					{closed && (
						<p className="m-0 text-xs text-muted-foreground">
							Available cash evidence · {monthDay(summary.start)} · Excludes
							future income
						</p>
					)}
				</>
			)}
			{closed && summary.checkingAvailable === null && (
				<p className="m-0 text-sm text-muted-foreground">
					No balance recorded at close
				</p>
			)}
			{!closed && summary.status !== "available" && (
				<p className="m-0 text-sm text-muted-foreground">
					{summary.status === "uncertain"
						? "Remainder uncertain"
						: "Remainder unavailable"}
				</p>
			)}
			{!closed &&
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
			{!closed && (
				<div className="mt-1 grid gap-3 border-t border-border pt-4">
					<div className="flex items-center justify-between gap-3">
						<h3 className="m-0 text-sm font-semibold">{labels.bills}</h3>
						<strong className="text-base tabular-nums">
							{amountText(
								bills.length ? sumCents(bills, (row) => row.requested) : null,
							)}
						</strong>
					</div>
					{bills.length === 0 && (
						<p className="m-0 text-xs text-muted-foreground">No bills.</p>
					)}
					{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes native list semantics for list-style:none. */}
					<ul
						className="m-0 list-none divide-y divide-border p-0"
						role="list"
						aria-label={labels.billsInCycle}
					>
						{bills.map((row, index) => (
							<li
								key={`${row.transactionId}-${row.date}-${index}`}
								className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 text-sm"
							>
								<div className="grid min-w-0 gap-1">
									<span>{row.name}</span>
									<p className="m-0 text-xs text-muted-foreground">
										{monthDay(row.date)}
									</p>
								</div>
								<span className="shrink-0 tabular-nums">
									{amountText(row.requested)}
								</span>
							</li>
						))}
					</ul>
					{/* oxlint-enable jsx-a11y/no-redundant-roles */}
				</div>
			)}
		</section>
	);
}
