import { money } from "../../domain/format.ts";
import type { Account, Plan } from "../../domain/model.ts";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import type { FailureLedger } from "../../domain/constraintSnapshot.ts";
import type { Movement } from "../../domain/model.ts";
import type { MovementResult } from "../../domain/result.ts";
import { AccountEntry } from "../AccountEntry.tsx";
import { TransactionDetail } from "../activity/TransactionDetail.tsx";
import { useSelectedEntry } from "../entrySelection.ts";
import { TransactionRow } from "../activity/TransactionRow.tsx";
import { TransactionTable } from "../activity/TransactionTable.tsx";

// The failure month as the shared transaction table: real TransactionRow
// entries with the failing movement riding inline, its Shortfall badge
// carrying the gap amount. Only the badge text is dialog-specific.
export function ConstraintSnapshot({
	ledger,
	failure,
	accounts,
	plan,
	showHeaders = false,
}: {
	ledger: FailureLedger;
	failure: MovementResult;
	accounts: Pick<Account, "id" | "kind" | "color" | "name">[];
	plan: Plan;
	showHeaders?: boolean;
}) {
	const gap = failure.requested - failure.realized;
	const [selected, setSelected] = useSelectedEntry<{
		transaction: AccountTransaction;
		movement: Movement;
		failing: boolean;
	}>(plan);
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
				{ledger.rows.map(({ transaction, movement, failing }) => (
					<TransactionRow
						key={transaction.id}
						transaction={transaction}
						movement={movement}
						onEdit={(item) =>
							setSelected({ transaction, movement: item, failing })
						}
						shortfallLabel={failing ? `Shortfall ${money(gap)}` : undefined}
					/>
				))}
			</TransactionTable>
			{ledger.overflow > 0 && (
				<p className="mt-2 text-xs text-muted">+{ledger.overflow} more</p>
			)}
			{selected && (
				<TransactionDetail
					transaction={selected.transaction}
					movement={selected.movement}
					accounts={accounts}
					plan={plan}
					shortfallLabel={
						selected.failing ? `Shortfall ${money(gap)}` : undefined
					}
					onClose={() => setSelected(null)}
				/>
			)}
		</figure>
	);
}
