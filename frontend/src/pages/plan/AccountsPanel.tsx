import { FileCheck2, LockKeyhole, Pencil, Trash2, Wallet } from "lucide-react";
import { AccountIcon } from "../../components/AccountIcon.tsx";
import { EmptyState, IconButton } from "../../components/ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import type { Account } from "../../domain/model.ts";

export function AccountsPanel({
	accounts,
	onAccount,
	onEdit,
	onRemove,
}: {
	accounts: Account[];
	onAccount: (id: string) => void;
	onEdit: (account: Account) => void;
	onRemove: (account: Account) => void;
}) {
	if (!accounts.length)
		return (
			<EmptyState
				icon={Wallet}
				title="No matching accounts"
				description="Try another name or add an account to the plan."
			/>
		);
	return (
		<div className="table-scroll">
			<table className="plan-table">
				<thead>
					<tr>
						<th scope="col">Account</th>
						<th scope="col">Balance</th>
						<th scope="col">Annual rate</th>
						<th scope="col">Protected balance</th>
						<th scope="col">
							<span className="sr-only">Actions</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{accounts.map((account) => (
						<tr key={account.id}>
							<th scope="row">
								<button
									type="button"
									className="table-name account-name-button"
									aria-label={`Open ${account.name} transactions`}
									onClick={() => onAccount(account.id)}
								>
									<AccountIcon account={account} />
									<span>
										<strong>{account.name}</strong>
										<small>
											{account.kind} · {account.provenance}
											{!account.enabled && " · excluded"}
										</small>
									</span>
									{account.readOnly && (
										<LockKeyhole size={14} aria-label="Read-only record" />
									)}
								</button>
							</th>
							<td className="numeric">{money(account.balance)}</td>
							<td>{account.annualReturn}%</td>
							<td>{money(account.floor)}</td>
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
				</tbody>
			</table>
		</div>
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
		<>
			<p className="section-note">
				Recorded end-of-day balances establish the starting position. Older
				balances are carried forward unchanged and remain visibly dated.
			</p>
			<div className="movement-list">
				{accounts
					.filter((account) => account.provenance === "recorded")
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
								label={`Edit balance check for ${account.name}`}
								onClick={() => onEdit(account)}
							/>
						</div>
					))}
			</div>
		</>
	);
}
