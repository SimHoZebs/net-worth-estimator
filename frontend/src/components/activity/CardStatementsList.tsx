import { FileText } from "lucide-react";
import { dateLabel, exactMoney } from "@/domain/format.ts";
import type { DerivedCardStatement } from "@/domain/derivedStatement.ts";
import { statementStatusLabel } from "@/domain/statementPayment.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { transactionAmountStyles } from "./activityStyles.ts";
import { TransactionItemRow } from "./TransactionItem.tsx";
import { TransactionTable } from "./TransactionTable.tsx";

/**
 * Presentational list of statements derived from recorded cycle ends. It owns
 * no transport: the caller supplies the statements and the load state, so the
 * same view works with any backend contract mapped into the view model.
 *
 * Ready rows reuse the account activity table and row directly. Statements are
 * derived, read-only records, so the row is rendered statically with no button.
 * The tab already names this panel, so the section keeps only its accessible
 * name and no redundant visible heading.
 */
export function CardStatementsList({
	statements,
	state,
	onRetry,
}: {
	statements: readonly DerivedCardStatement[];
	state: "pending" | "error" | "ready";
	onRetry?: () => void;
}) {
	return (
		<section aria-label="Card statements" className="grid gap-4">
			{state === "error" ? (
				<p role="alert">
					Card statements could not be loaded.{" "}
					{onRetry && (
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={onRetry}
						>
							Retry
						</Button>
					)}
				</p>
			) : state === "pending" ? (
				<p className="text-sm text-muted-foreground">Loading statements…</p>
			) : statements.length === 0 ? (
				<p className="text-sm text-muted-foreground">No recorded statements.</p>
			) : (
				<TransactionTable caption="Statement close dates, balances, and payment status.">
					{statements.map((statement) => {
						const closeLabel = dateLabel(statement.closingDate, true);
						const dueLabel =
							statement.dueDate === null
								? "Due date unknown"
								: `Due ${dateLabel(statement.dueDate, true)}`;
						const billedLabel =
							statement.billedAmount === null
								? "Billed amount unknown"
								: `${exactMoney(statement.billedAmount)} billed`;
						const remainingLabel =
							statement.billedAmount === null || statement.remaining === null
								? "Remaining unknown"
								: `${exactMoney(statement.remaining)} remaining`;
						const subtitleLabel = `${dueLabel} · ${billedLabel}`;
						return (
							<TransactionItemRow
								key={statement.id}
								readOnly
								date={
									<time dateTime={statement.closingDate}>{closeLabel}</time>
								}
								icon={<FileText size={16} aria-hidden="true" />}
								tone="transfer"
								title="Card statement"
								slots={{
									subtitle: <span title={subtitleLabel}>{subtitleLabel}</span>,
									mobile: (
										<time dateTime={statement.closingDate}>{closeLabel}</time>
									),
									badges: (
										<Badge variant="secondary">
											{statementStatusLabel(statement.status)}
										</Badge>
									),
								}}
								amount={
									<strong
										className={cn(
											transactionAmountStyles(),
											"block max-w-full whitespace-normal text-right",
										)}
									>
										{remainingLabel}
									</strong>
								}
							/>
						);
					})}
				</TransactionTable>
			)}
		</section>
	);
}
