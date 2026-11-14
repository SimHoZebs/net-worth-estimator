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
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";

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
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
						{`${dateLabel(startDate, true)} to ${dateLabel(end, true)}`}
					</p>
					<DialogTitle>The next 30 days</DialogTitle>
				</DialogHeader>
				<p className="mb-6 text-sm text-muted-foreground">
					These amounts are scheduled.
				</p>
				<div className="my-2 flex justify-end">
					<TransactionSortButton order={order} onChange={setOrder} />
				</div>
				<Table
					containerProps={{
						role: "region",
						"aria-label": "Scheduled transactions for the next 30 days.",
					}}
				>
					<TableCaption className="sr-only">
						Scheduled transactions for the next 30 days.
					</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">Date</TableHead>
							<TableHead scope="col">Transaction</TableHead>
							<TableHead scope="col" className="text-right">
								Requested
							</TableHead>
							<TableHead scope="col" className="text-right">
								Funded
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{ordered.map((event, index) => (
							<TableRow key={`${event.transactionId}-${index}`}>
								<TableCell>{dateLabel(event.date, true)}</TableCell>
								<TableHead scope="row">{event.name}</TableHead>
								<TableCell className="text-right">
									{money(event.requested)}
								</TableCell>
								<TableCell className="text-right">
									{money(event.realized)}
									{event.constraint && (
										<Badge
											variant="default"
											className="bg-warning-bg text-warning-text"
										>
											Shortfall
										</Badge>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				{!events.length && <p>No transactions scheduled in this period.</p>}
				<Alert
					role="note"
					className={cn(
						"border-success-border bg-success-bg text-success-text",
						"my-4",
					)}
				>
					<Info size={18} aria-hidden="true" />
					<AlertDescription className="text-success-text">
						Cash above protected balances is not a safe-to-spend recommendation.
						Account safe spending, future commitments and unmodeled expenses can
						still limit spending.
					</AlertDescription>
				</Alert>
			</DialogContent>
		</Dialog>
	);
}
