import { memo } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { currency, formatDate, formatRoute, pct } from "@/lib/format";
import type { PostingFulfillmentPostingSummary } from "@/lib/projection";

interface TransactionCompletionTableProps {
	postingSummaries: PostingFulfillmentPostingSummary[] | null;
}

export const TransactionCompletionTable = memo(
	function TransactionCompletionTable({
		postingSummaries,
	}: TransactionCompletionTableProps) {
		return (
			<Card className="rounded-[1.6rem] border-border shadow-sm ">
				<CardHeader>
					<div>
						<CardTitle>Transaction completion</CardTitle>
						<CardDescription>
							Which scheduled transactions were satisfied, destination-limited,
							or underfunded.
						</CardDescription>
					</div>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Transaction</TableHead>
								<TableHead>Route</TableHead>
								<TableHead>Priority</TableHead>
								<TableHead>Requested</TableHead>
								<TableHead>Applied</TableHead>
								<TableHead>Destination-limited</TableHead>
								<TableHead>Completion</TableHead>
								<TableHead>First unfunded</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{postingSummaries === null ? (
								<TableRow>
									<TableCell
										colSpan={8}
										className="py-6 text-center text-muted-foreground"
									>
										Posting-fulfillment evaluation is unavailable.
									</TableCell>
								</TableRow>
							) : postingSummaries.length > 0 ? (
								postingSummaries.map((summary) => {
									const hasShortfall = summary.unfulfilledAmount > 0;
									const completionRate = summary.completionRate;

									return (
										<TableRow key={summary.postingId}>
											<TableCell>
												<span
													className={
														hasShortfall
															? "type-value font-semibold text-tertiary-foreground"
															: undefined
													}
												>
													{summary.label}
												</span>
											</TableCell>
											<TableCell>
												<span
													className={
														hasShortfall
															? "text-tertiary-foreground"
															: undefined
													}
												>
													{formatRoute(
														summary.sourceAccountLabel,
														summary.destinations,
													)}
												</span>
											</TableCell>
											<TableCell>{summary.priority}</TableCell>
											<TableCell>
												{currency.format(summary.requestedAmount)}
											</TableCell>
											<TableCell>
												<span
													className={
														hasShortfall
															? "text-tertiary-foreground"
															: undefined
													}
												>
													{currency.format(summary.realizedAmount)}
												</span>
											</TableCell>
											<TableCell>
												{currency.format(summary.destinationLimitedAmount)}
											</TableCell>
											<TableCell>
												<span
													className={
														hasShortfall
															? "type-value font-semibold text-tertiary-foreground"
															: undefined
													}
												>
													{pct.format(completionRate)}
												</span>
											</TableCell>
											<TableCell>
												<span
													className={
														hasShortfall
															? "type-value text-tertiary-foreground"
															: "text-muted-foreground/70"
													}
												>
													{hasShortfall
														? formatDate(summary.firstUnderfulfilledDate!)
														: "-"}
												</span>
											</TableCell>
										</TableRow>
									);
								})
							) : (
								<TableRow>
									<TableCell
										colSpan={8}
										className="py-6 text-center text-muted-foreground"
									>
										No scheduled transactions are defined.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		);
	},
);
