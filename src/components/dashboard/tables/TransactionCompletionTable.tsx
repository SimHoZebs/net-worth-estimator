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
import type { ProjectionResult } from "@/lib/projection";

interface TransactionCompletionTableProps {
	postingSummaries: ProjectionResult["postingSummaries"];
}

export const TransactionCompletionTable = memo(
	function TransactionCompletionTable({
		postingSummaries,
	}: TransactionCompletionTableProps) {
		return (
			<Card className="rounded-[1.6rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
				<CardHeader>
					<div>
						<CardTitle>Transaction completion</CardTitle>
						<CardDescription>
							Which scheduled transactions were fully applied and which were
							limited by available funds.
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
								<TableHead>Completion</TableHead>
								<TableHead>First unfunded</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{postingSummaries.length > 0 ? (
								postingSummaries.map((summary) => {
									const hasShortfall = summary.utilizationRate < 1;

									return (
										<TableRow key={summary.postingId}>
											<TableCell>
												<span
													className={
														hasShortfall
															? "font-semibold text-amber-700 dark:text-amber-400"
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
															? "text-amber-700 dark:text-amber-400"
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
															? "text-amber-700 dark:text-amber-400"
															: undefined
													}
												>
													{currency.format(summary.realizedAmount)}
												</span>
											</TableCell>
											<TableCell>
												<span
													className={
														hasShortfall
															? "font-semibold text-amber-700 dark:text-amber-400"
															: undefined
													}
												>
													{pct.format(summary.utilizationRate)}
												</span>
											</TableCell>
											<TableCell>
												<span
													className={
														hasShortfall
															? "font-medium text-amber-700 dark:text-amber-400"
															: "text-slate-400 dark:text-slate-500"
													}
												>
													{hasShortfall
														? formatDate(summary.firstShortfallDate!)
														: "-"}
												</span>
											</TableCell>
										</TableRow>
									);
								})
							) : (
								<TableRow>
									<TableCell
										colSpan={7}
										className="py-6 text-center text-slate-500 dark:text-slate-400"
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
