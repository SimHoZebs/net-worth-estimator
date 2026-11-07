import { Scale } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { BalanceAdjustment } from "@/api/generated/model/balanceAdjustment.ts";
import { dateLabel, exactMoney } from "../../domain/format.ts";
import { TransactionItemRow } from "./TransactionItem.tsx";
import { Modal } from "../Modal.tsx";
import { DetailList, DetailRow } from "../DetailRow.tsx";

export function BalanceAdjustmentRow({
	adjustment,
}: {
	adjustment: BalanceAdjustment;
}) {
	const [open, setOpen] = useState(false);
	const date = new Date(adjustment.observedAt * 1000).toISOString();
	return (
		<>
			<TransactionItemRow
				date={<time dateTime={date}>{dateLabel(date, true)}</time>}
				icon={<Scale size={16} aria-hidden="true" />}
				tone="transfer"
				title="Balance adjustment"
				amount={
					<strong className="text-sm tabular-nums">
						{adjustment.adjustment > 0
							? "+"
							: adjustment.adjustment < 0
								? "−"
								: ""}
						{exactMoney(Math.abs(adjustment.adjustment))}
					</strong>
				}
				actionLabel={`View balance adjustment on ${dateLabel(date, true)}`}
				onSelect={() => setOpen(true)}
				slots={{
					subtitle: "Not income or spending",
					mobile: dateLabel(date, true),
				}}
			/>
			{open &&
				createPortal(
					<Modal title="Balance adjustment" onClose={() => setOpen(false)}>
						<DetailList>
							<DetailRow label="Recorded at (UTC)">
								<time dateTime={date}>
									{date.replace("T", " ").replace(".000Z", " UTC")}
								</time>
							</DetailRow>
							<DetailRow label="Previous balance">
								{exactMoney(adjustment.previousBalance)}
							</DetailRow>
							<DetailRow label="New balance">
								{exactMoney(adjustment.balance)}
							</DetailRow>
							<DetailRow label="Adjustment">
								{exactMoney(adjustment.adjustment)}
							</DetailRow>
							<DetailRow label="Source">
								{adjustment.source === "user" || adjustment.source === ""
									? "Manual adjustment"
									: "Bank balance"}
							</DetailRow>
						</DetailList>
						<p className="text-sm text-muted">
							This entry reconciles the account balance. It does not count as
							income or spending.
						</p>
					</Modal>,
					document.body,
				)}
		</>
	);
}
