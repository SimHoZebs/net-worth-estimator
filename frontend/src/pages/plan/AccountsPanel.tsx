import { LockKeyhole, Pencil, Trash2, Wallet } from "lucide-react";
import { AccountLabel } from "../../components/AccountIcon.tsx";
import {
	DataTable,
	TableCell,
	TableHeader,
	TableRow,
} from "../../components/DataTable.tsx";
import { IconButton } from "../../components/Button.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { money } from "../../domain/format.ts";
import type { Account } from "../../domain/model.ts";

export function AccountsPanel({
	accounts,
	showHeaders = false,
	onAccount,
	onEdit,
	onRemove,
}: {
	accounts: Account[];
	showHeaders?: boolean;
	onAccount: (id: string) => void;
	onEdit: (account: Account) => void;
	onRemove: (account: Account) => void;
}) {
	if (!accounts.length)
		return <EmptyState icon={Wallet} title="No matching accounts" />;
	return (
		<DataTable
			caption="Accounts with balances and protected balances."
			showHeaders={showHeaders}
			columns={[
				{ label: "Account", className: "max-sm:p-4" },
				{ label: "Balance", className: "max-sm:p-4" },
				{
					label: "Protected balance",
					className: "max-sm:p-4",
				},
				{
					label: "Actions",
					srOnly: true,
					className: "max-sm:p-4",
				},
			]}
		>
			{accounts.map((account) => (
				<TableRow key={account.id}>
					<TableHeader scope="row" className="max-sm:p-4">
						<button
							type="button"
							className="group flex items-center gap-3 rounded-control border-0 bg-transparent px-0 py-1 text-left text-inherit"
							aria-label={`Open ${account.name} transactions`}
							onClick={() => onAccount(account.id)}
						>
							<AccountLabel
								account={account}
								nameClassName="group-hover:text-primary group-hover:underline group-hover:underline-offset-4"
								suffix={!account.enabled ? " · excluded" : undefined}
							/>
							{account.readOnly && (
								<LockKeyhole size={14} aria-label="Read-only record" />
							)}
						</button>
					</TableHeader>
					<TableCell className="tabular-nums max-sm:p-4">
						{money(account.balance)}
					</TableCell>
					<TableCell className="max-sm:p-4">
						{money(account.minBalance)}
					</TableCell>
					<TableCell className="max-sm:p-4">
						<div className="flex justify-end gap-1">
							<IconButton
								icon={Pencil}
								size="sm"
								label={`Edit ${account.name}`}
								onClick={() => onEdit(account)}
							/>
							<IconButton
								icon={Trash2}
								size="sm"
								label={`Remove ${account.name}`}
								disabled={account.readOnly}
								onClick={() => onRemove(account)}
							/>
						</div>
					</TableCell>
				</TableRow>
			))}
		</DataTable>
	);
}
