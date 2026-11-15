import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { Button } from "@/components/ui/button.tsx";
import { dateLabel, exactMoney, monthDay } from "@/domain/format.ts";
import { cn } from "@/lib/utils.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

const amountText = (amount: number | null) =>
	amount === null ? "—" : exactMoney(amount);
const pendingCoverageExplanation =
	"A pending payment may already be included in available cash, so the exact remainder is unavailable.";
const reasonExplanations: Record<string, string> = {
	"cash-baseline-missing": "No cash observation covers this date.",
	"available-balance-missing":
		"The observation does not include an available balance.",
	"cash-accounts-missing": "No selected cash account has usable cash evidence.",
	"pending-baseline-coverage-unknown": pendingCoverageExplanation,
	"pending-after-baseline-coverage-unknown": pendingCoverageExplanation,
	"pending-obligation-coverage-unknown": pendingCoverageExplanation,
	"posted-hold-coverage-unknown":
		"A posted payment may still be covered by a hold in the observed available balance, so the exact remainder is unavailable.",
	"scheduled-payment-status-unknown":
		"A scheduled bill may already be paid and included in the cash observation. Its payment status is unverified.",
	"posted-routing-unknown":
		"The cash account affected by a recorded payment is unverified.",
	"posted-amount-unavailable":
		"A recorded cash movement has an unresolved amount.",
	"obligation-routing-unknown":
		"The cash account responsible for a bill is unverified.",
	"obligation-amount-unavailable": "A bill has an unresolved amount.",
	"negative-obligation-amount": "A bill has an invalid negative amount.",
};
const reasonText = (reason: string) =>
	Object.hasOwn(reasonExplanations, reason)
		? reasonExplanations[reason]
		: "Some cash evidence could not be verified.";

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
			{hasShortfall && cashValue !== null && (
				<p className="m-0 text-sm text-danger-text">
					Short by {exactMoney(Math.abs(cashValue))} for these bills
				</p>
			)}
			<p className="m-0 text-xs text-muted-foreground">
				{historical
					? `Available cash evidence · ${monthDay(summary.start)} · Excludes future income`
					: `Bills due ${monthDay(summary.start)} – ${monthDay(summary.end)} · Excludes future income and earlier bills`}
			</p>
			{historical && summary.checkingAvailable === null && (
				<p className="m-0 text-sm text-muted-foreground">
					Cash balance at close unavailable
				</p>
			)}
			{historical && summary.checkingAvailable === null && (
				<p className="m-0 text-xs text-muted-foreground">
					Available cash at close is not evidenced. An observed posted balance
					is not an available balance.
				</p>
			)}
			{!historical && summary.status !== "available" && (
				<p className="m-0 text-sm text-muted-foreground">
					Cash after outstanding bills{" "}
					{summary.status === "uncertain" ? "uncertain" : "unavailable"}
				</p>
			)}
			{(summary.reasons ?? []).length > 0 && (
				<p className="m-0 text-xs text-muted-foreground">
					{(summary.reasons ?? []).map(reasonText).join(" · ")}
				</p>
			)}
			{!historical && (
				<dl className="m-0 grid gap-2 text-sm">
					<div className="flex justify-between gap-3">
						<dt>Cash from recorded evidence</dt>
						<dd className="m-0 tabular-nums">
							{amountText(summary.checkingAvailable)}
						</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt>Outstanding bills</dt>
						<dd className="m-0 tabular-nums">
							{amountText(summary.outstandingBillsTotal)}
						</dd>
					</div>
				</dl>
			)}
			<div className="grid gap-2" aria-label="Cash account observations">
				{(summary.baselines ?? []).map((baseline) => {
					const instant =
						baseline.observedAt === null
							? null
							: new Date(baseline.observedAt * 1000).toISOString();
					return (
						<div
							key={baseline.accountId}
							className="grid gap-1 text-xs text-muted-foreground"
						>
							<p className="m-0">
								{baseline.accountName} ·{" "}
								{baseline.basis === "missing"
									? "Observation unavailable"
									: baseline.basis}
								{instant && (
									<>
										{" "}
										·{" "}
										<time dateTime={instant}>
											{dateLabel(instant, true)} · {instant.slice(11, 19)} UTC
										</time>
									</>
								)}
							</p>
							<p className="m-0">
								Posted {amountText(baseline.postedBalance)} · Available{" "}
								{amountText(baseline.availableBalance)}
							</p>
							{(baseline.reasons ?? []).length > 0 && (
								<p className="m-0">
									{(baseline.reasons ?? []).map(reasonText).join(" · ")}
								</p>
							)}
						</div>
					);
				})}
			</div>
			{!historical && (
				<div
					className="grid gap-2"
					aria-label="Outstanding bills in selected range"
				>
					<h4 className="m-0 text-sm">
						Outstanding bills through {monthDay(summary.end)}
					</h4>
					{(summary.outstandingObligations ?? []).length === 0 && (
						<p className="m-0 text-xs text-muted-foreground">
							No outstanding bills.
						</p>
					)}
					{(summary.outstandingObligations ?? []).map((row) => (
						<div key={row.id} className="grid gap-1 text-sm">
							<div className="flex justify-between gap-3">
								<span>{row.name}</span>
								<strong className="tabular-nums">
									{amountText(row.amount)}
								</strong>
							</div>
							<p className="m-0 text-xs text-muted-foreground">
								{monthDay(row.date)}
								{row.status === "pending-coverage-unknown" &&
									" · Pending payment coverage unknown"}
								{row.status === "payment-status-unknown" &&
									" · Payment status unknown"}
							</p>
						</div>
					))}
				</div>
			)}
			{(summary.confirmedMovements ?? []).length > 0 && (
				<div className="grid gap-2" aria-label="Confirmed cash movements">
					<h4 className="m-0 text-sm">
						{historical
							? "Recorded cash payments and transfers"
							: "Confirmed movements since each observation"}
					</h4>
					{(summary.confirmedMovements ?? []).map((row) => (
						<div
							key={`${row.transactionId}-${row.accountId}`}
							className="flex justify-between gap-3 text-sm"
						>
							<span>{row.name}</span>
							<span className="tabular-nums">{exactMoney(row.amount)}</span>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
