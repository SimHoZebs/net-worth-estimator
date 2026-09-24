import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/Table";
import type { Account } from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";
import { nextReadableId, useChangedIds, useRowById } from "../_Shared";
import type { AccountsTableEditProps } from "../AccountsTable";
import {
	CheckboxCell,
	CommitCell,
	DecimalCell,
	editableCellClass,
} from "./Cells";
import { AddRowButton, EditableTableCard, RowDeleteButton } from "./Shells";

interface AccountEditRowProps {
	account: Account;
	changed: boolean;
	updateAccount: (id: string, changes: Partial<Account>) => void;
	deleteAccount: (id: string) => void;
}

export function AccountEditRow({
	account: a,
	changed,
	updateAccount,
	deleteAccount,
}: AccountEditRowProps) {
	return (
		<TableRow>
			<TableCell>
				<CommitCell
					aria-label={`Account ID for ${a.label}`}
					committedValue={a.id}
					isDirty={changed}
					onCommitDraft={(id) => {
						updateAccount(a.id, { id });
						return id;
					}}
				/>
			</TableCell>
			<TableCell>
				<input
					aria-label={`Account label for ${a.id}`}
					className={editableCellClass(changed)}
					value={a.label}
					onChange={(e) => updateAccount(a.id, { label: e.target.value })}
				/>
			</TableCell>
			<TableCell>
				<DecimalCell
					label={`Minimum balance for ${a.id}`}
					value={a.minBalance}
					emptyValue={NO_FLOOR}
					isDirty={changed}
					onCommit={(minBalance) =>
						updateAccount(a.id, { minBalance: minBalance ?? NO_FLOOR })
					}
				/>
			</TableCell>
			<TableCell>
				<DecimalCell
					label={`Maximum balance for ${a.id}`}
					value={a.maxBalance}
					emptyValue={NO_CEILING}
					isDirty={changed}
					onCommit={(maxBalance) =>
						updateAccount(a.id, { maxBalance: maxBalance ?? NO_CEILING })
					}
				/>
			</TableCell>
			<TableCell>
				<input
					type="color"
					aria-label={`Chart color for ${a.label}`}
					className="h-8 w-12 cursor-pointer rounded border border-input bg-card p-1"
					value={a.color?.startsWith("#") ? a.color : "#64748b"}
					onChange={(e) => updateAccount(a.id, { color: e.target.value })}
				/>
			</TableCell>
			<TableCell>
				<CheckboxCell
					label={`Enable account ${a.label}`}
					checked={a.enabled}
					onChange={() => updateAccount(a.id, { enabled: !a.enabled })}
				/>
			</TableCell>
			<TableCell>
				<RowDeleteButton
					label={`Delete account ${a.label}`}
					onClick={() => deleteAccount(a.id)}
				/>
			</TableCell>
		</TableRow>
	);
}

export function EditableAccountsGrid({
	displayDocument,
	document,
	isDirty,
	workingDocument,
	updateAccount,
	deleteAccount,
	addAccount,
}: AccountsTableEditProps) {
	const documentAccountsById = useRowById(document.accounts);
	const workingAccountsById = useRowById(workingDocument?.accounts);
	const changedAccountIds = useChangedIds(
		documentAccountsById,
		workingDocument?.accounts,
		isDirty,
	);

	return (
		<EditableTableCard
			title="Accounts"
			description="Edit, add, or remove account rows. New rows get a readable ID (new-account, new-account-2, …) — rename it in the ID cell."
			footer={
				<AddRowButton
					onClick={() =>
						addAccount({
							id: nextReadableId(
								"new-account",
								displayDocument.accounts.map((a) => a.id),
							),
							label: "New account",
							minBalance: NO_FLOOR,
							maxBalance: NO_CEILING,
							color: null,
							enabled: true,
						})
					}
				>
					+ Add account
				</AddRowButton>
			}
		>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>ID</TableHead>
						<TableHead>Label</TableHead>
						<TableHead>Min</TableHead>
						<TableHead>Max</TableHead>
						<TableHead>Chart color</TableHead>
						<TableHead>Enabled</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{displayDocument.accounts.map((a) => {
						const wa = workingAccountsById.get(a.id);
						const pa = documentAccountsById.get(a.id);
						const changed =
							wa !== undefined &&
							pa !== undefined &&
							changedAccountIds.has(a.id);

						return (
							<AccountEditRow
								key={a.id}
								account={a}
								changed={changed}
								updateAccount={updateAccount}
								deleteAccount={deleteAccount}
							/>
						);
					})}
				</TableBody>
			</Table>
		</EditableTableCard>
	);
}
