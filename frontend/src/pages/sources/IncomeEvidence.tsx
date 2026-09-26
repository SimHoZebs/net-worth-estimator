import { Info } from "lucide-react";
import { Badge } from "../../components/ui.tsx";
import { payEvidence } from "../../domain/evidence.ts";
import { dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";

export function IncomeEvidence({
	plan,
	serverMode,
}: {
	plan: Plan;
	serverMode: boolean;
}) {
	const evidence = payEvidence(plan);
	return (
		<section className="panel pay-evidence">
			<div className="section-top">
				<div>
					<h2>What the income records suggest</h2>
					<p>Posting-derived evidence · independent of planned income</p>
				</div>
				<Badge tone="amber">
					{evidence.strong ? "Moderate evidence" : "Limited evidence"}
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
					<details className="evidence-records">
						<summary>
							Inspect {evidence.candidates.length} supporting and excluded
							records
						</summary>
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
									{evidence.candidates.map((movement) => (
										<tr key={movement.id}>
											<th scope="row">{movement.name}</th>
											<td>{dateLabel(movement.startDate, true)}</td>
											<td>
												{movement.amountKnown
													? money(movement.amount)
													: "Unavailable"}
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
			<div className="inline-notice">
				<Info size={18} />
				<span>
					These inflows may include non-payroll income. This inference does not
					establish gross salary or bank provenance and never changes{" "}
					{serverMode ? "the canonical server model" : "your plan"}. Fewer than
					six comparable records limit confidence.
				</span>
			</div>
		</section>
	);
}
