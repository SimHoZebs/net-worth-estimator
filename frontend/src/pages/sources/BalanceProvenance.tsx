import { AccountDot } from "../../components/AccountIcon.tsx";
import { Badge } from "../../components/ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import { type Plan, visibleAccounts } from "../../domain/model.ts";

export function BalanceProvenance({ plan }: { plan: Plan }) {
	return (
		<section className="panel provenance-panel">
			<div className="section-top">
				<div>
					<h2>Behind the balances</h2>
				</div>
			</div>
			<div className="table-scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Account</th>
							<th scope="col">Source</th>
							<th scope="col">As of</th>
							<th scope="col">Status</th>
							<th scope="col">Balance</th>
						</tr>
					</thead>
					<tbody>
						{visibleAccounts(plan.accounts).map((account) => (
							<tr key={account.id}>
								<th scope="row">
									<span className="account-name-line">
										<AccountDot color={account.color} />
										{account.name}
									</span>
								</th>
								<td>{account.source}</td>
								<td>{dateLabel(account.observedOn, true)}</td>
								<td>
									<Badge tone={account.balanceCheck ? "green" : "outline"}>
										{account.balanceCheck ? "Confirmed" : "Estimated"}
									</Badge>
								</td>
								<td className="numeric">{money(account.balance)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
