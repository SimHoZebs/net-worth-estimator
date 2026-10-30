import { Info } from "lucide-react";
import { useMemo, useState } from "react";
import { dateLabel, money } from "../../domain/format.ts";
import type { Projection } from "../../domain/result.ts";
import { upcomingTransactions } from "../../domain/upcoming.ts";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "../../domain/transactionSort.ts";
import { TransactionSortButton } from "../activity/TransactionSortButton.tsx";
import { DataTable, TableCell, TableHeader, TableRow } from "../DataTable.tsx";
import { Notice } from "../Notice.tsx";
import { Badge } from "../Badge.tsx";
import { Modal } from "../Modal.tsx";

export function SafeSpendingEvidence({
	startDate,
	projection,
	onClose,
}: {
	startDate: string;
	projection: Projection;
	onClose: () => void;
}) {
	const { end, events } = upcomingTransactions({
		startDate,
		projection,
	});
	const [order, setOrder] = useState<TransactionOrder>(
		DEFAULT_TRANSACTION_ORDER,
	);
	const ordered = useMemo(
		() =>
			sortTransactionsByDate({
				items: events,
				getDate: (event) => event.date,
				getId: (event) => event.transactionId,
				order,
			}),
		[events, order],
	);
	return (
		<Modal
			title="The next 30 days"
			eyebrow={`${dateLabel(startDate, true)} to ${dateLabel(end, true)}`}
			onClose={onClose}
			wide
		>
			<p className="mb-6 text-sm text-muted">These amounts are scheduled.</p>
			<div className="my-2 flex justify-end">
				<TransactionSortButton order={order} onChange={setOrder} />
			</div>
			<DataTable
				caption="Scheduled transactions for the next 30 days."
				columns={[
					{ label: "Date" },
					{ label: "Transaction" },
					{ label: "Requested" },
					{ label: "Funded" },
				]}
				showHeaders
			>
				{ordered.map((event, index) => (
					<TableRow key={`${event.transactionId}-${index}`}>
						<TableCell>{dateLabel(event.date, true)}</TableCell>
						<TableHeader scope="row">{event.name}</TableHeader>
						<TableCell>{money(event.requested)}</TableCell>
						<TableCell>
							{money(event.realized)}
							{event.constraint && <Badge tone="warning">Shortfall</Badge>}
						</TableCell>
					</TableRow>
				))}
			</DataTable>
			{!events.length && <p>No transactions scheduled in this period.</p>}
			<Notice tone="info" className="my-4">
				<Info size={18} aria-hidden="true" />
				<span>
					Cash above protected balances is not a safe-to-spend recommendation.
					Account safe spending, future commitments and unmodeled expenses can
					still limit spending.
				</span>
			</Notice>
		</Modal>
	);
}
