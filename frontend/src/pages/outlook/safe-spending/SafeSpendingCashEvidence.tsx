import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { Button } from "@/components/ui/button.tsx";
import { exactMoney, monthDay } from "@/domain/format.ts";
import { cn } from "@/lib/utils.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

const amountText = (amount: number | null) =>
	amount === null ? "—" : exactMoney(amount);

/** All monetary values and supporting rows come from the same server response. */
export function SafeSpendingCashEvidence({
	summary,
	pending,
	error,
	historical,
	onRetry,
}: {
	summary?: SafeSpendingSummary;
	pending: boolean;
	error: boolean;
	historical: boolean;
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
	const cashValue = historical
		? summary.checkingAvailable
		: summary.cashAfterBills;
	const hasShortfall = !historical && cashValue !== null && cashValue < 0;
	return (
		<section className="grid content-start gap-3" aria-label="Cash evidence">
			{(!historical || cashValue !== null) && (
				<>
					<div className="flex items-center justify-between gap-3">
						<h3 className="m-0 text-sm text-muted-foreground">
							{historical
								? "Available cash at close"
								: labels.cashAfterOutstandingBills}
						</h3>
						<strong
							className={cn(
								"text-base tabular-nums",
								hasShortfall && "text-danger-text",
							)}
							data-testid={historical ? "close-cash-value" : "left-value"}
						>
							{amountText(cashValue)}
						</strong>
					</div>
					{historical && (
						<p className="m-0 text-xs text-muted-foreground">
							Available cash evidence · {monthDay(summary.start)} · Excludes
							future income
						</p>
					)}
				</>
			)}
			{historical && summary.checkingAvailable === null && (
				<p className="m-0 text-sm text-muted-foreground">
					No balance recorded at close
				</p>
			)}
			{!historical && summary.status !== "available" && (
				<p className="m-0 text-sm text-muted-foreground">
					{summary.status === "uncertain"
						? "Remainder uncertain"
						: "Remainder unavailable"}
				</p>
			)}
			{!historical &&
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
								.filter((baseline) => baseline.availableBalance !== null)
								.map((baseline) => (
									<div
										key={baseline.accountId}
										className="flex justify-between gap-3"
									>
										<dt>{baseline.accountName} · observed available</dt>
										<dd className="m-0 tabular-nums">
											{amountText(baseline.availableBalance)}
										</dd>
									</div>
								))
						)}
					</dl>
				)}
			{!historical && (
				<div className="mt-1 grid gap-3 border-t border-border pt-4">
					<div className="flex items-center justify-between gap-3">
						<h3 className="m-0 text-sm font-semibold">Outstanding bills</h3>
						<strong className="text-base tabular-nums">
							{amountText(summary.outstandingBillsTotal)}
						</strong>
					</div>
					{(summary.outstandingObligations ?? []).length === 0 && (
						<p className="m-0 text-xs text-muted-foreground">
							No outstanding bills.
						</p>
					)}
					{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes native list semantics for list-style:none. */}
					<ul
						className="m-0 list-none divide-y divide-border p-0"
						role="list"
						aria-label="Outstanding bills in selected range"
					>
						{(summary.outstandingObligations ?? []).map((row) => (
							<li
								key={row.id}
								className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 text-sm"
							>
								<div className="grid min-w-0 gap-1">
									<span>{row.name}</span>
									<p className="m-0 text-xs text-muted-foreground">
										{monthDay(row.date)}
										{row.status === "pending-coverage-unknown" &&
											" · Pending payment coverage unknown"}
										{row.status === "payment-status-unknown" &&
											" · Payment status unknown"}
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
			)}
		</section>
	);
}
