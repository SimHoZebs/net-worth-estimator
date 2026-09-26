import { Badge } from "../../components/ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";

export function BalanceProvenance({ plan }: { plan: Plan }) {
	return (
		<section className="panel provenance-panel">
			<div className="section-top">
				<div>
					<h2>Behind the balances</h2>
					<p>"Display view of the canonical server records."</p>
				</div>
			</div>
			<div className="table-scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Account</th>
							<th scope="col">Source</th>
							<th scope="col">As of</th>
							<th scope="col">Basis</th>
							<th scope="col">Balance</th>
						</tr>
					</thead>
					<tbody>
						{plan.accounts.map((account) => (
							<tr key={account.id}>
								<th scope="row">{account.name}</th>
								<td>{account.source}</td>
								<td>{dateLabel(account.observedOn, true)}</td>
								<td>
									<Badge
										tone={
											account.provenance === "recorded" ? "green" : "outline"
										}
									>
										{account.provenance}
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
