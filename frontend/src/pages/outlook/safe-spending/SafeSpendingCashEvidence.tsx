import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { amountText } from "./amountText.ts";
import type { AllowanceEvidence } from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

export function SafeSpendingCashEvidence({
	evidence,
	pending,
	error,
	onRetry,
}: {
	evidence?: AllowanceEvidence;
	pending: boolean;
	error: boolean;
	onRetry: () => void;
}) {
	if (!evidence)
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
	const shortfall =
		evidence.checkingAvailable !== null && evidence.checkingAvailable < 0;
	return (
		<section className="grid content-start gap-3" aria-label="Cash evidence">
			<div className="flex items-center justify-between gap-3">
				<h3 className="m-0 text-sm text-muted-foreground">
					{labels.cashOnHand}
				</h3>
				<strong
					className={cn(
						"text-base tabular-nums",
						shortfall && "text-danger-text",
					)}
					data-testid="cash-on-hand"
				>
					{amountText(evidence.checkingAvailable)}
				</strong>
			</div>
			<p className="m-0 text-xs text-muted-foreground">
				{labels.cashAsOf} {evidence.cashAsOf}
			</p>
			{evidence.baselines.length > 0 && (
				<details className="text-sm">
					<summary className="cursor-pointer text-muted-foreground">
						Balance evidence
					</summary>
					<dl className="m-0 grid gap-2 pt-2">
						{evidence.baselines.map((baseline) => (
							<div
								key={baseline.accountId}
								className="flex justify-between gap-3"
							>
								<dt>
									{baseline.accountName} ·{" "}
									{baseline.basis === "available"
										? "observed available"
										: baseline.basis === "posted"
											? "posted balance"
											: "no balance recorded"}
								</dt>
								<dd className="m-0 tabular-nums">
									{amountText(baseline.amount)}
								</dd>
							</div>
						))}
					</dl>
				</details>
			)}
		</section>
	);
}
