import { dateLabel, exactMoney } from "@/domain/format.ts";
import type { DerivedCardStatement } from "@/domain/derivedStatement.ts";
import { statementStatusLabel } from "@/domain/statementPayment.ts";
import { Button } from "@/components/ui/button.tsx";

/**
 * Presentational list of statements derived from recorded cycle ends. It owns
 * no transport: the caller supplies the statements and the load state, so the
 * same view works with any backend contract mapped into the view model.
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
			<h3 className="m-0 text-base font-semibold">Card statements</h3>
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
				<ul className="divide-y divide-border">
					{statements.map((statement) => (
						<li
							key={statement.id}
							className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm"
						>
							<div>
								<p className="font-medium">
									{dateLabel(statement.closingDate, true)} statement
								</p>
								<p className="text-muted-foreground">
									{statement.dueDate === null
										? "Due date unknown"
										: `Due ${dateLabel(statement.dueDate, true)}`}{" "}
									·{" "}
									{statement.billedAmount === null
										? "Billed amount unknown"
										: `${exactMoney(statement.billedAmount)} billed`}
								</p>
							</div>
							<p>
								{statement.billedAmount === null ||
								statement.remaining === null
									? "Remaining unknown"
									: `${exactMoney(statement.remaining)} remaining`}{" "}
								· {statementStatusLabel(statement.status)}
							</p>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
