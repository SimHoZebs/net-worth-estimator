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
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted">
						{`${dateLabel(startDate, true)} to ${dateLabel(end, true)}`}
					</p>
					<DialogTitle>The next 30 days</DialogTitle>
				</DialogHeader>
				<p className="mb-6 text-sm text-muted">These amounts are scheduled.</p>
				<div className="my-2 flex justify-end">
					<TransactionSortButton order={order} onChange={setOrder} />
				</div>
				{/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- keyboard users must be able to scroll the wide table region. */}
				<div
					tabIndex={0}
					role="region"
					aria-label="Scheduled transactions for the next 30 days."
					className="relative max-w-full overflow-x-auto"
				>
					<Table className="border-collapse text-left">
						<TableCaption className="sr-only">
							Scheduled transactions for the next 30 days.
						</TableCaption>
						<TableHeader className="border-b border-line bg-surface-2 text-muted">
							<TableRow className="border-b border-line last:border-b-0 hover:bg-transparent">
								<TableHead
									scope="col"
									className="h-auto border-0 px-5 py-4 text-xs font-medium whitespace-nowrap text-muted"
								>
									Date
								</TableHead>
								<TableHead
									scope="col"
									className="h-auto border-0 px-5 py-4 text-xs font-medium whitespace-nowrap text-muted"
								>
									Transaction
								</TableHead>
								<TableHead
									scope="col"
									className="h-auto border-0 px-5 py-4 text-xs font-medium whitespace-nowrap text-muted"
								>
									Requested
								</TableHead>
								<TableHead
									scope="col"
									className="h-auto border-0 px-5 py-4 text-xs font-medium whitespace-nowrap text-muted"
								>
									Funded
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{ordered.map((event, index) => (
								<TableRow
									key={`${event.transactionId}-${index}`}
									className="border-b border-line last:border-b-0 hover:bg-transparent"
								>
									<TableCell className="border-0 px-5 py-4 whitespace-nowrap">
										{dateLabel(event.date, true)}
									</TableCell>
									<TableHead
										scope="row"
										className="h-auto border-0 px-5 py-4 text-sm font-medium whitespace-nowrap text-inherit"
									>
										{event.name}
									</TableHead>
									<TableCell className="border-0 px-5 py-4 whitespace-nowrap">
										{money(event.requested)}
									</TableCell>
									<TableCell className="border-0 px-5 py-4 whitespace-nowrap">
										{money(event.realized)}
										{event.constraint && (
											<Badge
												variant="default"
												className={cn(
													"h-auto bg-warning-bg text-warning-text",
													"inline-flex w-fit items-center gap-1 rounded-control px-2 py-1 text-xs leading-snug font-medium whitespace-nowrap capitalize",
												)}
											>
												Shortfall
											</Badge>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					{/* oxlint-enable jsx-a11y/no-noninteractive-tabindex */}
				</div>
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
