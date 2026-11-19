import { Progress } from "@/components/ui/progress.tsx";
import { amountText } from "./amountText.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

/**
 * Two cash constraints on one shared scale. The bar length is the server's
 * room figure, never a ratio invented by the client; the shorter bar is the
 * check that binds the allowance.
 */
export function SafeSpendingConstraintCompare({
	prePaydayRoom,
	postIncomeRoom,
}: {
	prePaydayRoom: number | null;
	postIncomeRoom: number | null;
}) {
	if (prePaydayRoom === null || postIncomeRoom === null) return null;
	const scale = Math.max(prePaydayRoom, postIncomeRoom, 0);
	const binding =
		prePaydayRoom <= postIncomeRoom
			? labels.beforePayday
			: labels.afterPaydayPay;
	return (
		<section
			className="grid content-start gap-2"
			aria-label={labels.constraintCompare}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<Progress
					value={Math.max(0, prePaydayRoom)}
					max={scale || 1}
					aria-label={labels.beforePayday}
					aria-valuetext={amountText(prePaydayRoom)}
				>
					<span className="text-xs text-muted-foreground">
						{labels.beforePayday}
					</span>
					<span className="ml-auto text-xs font-medium tabular-nums">
						{amountText(prePaydayRoom)}
					</span>
				</Progress>
				<Progress
					value={Math.max(0, postIncomeRoom)}
					max={scale || 1}
					aria-label={labels.afterPaydayPay}
					aria-valuetext={amountText(postIncomeRoom)}
				>
					<span className="text-xs text-muted-foreground">
						{labels.afterPaydayPay}
					</span>
					<span className="ml-auto text-xs font-medium tabular-nums">
						{amountText(postIncomeRoom)}
					</span>
				</Progress>
			</div>
			<p className="m-0 text-xs text-muted-foreground">
				{binding} is the tighter check.
			</p>
		</section>
	);
}
