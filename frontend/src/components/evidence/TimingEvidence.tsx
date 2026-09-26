import { Info } from "lucide-react";
import { dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import type { Projection } from "../../domain/projection.ts";
import { upcomingMovements } from "../../domain/timing.ts";
import { Badge, Modal } from "../ui.tsx";

export function TimingEvidence({
	plan,
	projection,
	onClose,
}: {
	plan: Plan;
	projection: Projection;
	onClose: () => void;
}) {
	const { end, events } = upcomingMovements({
		startDate: plan.startDate,
		projection,
	});
	return (
		<Modal
			title="The next 30 days"
			eyebrow={`${dateLabel(plan.startDate, true)} to ${dateLabel(end, true)}`}
			onClose={onClose}
			wide
		>
			<p className="form-intro">
				Planned cash timing from the same starting balances. These amounts are
				scheduled, not bank-confirmed.
			</p>
			<div className="table-scroll">
				<table>
					<thead>
						<tr>
							<th scope="col">Date</th>
							<th scope="col">Movement</th>
							<th scope="col">Requested</th>
							<th scope="col">Funded</th>
						</tr>
					</thead>
					<tbody>
						{events.map((event, index) => (
							<tr key={`${event.movementId}-${index}`}>
								<td>{dateLabel(event.date, true)}</td>
								<th scope="row">{event.name}</th>
								<td>{money(event.requested)}</td>
								<td>
									{money(event.realized)}
									{event.constraint && <Badge tone="amber">Shortfall</Badge>}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{!events.length && <p>No movements scheduled in this period.</p>}
			<div className="inline-notice">
				<Info size={18} />
				<span>
					Cash above protected balances is not a safe-to-spend recommendation.
					Account timing, future commitments and unmodeled expenses can still
					limit spending.
				</span>
			</div>
		</Modal>
	);
}
