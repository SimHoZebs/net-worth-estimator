import {
	ArrowUpRight,
	Building2,
	Home,
	Landmark,
	type LucideIcon,
	PiggyBank,
	Wallet,
} from "lucide-react";
import { money, sum } from "../domain/format.ts";
import type { Account, Plan } from "../domain/model.ts";
import type { Projection } from "../domain/projection.ts";
import { Badge } from "./ui.tsx";

const icons: Record<Account["kind"], LucideIcon> = {
	cash: Wallet,
	investment: Landmark,
	property: Home,
	debt: Building2,
};
export function AccountIcon({ account }: { account: Account }) {
	const Icon = account.id === "savings" ? PiggyBank : icons[account.kind];
	return (
		<span className={`account-icon account-${account.kind}`}>
			<Icon size={19} strokeWidth={1.7} aria-hidden="true" />
		</span>
	);
}

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
	const balanceFor = (account: Account) => {
		const startingBalance = startingBalances?.[account.id];
		return account.enabled && startingBalance !== undefined
			? startingBalance
			: account.balance;
	};
	const assets = sum(
		plan.accounts
			.filter((a) => a.enabled && balanceFor(a) > 0)
			.map((a) => balanceFor(a)),
	);
	const debt = sum(
		plan.accounts
			.filter((a) => a.enabled && balanceFor(a) < 0)
			.map((a) => balanceFor(a)),
	);
	return (
		<section className="account-section">
			<div className="section-top">
				<div>
					<h2>Where you stand</h2>
					<p>{plan.accounts.length} accounts, one picture</p>
				</div>
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
				{plan.accounts.map((account) => {
					const startingBalance = startingBalances?.[account.id];
					const balance =
						account.enabled && startingBalance !== undefined
							? startingBalance
							: account.balance;
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
									{projected
										? "Projected from last check"
										: account.provenance === "recorded"
											? "Balance check"
											: "Estimated value"}
								</span>
							</span>
							<span className="account-balance">
								{money(balance)}
								<Badge
									tone={
										!account.enabled
											? "amber"
											: projected
												? "outline"
												: account.provenance === "recorded"
													? "neutral"
													: "outline"
									}
								>
									{!account.enabled
										? "Excluded"
										: projected
											? "Projected start"
											: account.provenance === "recorded"
												? "Recorded"
												: "Modeled"}
								</Badge>
							</span>
						</button>
					);
				})}
			</div>
		</section>
	);
}
