import { Info } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui.tsx";
import { analyzePay } from "../../domain/analysis/index.ts";
import { dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "../../domain/transactionSort.ts";
import { TransactionSortButton } from "../../components/activity/TransactionSortButton.tsx";

export function IncomeEvidence({ plan }: { plan: Plan }) {
	const result = analyzePay(plan);
	const [order, setOrder] = useState<TransactionOrder>(
		DEFAULT_TRANSACTION_ORDER,
	);
	if (result.state === "error") {
		return (
			<section className="panel pay-evidence">
				<div className="section-top">
					<div>
						<h2>What the income records suggest</h2>
						<p>Deposit-derived evidence · independent of planned income</p>
					</div>
					<Badge tone="amber">No records</Badge>
				</div>
				<p className="section-note">
					{result.diagnostics[0]?.message ??
						"No recorded one-time external inflows are available."}{" "}
					Add records in Plan to inspect income evidence.
				</p>
			</section>
		);
	}
	const evidence = result.value;
	const warnings = result.diagnostics.filter(
		(diagnostic) => diagnostic.severity === "warning",
	);
	const orderedCandidates = sortTransactionsByDate({
		items: evidence.candidates,
		getDate: (movement) => movement.startDate,
		getId: (movement) => movement.id,
		order,
	});
	return (
		<section className="panel pay-evidence">
			<div className="section-top">
				<div>
					<h2>What the income records suggest</h2>
					<p>Deposit-derived evidence · independent of planned income</p>
				</div>
				<Badge tone={evidence.strength === "strong" ? "green" : "amber"}>
					{evidence.strength === "strong"
						? "Strong evidence"
						: evidence.strength === "moderate"
							? "Moderate evidence"
							: "Limited evidence"}
				</Badge>
			</div>
			{evidence.comparable.length ? (
				<>
					<div className="assumption-metrics">
						<div>
							<span>Typical external inflow</span>
							<strong>{money(evidence.typical)}</strong>
							<p>Potential net pay; payer unverified</p>
						</div>
						<div>
							<span>Observed cadence</span>
							<strong>{evidence.monthly ? "Monthly" : "Unclear"}</strong>
							<p>
								{evidence.comparable.length} comparable records of{" "}
								{evidence.candidates.length}
							</p>
						</div>
						<div>
							<span>Annualized estimate</span>
							<strong>
								{evidence.annualized === null
									? "Insufficient data"
									: money(evidence.annualized)}
							</strong>
							<p>
								{evidence.annualized === null
									? "Cadence is not established"
									: "Assumes this monthly cadence continues"}
							</p>
						</div>
					</div>
					<ul className="evidence-items">
						{evidence.evidence.map((item) => (
							<li key={item.code}>{item.message}</li>
						))}
					</ul>
					<details className="evidence-records">
						<summary>
							Inspect {evidence.candidates.length} supporting and excluded
							records
						</summary>
						<div
							style={{
								display: "flex",
								justifyContent: "flex-end",
								margin: "8px 0",
							}}
						>
							<TransactionSortButton order={order} onChange={setOrder} />
						</div>
						<div className="table-scroll">
							<table>
								<thead>
									<tr>
										<th scope="col">Record</th>
										<th scope="col">Date</th>
										<th scope="col">Amount</th>
										<th scope="col">Use</th>
									</tr>
								</thead>
								<tbody>
									{orderedCandidates.map((movement) => (
										<tr key={movement.id}>
											<th scope="row">{movement.name}</th>
											<td>{dateLabel(movement.startDate, true)}</td>
											<td>
												{movement.amountKnown
													? money(movement.amount)
													: "Varies"}
											</td>
											<td>
												{evidence.excluded.includes(movement)
													? movement.enabled
														? "Excluded: differs by 20% or more"
														: "Excluded: disabled"
													: "Comparable"}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</details>
				</>
			) : (
				<p className="section-note">
					No recorded one-time external inflows are available. Add records in
					Plan to inspect income evidence.
				</p>
			)}
			{warnings.length > 0 && (
				<ul className="evidence-warnings">
					{warnings.map((warning) => (
						<li key={warning.code}>{warning.message}</li>
					))}
				</ul>
			)}
			<div className="inline-notice">
				<Info size={18} />
				<span>
					These inflows may include non-payroll income. This inference does not
					establish gross salary or a bank source. Fewer than six comparable
					records limit confidence.
				</span>
			</div>
		</section>
	);
}
