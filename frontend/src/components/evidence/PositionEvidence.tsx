import { Info } from "lucide-react";
import { dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import { currentNetWorth, type Projection } from "../../domain/result.ts";
import { DetailRow } from "../DetailRow.tsx";
import { Modal } from "../ui.tsx";

export function PositionEvidence({
	plan,
	projection,
	onClose,
}: {
	plan: Plan;
	projection: Projection;
	onClose: () => void;
}) {
	return (
		<Modal
			title="The basis of your net worth"
			eyebrow="Current position"
			onClose={onClose}
		>
			<div className="evidence-amount">
				{money(currentNetWorth(projection))}
			</div>
			<p className="muted">
				Assets minus debts · starting {dateLabel(plan.startDate, true)}
			</p>
			<dl className="detail-list">
				{plan.accounts
					.filter((account) => account.enabled)
					.map((account) => (
						<DetailRow
							key={account.id}
							label={
								<>
									{account.name}
									<small>
										{account.provenance} · {dateLabel(account.observedOn, true)}
									</small>
								</>
							}
						>
							{money(account.balance)}
						</DetailRow>
					))}
			</dl>
			<div className="inline-notice">
				<Info size={18} />
				<span>
					{plan.origin === "example"
						? "All balances are illustrative example data. "
						: ""}
					Starting values mix balance checks and estimates. Older checks are
					carried forward without reconstructing missing history.
				</span>
			</div>
		</Modal>
	);
}
