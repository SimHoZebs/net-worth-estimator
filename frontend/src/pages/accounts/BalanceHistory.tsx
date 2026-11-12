import { useMemo } from "react";
import type { BalanceAdjustment } from "@/api/generated/model/balanceAdjustment.ts";
import { TransactionTable } from "../../components/activity/TransactionTable.tsx";
import { BalanceAdjustmentRow } from "../../components/activity/BalanceAdjustmentRow.tsx";

/**
 * Balance history for one account. Balance adjustments are checkpoint
 * reconciliation, not transactions: they never count as income or spending
 * and they are stored as checkpoints, not in the transaction table. They
 * render in their own list so the transaction list holds only transactions.
 */
export function BalanceHistory({
	adjustments,
	isPending,
	isError,
	onRetry,
}: {
	adjustments: BalanceAdjustment[];
	isPending: boolean;
	isError: boolean;
	onRetry: () => void;
}) {
	const sorted = useMemo(
		() =>
			[...adjustments].sort((a, b) => {
				if (a.observedAt !== b.observedAt) return b.observedAt - a.observedAt;
				if (a.balance !== b.balance) return b.balance - a.balance;
				return a.accountId.localeCompare(b.accountId);
			}),
		[adjustments],
	);
	if (isPending) return <p role="status">Loading balance adjustments…</p>;
	if (isError)
		return (
			<p role="alert">
				Balance adjustments could not be loaded.{" "}
				<button type="button" onClick={onRetry}>
					Retry adjustments
				</button>
			</p>
		);
	if (!sorted.length)
		return (
			<section aria-label="Balance history" className="grid min-w-0 gap-3">
				<h3 className="m-0 text-sm font-semibold">Balance history</h3>
				<p className="m-0 text-xs text-muted">No balance adjustments yet.</p>
			</section>
		);
	return (
		<section aria-label="Balance history" className="grid min-w-0 gap-3">
			<h3 className="m-0 text-sm font-semibold">Balance history</h3>
			<TransactionTable
				caption="Dated balance observations for this account."
				showHeaders={false}
			>
				{sorted.map((adjustment) => (
					<BalanceAdjustmentRow
						key={`${adjustment.accountId}:${adjustment.observedAt}`}
						adjustment={adjustment}
					/>
				))}
			</TransactionTable>
		</section>
	);
}
