import { Badge } from "../../components/ui.tsx";
import type { IncomeDataSnapshot } from "../../api/index.ts";
import { dateLabel, money } from "../../domain/format.ts";

export function IncomeEvidence({
	incomeData,
}: {
	incomeData: IncomeDataSnapshot | null;
}) {
	const sources = incomeData?.incomeSources ?? [];
	if (!sources.length) {
		return (
			<section className="panel pay-evidence">
				<div className="section-top">
					<div>
						<h2>What the income records suggest</h2>
						<p>Server income data · independent of planned income</p>
					</div>
					<Badge tone="amber">No records</Badge>
				</div>
				<p className="section-note">
					No server income sources are available. Add income data to inspect
					income evidence.
				</p>
			</section>
		);
	}
	return (
		<section className="panel pay-evidence">
			<div className="section-top">
				<div>
					<h2>What the income records suggest</h2>
					<p>Server income data · independent of planned income</p>
				</div>
				<Badge tone="green">
					{sources.length === 1 ? "1 source" : `${sources.length} sources`}
				</Badge>
			</div>
			<div className="table-scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Source</th>
							<th scope="col">Effective</th>
							<th scope="col">Annual gross</th>
						</tr>
					</thead>
					<tbody>
						{sources.map((source) => (
							<tr key={source.id}>
								<th scope="row">{source.name}</th>
								<td>
									{dateLabel(source.effectiveFrom, true)}
									{source.effectiveTo
										? ` – ${dateLabel(source.effectiveTo, true)}`
										: " – present"}
								</td>
								<td>{money(source.annualGrossIncome)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
