import { FileCheck2, LockKeyhole, Pencil, Trash2, Wallet } from "lucide-react";
import { AccountLabel } from "../../components/AccountIcon.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { EmptyState, IconButton } from "../../components/ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import type { Account } from "../../domain/model.ts";
import "./plan.css";

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
			className="plan-table"
			caption="Accounts with balances and protected balances."
			showHeaders={showHeaders}
			columns={[
				{ label: "Account" },
				{ label: "Balance" },
				{ label: "Protected balance" },
				{ label: "Actions", srOnly: true },
			]}
		>
			{accounts.map((account) => (
				<tr key={account.id}>
					<th scope="row">
						<button
							type="button"
							className="table-name account-name-button"
							aria-label={`Open ${account.name} transactions`}
							onClick={() => onAccount(account.id)}
						>
							<AccountLabel
								account={account}
								suffix={!account.enabled ? " · excluded" : undefined}
							/>
							{account.readOnly && (
								<LockKeyhole size={14} aria-label="Read-only record" />
							)}
						</button>
					</th>
					<td className="numeric">{money(account.balance)}</td>
					<td>{money(account.minBalance)}</td>
					<td>
						<div className="table-actions">
							<IconButton
								icon={Pencil}
								label={`Edit ${account.name}`}
								onClick={() => onEdit(account)}
							/>
							<IconButton
								icon={Trash2}
								label={`Remove ${account.name}`}
								disabled={account.readOnly}
								onClick={() => onRemove(account)}
							/>
						</div>
					</td>
				</tr>
			))}
		</DataTable>
	);
}

export function BalanceChecksPanel({
	accounts,
	onEdit,
}: {
	accounts: Account[];
	onEdit: (account: Account) => void;
}) {
	return (
		<div className="movement-list">
			{accounts
				.filter((account) => account.balanceCheck)
				.map((account) => (
					<div className="movement-row" key={account.id}>
						<span className="movement-icon inflow">
							<FileCheck2 size={19} />
						</span>
						<div className="movement-name">
							<strong>{account.name}</strong>
							<span>
								{dateLabel(account.observedOn, true)} · {account.source}
							</span>
						</div>
						<strong>{money(account.balance)}</strong>
						<IconButton
							icon={Pencil}
							label={`Edit starting balance for ${account.name}`}
							onClick={() => onEdit(account)}
						/>
					</div>
				))}
		</div>
	);
}
