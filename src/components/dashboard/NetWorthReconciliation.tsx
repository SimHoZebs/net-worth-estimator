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
	const latestDate =
		result.milestones.latestHistoricalDate ??
		result.milestones.projectionStartDate;

	// Group checkpoints by account, take the latest one per account
	const accountMap = new Map<
		string,
		{ label: string; balance: number; checkpointDate: string }
	>();
	for (const cp of document.checkpoints) {
		const account = document.accounts.find((a) => a.id === cp.AccountId);
		const existing = accountMap.get(cp.AccountId);
		if (!existing || cp.Date > existing.checkpointDate) {
			accountMap.set(cp.AccountId, {
				label: account?.label ?? cp.AccountId,
				balance: cp.Balance,
				checkpointDate: cp.Date,
			});
		}
	}

	const rows = Array.from(accountMap.entries()).map(([accountId, data]) => ({
		accountId,
		...data,
		isLatest: data.checkpointDate === latestDate,
	}));

	const assets = rows.filter((r) => r.balance >= 0);
	const liabilities = rows.filter((r) => r.balance < 0);

	return (
		<Card className="rounded-[1.6rem] border-border shadow-sm ">
			<CardHeader>
				<div>
					<CardTitle>Current net worth reconciliation</CardTitle>
					<CardDescription>
						Which balances were used to compute the current net worth of{" "}
						{currency.format(result.summary.currentNetWorth)}.
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
									<TableHead className="text-right">Balance</TableHead>
									<TableHead>As of</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{assets.length > 0 ? (
									assets.map((r) => (
										<TableRow key={r.accountId}>
											<TableCell className="type-body text-foreground/80">
												{r.label}
											</TableCell>
											<TableCell className="text-right type-value text-sm">
												{currency.format(r.balance)}
											</TableCell>
											<TableCell className="type-muted">
												{formatDate(r.checkpointDate)}
												{r.isLatest ? " · latest" : ""}
											</TableCell>
										</TableRow>
									))
								) : (
									<TableRow>
										<TableCell
											colSpan={3}
											className="py-4 text-center type-muted text-muted-foreground/70"
										>
											No asset checkpoints.
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>

					<div>
						<h4 className="mb-2 type-eyebrow">Liabilities</h4>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Account</TableHead>
									<TableHead className="text-right">Balance</TableHead>
									<TableHead>As of</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{liabilities.length > 0 ? (
									liabilities.map((r) => (
										<TableRow key={r.accountId}>
											<TableCell className="type-body text-foreground/80">
												{r.label}
											</TableCell>
											<TableCell className="text-right type-value text-sm">
												{currency.format(r.balance)}
											</TableCell>
											<TableCell className="type-muted">
												{formatDate(r.checkpointDate)}
												{r.isLatest ? " · latest" : ""}
											</TableCell>
										</TableRow>
									))
								) : (
									<TableRow>
										<TableCell
											colSpan={3}
											className="py-4 text-center type-muted text-muted-foreground/70"
										>
											No liability checkpoints.
										</TableCell>
									</TableRow>
								)}
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
						Computed from the latest checkpoint per account.
					</div>
				</div>
			</CardContent>
		</Card>
	);
});
