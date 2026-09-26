import { ArrowDownToLine } from "lucide-react";
import { type ChartModel, projectionCsv } from "../../domain/chart.ts";
import { dateLabel, money } from "../../domain/format.ts";
import { download } from "../../state/storage.ts";

export function ProjectionTable({
	rows,
	realTerms,
	hasRange,
}: {
	rows: ChartModel["rows"];
	realTerms: boolean;
	hasRange: boolean;
}) {
	return (
		<div className="chart-data">
			<div className="section-top">
				<h3>
					Annual values · {realTerms ? "today’s dollars" : "future dollars"}
				</h3>
				<button
					type="button"
					className="text-button"
					onClick={() =>
						download({
							name: "waypoint-projection.csv",
							type: "text/csv",
							content: projectionCsv(rows),
						})
					}
				>
					<ArrowDownToLine size={15} />
					CSV
				</button>
			</div>
			<div className="table-scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Date</th>
							<th scope="col">Base case</th>
							{hasRange && (
								<>
									<th scope="col">10th percentile</th>
									<th scope="col">Median</th>
									<th scope="col">90th percentile</th>
								</>
							)}
						</tr>
					</thead>
					<tbody>
						{rows.map((point) => (
							<tr key={point.date}>
								<th scope="row">{dateLabel(point.date, true)}</th>
								<td>{money(point.total)}</td>
								{hasRange && (
									<>
										<td>{point.band ? money(point.band.lower) : "—"}</td>
										<td>{point.band ? money(point.band.median) : "—"}</td>
										<td>{point.band ? money(point.band.upper) : "—"}</td>
									</>
								)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
