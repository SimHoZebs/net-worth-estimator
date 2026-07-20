import { useMemo } from "react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { currency } from "@/lib/format";
import type { Account, Posting, ProjectionRow } from "@/lib/projection";

interface ShortfallDetailPanelProps {
	periodStartDate: string;
	periodLabel: string;
	periodRows: ProjectionRow[];
	rows: ProjectionRow[];
	postingById: Record<string, Posting>;
	postingLabelById: Record<string, string>;
	accounts: Account[];
}

interface CascadeStep {
	postingId: string;
	label: string;
	delta: number;
	requested: number;
	realized: number;
	runningBalance: number;
	shortfallAmount: number;
	isShortfall: boolean;
}

export function ShortfallDetailPanel({
	periodStartDate,
	periodLabel,
	periodRows,
	rows,
	postingById,
	postingLabelById,
	accounts,
}: ShortfallDetailPanelProps) {
	let prevRow: ProjectionRow | null = null;
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].date < periodStartDate) {
			prevRow = rows[i];
			break;
		}
	}

	const periodRequested: Record<string, number> = {};
	const periodRealized: Record<string, number> = {};

	for (const periodRow of periodRows) {
		for (const [id, amount] of Object.entries(
			periodRow.requestedPostingAmountsById,
		)) {
			periodRequested[id] = (periodRequested[id] ?? 0) + amount;
		}
		for (const [id, amount] of Object.entries(
			periodRow.realizedPostingAmountsById,
		)) {
			periodRealized[id] = (periodRealized[id] ?? 0) + amount;
		}
	}

	const lastPeriodRow = periodRows[periodRows.length - 1];

	const prevRowBalances = useMemo(() => {
		const map = new Map<string, number>();
		if (prevRow?.accountSnapshots) {
			for (const snapshot of prevRow.accountSnapshots) {
				map.set(snapshot.accountId, snapshot.balance);
			}
		}
		return map;
	}, [prevRow]);

	const lastPeriodRowBalances = useMemo(() => {
		const map = new Map<string, number>();
		if (lastPeriodRow?.accountSnapshots) {
			for (const snapshot of lastPeriodRow.accountSnapshots) {
				map.set(snapshot.accountId, snapshot.balance);
			}
		}
		return map;
	}, [lastPeriodRow]);

	const { cascadeAccounts, cascadeStepsByAccount } = (() => {
		const map = new Map<string, CascadeStep[]>();
		const constrainedAccountIds = new Set<string>();

		for (const periodRow of periodRows) {
			for (const snapshot of periodRow.accountSnapshots) {
				if (snapshot.impacts.length === 0) continue;
				for (const impact of snapshot.impacts) {
					const shortfallAmount = Math.max(
						0,
						(periodRequested[impact.postingId] ?? 0) -
							(periodRealized[impact.postingId] ?? 0),
					);
					const isShortfall = shortfallAmount > 0;
					if (isShortfall && postingById[impact.postingId]?.sourceAccountId) {
						constrainedAccountIds.add(
							postingById[impact.postingId]?.sourceAccountId!,
						);
					}
					if (!map.has(snapshot.accountId)) map.set(snapshot.accountId, []);
					map.get(snapshot.accountId)?.push({
						postingId: impact.postingId,
						label: postingLabelById[impact.postingId] ?? impact.postingId,
						delta: impact.delta,
						requested:
							periodRow.requestedPostingAmountsById[impact.postingId] ?? 0,
						realized:
							periodRow.realizedPostingAmountsById[impact.postingId] ?? 0,
						runningBalance: 0,
						shortfallAmount,
						isShortfall,
					});
				}
			}
		}

		for (const [accountId, steps] of map) {
			steps.sort(
				(left, right) =>
					(postingById[left.postingId]?.priority ?? 0) -
					(postingById[right.postingId]?.priority ?? 0),
			);
			const start = prevRowBalances.get(accountId) ?? 0;
			let running = start;
			for (const step of steps) {
				running += step.delta;
				step.runningBalance = running;
			}
		}

		const cascadeRows = accounts
			.filter((account) => account.enabled && map.has(account.id))
			.sort((left, right) => {
				const leftConstrained = constrainedAccountIds.has(left.id);
				const rightConstrained = constrainedAccountIds.has(right.id);
				if (leftConstrained !== rightConstrained)
					return leftConstrained ? -1 : 1;
				return left.label.localeCompare(right.label);
			});

		return { cascadeAccounts: cascadeRows, cascadeStepsByAccount: map };
	})();

	return (
		<div className="space-y-3">
			<div className="type-body type-value font-semibold/80">
				Cash flow for {periodLabel}
			</div>

			{cascadeAccounts.map((account) => {
				const steps = cascadeStepsByAccount.get(account.id) ?? [];
				const startBalance = prevRowBalances.get(account.id) ?? 0;
				const endBalance = lastPeriodRowBalances.get(account.id) ?? 0;
				const change = endBalance - startBalance;
				const changeColor =
					change > 0
						? "text-primary"
						: change < 0
							? "text-destructive"
							: "text-muted-foreground/70";
				const accountsWithSteps = steps.length > 0;
				const hasShortfall = steps.some((step) => step.isShortfall);

				return (
					<details
						key={account.id}
						open={hasShortfall}
						className="rounded-lg border border-border/70 bg-card"
					>
						<summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 type-caption type-value/80 hover:bg-muted">
							<span className="flex items-center gap-2">
								{account.color ? (
									<span
										className="inline-block h-2 w-2 rounded-full"
										style={{ backgroundColor: account.color }}
									/>
								) : null}
								{account.label}
							</span>
							<span className="flex items-center gap-3 type-caption">
								{accountsWithSteps ? (
									<>
										<span>
											{currency.format(startBalance)} -&gt;{" "}
											{currency.format(endBalance)}
										</span>
										<span className={changeColor}>
											{change > 0 ? "+" : ""}
											{currency.format(change)}
										</span>
									</>
								) : (
									<span className="text-muted-foreground/70">
										{currency.format(endBalance)}
									</span>
								)}
								<svg
									className="h-3 w-3 text-muted-foreground/70"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
								>
									<polyline points="6 9 12 15 18 9" />
								</svg>
							</span>
						</summary>
						{accountsWithSteps ? (
							<div className="border-t border-border/70 px-3 pb-2 pt-1">
								<Table>
									<TableHeader>
										<TableRow className="border-b border-border/70 hover:bg-transparent">
											<TableHead className="w-4 type-caption text-muted-foreground/70"></TableHead>
											<TableHead className="type-caption">Flow</TableHead>
											<TableHead className="text-right type-caption">
												Requested
											</TableHead>
											<TableHead className="text-right type-caption">
												Applied
											</TableHead>
											<TableHead className="text-right type-caption">
												Impact
											</TableHead>
											<TableHead className="text-right type-caption">
												Running balance
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										<TableRow className="border-b-0">
											<TableCell className="w-4 type-caption text-muted-foreground/70"></TableCell>
											<TableCell className="type-label">Start</TableCell>
											<TableCell className="type-caption text-right text-muted-foreground/70"></TableCell>
											<TableCell className="type-caption text-right text-muted-foreground/70"></TableCell>
											<TableCell className="type-caption text-right text-muted-foreground/70"></TableCell>
											<TableCell className="type-caption text-right type-value/80">
												{currency.format(startBalance)}
											</TableCell>
										</TableRow>
										{steps.map((step, index) => {
											const signColor =
												step.delta > 0 ? "text-primary" : "text-destructive";
											return (
												<TableRow
													key={`${step.postingId}-${index}`}
													className="border-b-0"
												>
													<TableCell
														className={`w-4 type-caption ${signColor}`}
													>
														{step.delta > 0 ? "+" : "-"}
													</TableCell>
													<TableCell className={`type-caption ${signColor}`}>
														{step.label}
														{step.isShortfall ? (
															<span className="ml-2 inline-flex items-center gap-1 type-value text-tertiary-foreground">
																Shortfall{" "}
																{currency.format(step.shortfallAmount)}
															</span>
														) : null}
													</TableCell>
													<TableCell
														className={`type-caption text-right ${signColor}`}
													>
														{currency.format(step.requested)}
													</TableCell>
													<TableCell
														className={`type-caption text-right ${signColor}`}
													>
														{currency.format(step.realized)}
													</TableCell>
													<TableCell
														className={`type-caption font-medium text-right ${signColor}`}
													>
														{currency.format(Math.abs(step.delta))}
													</TableCell>
													<TableCell
														className={`type-caption font-medium text-right ${signColor}`}
													>
														{currency.format(step.runningBalance)}
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</div>
						) : null}
					</details>
				);
			})}
		</div>
	);
}
