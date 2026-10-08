import { ArrowUpRight } from "lucide-react";
import { money, sum } from "../domain/format.ts";
import { type Account, type Plan, visibleAccounts } from "../domain/model.ts";
import type { Projection } from "../domain/result.ts";
import { AccountIcon } from "./AccountIcon.tsx";
import { Badge } from "./ui.tsx";
import "./AccountList.css";

export function AccountList({
	plan,
	projection,
	onAccount,
	onAll,
}: {
	plan: Plan;
	projection?: Projection;
	onAccount: (account: Account) => void;
	onAll: () => void;
}) {
	const startingBalances = projection?.points.find(
		(point) => point.date === plan.startDate,
	)?.balances;
	const accounts = visibleAccounts(plan.accounts);
	const balanceFor = (account: Account) => {
		const startingBalance = startingBalances?.[account.id];
		return account.enabled && startingBalance !== undefined
			? startingBalance
			: account.balance;
	};
	const assets = sum(
		accounts
			.filter((a) => a.enabled && balanceFor(a) > 0)
			.map((a) => balanceFor(a)),
	);
	const debt = sum(
		accounts
			.filter((a) => a.enabled && balanceFor(a) < 0)
			.map((a) => balanceFor(a)),
	);
	return (
		<section className="account-section">
			<div className="section-top">
				<button type="button" className="text-button" onClick={onAll}>
					All accounts <ArrowUpRight size={16} />
				</button>
			</div>
			<div className="account-summary">
				<span>
					Assets <b>{money(assets)}</b>
				</span>
				<span>
					Debts <b>{money(debt)}</b>
				</span>
			</div>
			<div className="accounts-grid">
				{accounts.map((account) => {
					const startingBalance = startingBalances?.[account.id];
					const balance = balanceFor(account);
					const projected =
						account.enabled &&
						startingBalance !== undefined &&
						Math.abs(startingBalance - account.balance) >= 0.01;
					return (
						<button
							type="button"
							className="account-row"
							key={account.id}
							onClick={() => onAccount(account)}
						>
							<AccountIcon account={account} />
							<span className="account-label">
								<strong>{account.name}</strong>
								<span>
									{projected ? "Estimated balance" : "Confirmed balance"}
								</span>
							</span>
							<span className="account-balance">
								{money(balance)}
								{!account.enabled && <Badge tone="amber">Excluded</Badge>}
							</span>
						</button>
					);
				})}
			</div>
		</section>
	);
}
