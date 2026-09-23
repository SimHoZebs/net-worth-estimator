import { memo } from "react";
import { SectionCard } from "@/components/present/present";
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
						<TableCell className="sticky left-0 bg-card/95 type-body whitespace-normal break-words text-foreground/80 backdrop-blur">
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
					className="py-4 text-center type-muted whitespace-normal text-muted-foreground/70"
				>
					{emptyMessage}
				</TableCell>
			</TableRow>
		);

	const renderTable = (title: string, balances: ReconciliationRow[]) => (
		<div className="relative overflow-x-auto overscroll-x-contain">
			<h4 className="mb-2 type-eyebrow">{title}</h4>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="sticky left-0 bg-muted/95 backdrop-blur">
							Account
						</TableHead>
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
			<div
				aria-hidden
				className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent"
			/>
		</div>
	);

	return (
		<SectionCard
			title="Actual and modeled account state"
			className="rounded-[1.6rem] border-border shadow-sm"
		>
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
		</SectionCard>
	);
});
