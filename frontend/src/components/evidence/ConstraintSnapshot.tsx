import { money } from "../../domain/format.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import type { FailureLedger } from "../../domain/constraintSnapshot.ts";
import type { TransactionResult } from "../../domain/result.ts";
import { AccountEntry } from "../AccountEntry.tsx";
import { TransactionDetail } from "../activity/TransactionDetail.tsx";
import { transactionSelectionKey, useSelectedId } from "../entrySelection.ts";
import { TransactionRow } from "../activity/TransactionRow.tsx";
import { TransactionTable } from "../activity/TransactionTable.tsx";

// The failure month as the shared transaction table: real TransactionRow
// entries with the failing savedTransaction riding inline, its Shortfall badge
// carrying the gap amount. Only the badge text is dialog-specific.
export function ConstraintSnapshot({
	ledger,
	failure,
	accounts,
	transactions,
	readOnly,
	showHeaders = false,
}: {
	ledger: FailureLedger;
	failure: TransactionResult;
	accounts: Pick<Account, "id" | "kind" | "color" | "name">[];
	/** Saved rules, for the detail view's rule lookups and edit controls. */
	transactions: Transaction[];
	readOnly: boolean;
	showHeaders?: boolean;
}) {
	const gap = failure.requested - failure.realized;
	// Local identity only: the row is resolved from the current ledger each
	// render, so a refresh keeps the detail open while a removed row (or a
	// removed saved rule) renders as no selection and closes it.
	const [selectedId, setSelectedId] = useSelectedId();
	const selected =
		selectedId === null
			? null
			: (ledger.rows.find(
					(row) => transactionSelectionKey(row.transaction) === selectedId,
				) ?? null);
	const selectedSavedTransaction = selected?.savedTransaction ?? null;
	return (
		<figure className="mt-3 mb-0.5">
			{ledger.accountIcon ? (
				<ul className="mt-4 mb-2 grid list-none gap-1 p-0">
					<AccountEntry
						account={ledger.accountIcon}
						name={ledger.accountName}
						caption={`In ${ledger.month}`}
					/>
				</ul>
			) : (
				<h3 className="mb-3 text-xs font-semibold text-ink">
					In {ledger.month}
				</h3>
			)}
			<TransactionTable caption={ledger.summary} showHeaders={showHeaders}>
				{ledger.rows.map(({ transaction, savedTransaction, failing }) => (
					<TransactionRow
						key={transaction.id}
						transaction={transaction}
						savedTransaction={savedTransaction}
						onEdit={() => setSelectedId(transactionSelectionKey(transaction))}
						shortfallLabel={failing ? `Shortfall ${money(gap)}` : undefined}
					/>
				))}
			</TransactionTable>
			{ledger.overflow > 0 && (
				<p className="mt-2 text-xs text-muted">+{ledger.overflow} more</p>
			)}
			{selected && selectedSavedTransaction && (
				<TransactionDetail
					transaction={selected.transaction}
					savedTransaction={selectedSavedTransaction}
					accounts={accounts}
					transactions={transactions}
					readOnly={readOnly}
					shortfallLabel={
						selected.failing ? `Shortfall ${money(gap)}` : undefined
					}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</figure>
	);
}
