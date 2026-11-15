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
	const billWindow = `${monthDay(summary.start)}–${summary.start.slice(0, 7) === summary.end.slice(0, 7) ? Number(summary.end.slice(8)) : monthDay(summary.end)}`;
	const explanations = [
		...new Set(
			[
				...(summary.reasons ?? []),
				...(summary.baselines ?? []).flatMap(
					(baseline) => baseline.reasons ?? [],
				),
			].map(reasonText),
		),
	];
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
					<p className="m-0 text-xs text-muted-foreground">
						{historical
							? `Available cash evidence · ${monthDay(summary.start)} · Excludes future income`
							: `${billWindow} bills · income excluded`}
					</p>
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
				<details>
					<summary className="text-sm">
						Bills {amountText(summary.outstandingBillsTotal)}
					</summary>
					<div
						className="grid gap-2 pt-2"
						aria-label="Outstanding bills in selected range"
					>
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
				</details>
			)}
			<details>
				<summary className="text-sm">Details</summary>
				<div className="grid gap-3 pt-2">
					{!historical && (
						<p className="m-0 text-xs text-muted-foreground">
							Bills due {monthDay(summary.start)} – {monthDay(summary.end)}.
							Future income and earlier bills are excluded.
						</p>
					)}
					{historical && summary.checkingAvailable === null && (
						<p className="m-0 text-xs text-muted-foreground">
							Available cash at close is not evidenced. An observed posted
							balance is not an available balance.
						</p>
					)}
					{explanations.map((explanation) => (
						<p key={explanation} className="m-0 text-xs text-muted-foreground">
							{explanation}
						</p>
					))}
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
													{dateLabel(instant, true)} · {instant.slice(11, 19)}{" "}
													UTC
												</time>
											</>
										)}
									</p>
									<p className="m-0">
										Posted {amountText(baseline.postedBalance)} · Available{" "}
										{amountText(baseline.availableBalance)}
									</p>
								</div>
							);
						})}
					</div>
					{!historical && (summary.confirmedMovements ?? []).length > 0 && (
						<div className="grid gap-2" aria-label="Confirmed cash movements">
							<h4 className="m-0 text-sm">
								Confirmed movements since each observation
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
				</div>
			</details>
		</section>
	);
}
