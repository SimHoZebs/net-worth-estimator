import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { Button } from "@/components/ui/button.tsx";
import { monthDay } from "@/domain/format.ts";
import type { TransactionResult } from "@/domain/result.ts";
import { sumCents } from "@/domain/safeSpendingMath.ts";
import { cn } from "@/lib/utils.ts";
import { amountText } from "./amountText.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

/**
 * The selected-cycle bill rows, owned locally from the selected recurring
 * schedules. All cash facts come from the server response; this list never
 * renders them.
 */
function BillsList({ bills }: { bills: readonly TransactionResult[] }) {
	return (
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
	);
}

/**
 * All cash facts come from the server response. The visible Bills list is the
 * separate, locally owned bill definition: selected recurring transactions
 * for the selected cash accounts inside the selected statement cycle.
 * Every offset uses the same cash-after-bills figure with the same testid.
 */
export function SafeSpendingCashEvidence({
	summary,
	pending,
	error,
	bills,
	onRetry,
	unavailable = false,
}: {
	summary?: SafeSpendingSummary;
	pending: boolean;
	error: boolean;
	bills: readonly TransactionResult[];
	onRetry: () => void;
	/**
	 * The window has no cash evidence by contract (the summary endpoint
	 * rejects its range, e.g. it ends in the future). Render the same
	 * sections with an explicit unavailable figure instead of a loading or
	 * error state. The caller disables the query for such windows.
	 */
	unavailable?: boolean;
}) {
	// Matches the missing-evidence rendering of a fetched summary: the same
	// figure slot with an em dash, the same unavailable note, the same bills.
	if (unavailable)
		return (
			<section className="grid content-start gap-3" aria-label="Cash evidence">
				<div className="flex items-center justify-between gap-3">
					<h3 className="m-0 text-sm text-muted-foreground">
						{labels.cashAfterOutstandingBills}
					</h3>
					<strong
						className="text-base tabular-nums"
						data-testid="left-value"
					>
						{amountText(null)}
					</strong>
				</div>
				<p className="m-0 text-sm text-muted-foreground">
					Remainder unavailable
				</p>
				<BillsList bills={bills} />
			</section>
		);
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
	const cashValue = summary.cashAfterBills;
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
			{summary.status !== "available" && (
				<p className="m-0 text-sm text-muted-foreground">
					{summary.status === "uncertain"
						? "Remainder uncertain"
						: "Remainder unavailable"}
				</p>
			)}
			{(summary.checkingAvailable === null ||
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
			<BillsList bills={bills} />
		</section>
	);
}
