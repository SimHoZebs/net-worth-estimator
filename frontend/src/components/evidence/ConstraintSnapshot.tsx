import { money } from "../../domain/format.ts";
import type { FailureLedger } from "../../domain/constraintSnapshot.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";
import type { MovementResult } from "../../domain/result.ts";
import { AccountEntry } from "../AccountEntry.tsx";
import { TransactionRow } from "../activity/TransactionRow.tsx";
import { TransactionTable } from "../activity/TransactionTable.tsx";

// The failure month as the shared transaction table: real TransactionRow
// entries with the failing movement riding inline, its Shortfall badge
// carrying the gap amount. Only the badge text is dialog-specific.
export function ConstraintSnapshot({
	ledger,
	failure,
	showHeaders = false,
	onEdit,
}: {
	ledger: FailureLedger;
	failure: MovementResult;
	showHeaders?: boolean;
	onEdit: (target: EditorTarget) => void;
}) {
	const gap = failure.requested - failure.realized;
	return (
		<figure className="snapshot">
			{ledger.accountIcon ? (
				<ul className="account-entries">
					<AccountEntry
						account={ledger.accountIcon}
						name={ledger.accountName}
						caption={`In ${ledger.month}`}
					/>
				</ul>
			) : (
				<h3 className="snapshot-also">In {ledger.month}</h3>
			)}
			<TransactionTable caption={ledger.summary} showHeaders={showHeaders}>
				{ledger.rows.map(({ transaction, movement, failing }) => (
					<TransactionRow
						key={transaction.id}
						transaction={transaction}
						movement={movement}
						onEdit={(item) => onEdit({ kind: "movement", item })}
						shortfallLabel={failing ? `Shortfall ${money(gap)}` : undefined}
					/>
				))}
			</TransactionTable>
			{ledger.overflow > 0 && (
				<p className="snapshot-more">+{ledger.overflow} more</p>
			)}
		</figure>
	);
}
