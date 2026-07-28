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
import { currency } from "@/lib/format";
import type {
	FinancialModelDocument,
	ProjectionResult,
} from "@/lib/projection";

interface NetWorthReconciliationProps {
	document: FinancialModelDocument;
	result: ProjectionResult;
}

export const NetWorthReconciliation = memo(function NetWorthReconciliation({
	document,
	result,
}: NetWorthReconciliationProps) {
	const accountLabels = new Map(
		document.accounts.map((account) => [account.id, account.label]),
	);
	const rows = result.accountSummaries.map((summary) => ({
		accountId: summary.accountId,
		label: accountLabels.get(summary.accountId) ?? summary.accountId,
		balance: summary.startingBalance,
	}));
	const assets = rows.filter((row) => row.balance >= 0);
	const liabilities = rows.filter((row) => row.balance < 0);

	const renderRows = (balances: typeof rows, emptyMessage: string) =>
		balances.length > 0 ? (
			balances.map((row) => (
				<TableRow key={row.accountId}>
					<TableCell className="type-body text-foreground/80">
						{row.label}
					</TableCell>
					<TableCell className="text-right type-value text-sm">
						{currency.format(row.balance)}
					</TableCell>
				</TableRow>
			))
		) : (
			<TableRow>
				<TableCell
					colSpan={2}
					className="py-4 text-center type-muted text-muted-foreground/70"
				>
					{emptyMessage}
				</TableCell>
			</TableRow>
		);

	return (
		<Card className="rounded-[1.6rem] border-border shadow-sm ">
			<CardHeader>
				<div>
					<CardTitle>Current net worth reconciliation</CardTitle>
					<CardDescription>
						Projection-start opening balances used to compute the current net
						worth of {currency.format(result.summary.currentNetWorth)}.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				<div className="grid gap-6 md:grid-cols-2">
					<div>
						<h4 className="mb-2 type-eyebrow">Assets</h4>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Account</TableHead>
									<TableHead className="text-right">Opening balance</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{renderRows(assets, "No asset opening balances.")}
							</TableBody>
						</Table>
					</div>

					<div>
						<h4 className="mb-2 type-eyebrow">Liabilities</h4>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Account</TableHead>
									<TableHead className="text-right">Opening balance</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{renderRows(liabilities, "No liability opening balances.")}
							</TableBody>
						</Table>
					</div>
				</div>

				<div className="mt-4 border-t border-border/70 pt-4">
					<div className="flex items-center justify-between type-body">
						<span className="type-value">Net worth</span>
						<span className="type-value font-semibold">
							{currency.format(result.summary.currentNetWorth)}
						</span>
					</div>
					<div className="type-caption text-muted-foreground/70">
						Computed from projection-start opening balances.
					</div>
				</div>
			</CardContent>
		</Card>
	);
});
