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
import { currency, formatDate } from "@/lib/format";
import type {
	Checkpoint,
	FinancialModelDocument,
	ProjectionResult,
} from "@/lib/projection";

interface NetWorthReconciliationProps {
	document: FinancialModelDocument;
	result: ProjectionResult;
}

interface ReconciliationRow {
	accountId: string;
	label: string;
	checkpoint: Checkpoint | null;
	modeledBalanceAtCheckpoint: number | null;
	projectionStartBalance: number;
}

export function buildReconciliationRows(
	document: FinancialModelDocument,
	result: ProjectionResult,
): ReconciliationRow[] {
	const latestCheckpointByAccount = new Map<string, Checkpoint>();
	for (const checkpoint of document.checkpoints) {
		const latest = latestCheckpointByAccount.get(checkpoint.AccountId);
		if (!latest || checkpoint.Date > latest.Date) {
			latestCheckpointByAccount.set(checkpoint.AccountId, checkpoint);
		}
	}
	const correctionsByCheckpoint = new Map(
		result.timeline.rows.flatMap((row) =>
			(row.checkpointCorrections ?? []).map(
				(correction) =>
					[`${row.date}\u0000${correction.accountId}`, correction] as const,
			),
		),
	);

	return result.accountSummaries
		.filter((summary) => summary.enabled)
		.map((summary) => {
			const checkpoint =
				latestCheckpointByAccount.get(summary.accountId) ?? null;
			const correction = checkpoint
				? correctionsByCheckpoint.get(
						`${checkpoint.Date}\u0000${summary.accountId}`,
					)
				: null;
			return {
				accountId: summary.accountId,
				label: summary.label,
				checkpoint,
				modeledBalanceAtCheckpoint: correction?.modeledBalance ?? null,
				projectionStartBalance: summary.startingBalance,
			};
		});
}

export const NetWorthReconciliation = memo(function NetWorthReconciliation({
	document,
	result,
}: NetWorthReconciliationProps) {
	const rows = buildReconciliationRows(document, result);
	const assets = rows.filter(
		(row) => (row.checkpoint?.Balance ?? row.projectionStartBalance) >= 0,
	);
	const liabilities = rows.filter(
		(row) => (row.checkpoint?.Balance ?? row.projectionStartBalance) < 0,
	);
	const observedRows = rows.filter((row) => row.checkpoint !== null);

	const renderRows = (balances: ReconciliationRow[], emptyMessage: string) =>
		balances.length > 0 ? (
			balances.map((row) => {
				const observedBalance = row.checkpoint?.Balance;
				const modeledBalance = row.modeledBalanceAtCheckpoint;
				return (
					<TableRow key={row.accountId}>
						<TableCell className="type-body text-foreground/80">
							{row.label}
						</TableCell>
						<TableCell className="text-right type-value text-sm">
							{observedBalance === undefined
								? "Not observed"
								: currency.format(observedBalance)}
						</TableCell>
						<TableCell className="type-muted">
							{row.checkpoint ? formatDate(row.checkpoint.Date) : "-"}
						</TableCell>
						<TableCell className="text-right type-value text-sm">
							{modeledBalance === null
								? "No same-date snapshot"
								: currency.format(modeledBalance)}
						</TableCell>
						<TableCell className="text-right type-value text-sm">
							{observedBalance === undefined || modeledBalance === null
								? "-"
								: currency.format(observedBalance - modeledBalance)}
						</TableCell>
					</TableRow>
				);
			})
		) : (
			<TableRow>
				<TableCell
					colSpan={5}
					className="py-4 text-center type-muted text-muted-foreground/70"
				>
					{emptyMessage}
				</TableCell>
			</TableRow>
		);

	const renderTable = (title: string, balances: ReconciliationRow[]) => (
		<div className="overflow-x-auto">
			<h4 className="mb-2 type-eyebrow">{title}</h4>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Account</TableHead>
						<TableHead className="text-right">Observed</TableHead>
						<TableHead>As of</TableHead>
						<TableHead className="text-right">Modeled same date</TableHead>
						<TableHead className="text-right">Difference</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{renderRows(balances, `No ${title.toLowerCase()} accounts.`)}
				</TableBody>
			</Table>
		</div>
	);

	return (
		<Card className="rounded-[1.6rem] border-border shadow-sm">
			<CardHeader>
				<div>
					<CardTitle>Actual and modeled account state</CardTitle>
					<CardDescription>
						Each checkpoint corrects its account after same-date postings. The
						difference shows the modeled balance immediately before correction.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-6">
					{renderTable("Assets", assets)}
					{renderTable("Liabilities", liabilities)}
				</div>

				<div className="mt-4 grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-2">
					<div>
						<div className="type-caption text-muted-foreground/70">
							Checkpoint coverage
						</div>
						<div className="type-value font-semibold">
							{observedRows.length} of {rows.length} active accounts
						</div>
						<div className="type-caption text-muted-foreground/70">
							Independently dated observations are not summed.
						</div>
					</div>
					<div className="sm:text-right">
						<div className="type-caption text-muted-foreground/70">
							Posting-derived current net worth
						</div>
						<div className="type-value font-semibold">
							{currency.format(result.summary.currentNetWorth)}
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
});
