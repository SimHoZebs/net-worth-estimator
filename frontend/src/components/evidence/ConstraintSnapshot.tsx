import { money } from "../../domain/format.ts";
import type { FailureLedger } from "../../domain/constraintSnapshot.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";
import type { MovementResult } from "../../domain/result.ts";
import { AccountEntry } from "../AccountEntry.tsx";
import { TransactionRow } from "../activity/TransactionRow.tsx";

// The failure month as the shared transaction table: real TransactionRow
// entries with the failing movement riding inline, its Shortfall badge
// carrying the gap amount. Only the badge text is dialog-specific.
export function ConstraintSnapshot({
	ledger,
	failure,
	onEdit,
}: {
	ledger: FailureLedger;
	failure: MovementResult;
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
			<div className="table-scroll">
				<table className="account-activity-table">
					<caption className="sr-only">{ledger.summary}</caption>
					<thead>
						<tr>
							<th scope="col" className="transaction-date-column">
								Date
							</th>
							<th scope="col">Transaction</th>
							<th scope="col" className="transaction-amount-column">
								Amount
							</th>
						</tr>
					</thead>
					<tbody>
						{ledger.rows.map(({ transaction, movement, failing }) => (
							<TransactionRow
								key={transaction.id}
								transaction={transaction}
								movement={movement}
								onEdit={(item) => onEdit({ kind: "movement", item })}
								shortfallLabel={failing ? `Shortfall ${money(gap)}` : undefined}
								hideExternalCounterparty
							/>
						))}
					</tbody>
				</table>
			</div>
			{ledger.overflow > 0 && (
				<p className="snapshot-more">+{ledger.overflow} more</p>
			)}
		</figure>
	);
}
