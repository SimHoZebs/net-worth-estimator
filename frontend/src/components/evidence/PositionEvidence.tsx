import { Info } from "lucide-react";
import { dateLabel, money } from "../../domain/format.ts";
import { type Plan, visibleAccounts } from "../../domain/model.ts";
import { currentNetWorth, type Projection } from "../../domain/result.ts";
import { AccountDot } from "../AccountIcon.tsx";
import { DetailList, DetailRow } from "../DetailRow.tsx";
import { Notice } from "../Notice.tsx";
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
			<div className="type-value mb-2 text-4xl leading-[1.2] font-medium tracking-tight">
				{money(currentNetWorth(projection))}
			</div>
			<p className="text-muted">
				Assets minus debts · starting {dateLabel(plan.startDate, true)}
			</p>
			<DetailList>
				{visibleAccounts(plan.accounts)
					.filter((account) => account.enabled)
					.map((account) => (
						<DetailRow
							key={account.id}
							label={
								<>
									<span className="inline-flex items-center gap-2">
										<AccountDot color={account.color} />
										{account.name}
									</span>
									<small className="mt-1 block text-xs">
										{dateLabel(account.observedOn, true)}
									</small>
								</>
							}
						>
							{money(account.balance)}
						</DetailRow>
					))}
			</DetailList>
			<Notice tone="info" className="my-4">
				<Info size={18} aria-hidden="true" />
				<span>
					{plan.origin === "example"
						? "All balances are illustrative example data. "
						: ""}
					Older values carry forward unchanged.
				</span>
			</Notice>
		</Modal>
	);
}
