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
	Account,
	Posting,
	PostingFulfillmentEvent,
	ProjectionRow,
} from "@/lib/projection";

interface ShortfallDetailPanelProps {
	periodStartDate: string;
	periodLabel: string;
	events: PostingFulfillmentEvent[];
	rows: ProjectionRow[];
	postingById: Record<string, Posting>;
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
	constraints: string[];
}

export function ShortfallDetailPanel({
	periodStartDate,
	periodLabel,
	events,
	rows,
	postingById,
	accounts,
}: ShortfallDetailPanelProps) {
	let prevRow: ProjectionRow | null = null;
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].date < periodStartDate) {
			prevRow = rows[i];
			break;
		}
	}

	const lastPeriodRow = rows.find((row) => row.date === periodStartDate);

	const { cascadeAccounts, cascadeStepsByAccount } = (() => {
		const map = new Map<string, CascadeStep[]>();
		const constrainedAccountIds = new Set<string>();

		const appendStep = (
			accountId: string,
			event: PostingFulfillmentEvent,
			delta: number,
		) => {
			if (!map.has(accountId)) map.set(accountId, []);
			map.get(accountId)?.push({
				postingId: event.postingId,
				label: postingById[event.postingId]?.label ?? event.postingId,
				delta,
				requested: event.requestedAmount,
				realized: event.realizedAmount,
				runningBalance: 0,
				shortfallAmount: event.unfulfilledAmount,
				isShortfall: event.unfulfilledAmount > 0,
				constraints: event.bindingConstraints.map(({ type }) => type),
			});
		};

		for (const event of [...events].sort(
			(left, right) => left.sequence - right.sequence,
		)) {
			const affectedAccountIds = new Set<string>();
			for (const { accountId, delta } of event.accountDeltas) {
				affectedAccountIds.add(accountId);
				appendStep(accountId, event, delta);
			}

			const constrainedIds = event.bindingConstraints.flatMap((constraint) =>
				"accountId" in constraint
					? [constraint.accountId]
					: "accountIds" in constraint
						? constraint.accountIds
						: [],
			);
			for (const accountId of constrainedIds) {
				constrainedAccountIds.add(accountId);
				if (!affectedAccountIds.has(accountId)) appendStep(accountId, event, 0);
			}

			if (event.unfulfilledAmount > 0 && constrainedIds.length === 0) {
				const sourceAccountId = postingById[event.postingId]?.sourceAccountId;
				if (sourceAccountId) {
					constrainedAccountIds.add(sourceAccountId);
					if (!affectedAccountIds.has(sourceAccountId)) {
						appendStep(sourceAccountId, event, 0);
					}
				}
			}
		}

		for (const [accountId, steps] of map) {
			const start =
				prevRow?.accountSnapshots.find(
					(snapshot) => snapshot.accountId === accountId,
				)?.balance ?? 0;
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
				const startBalance =
					prevRow?.accountSnapshots.find(
						(snapshot) => snapshot.accountId === account.id,
					)?.balance ?? 0;
				const endBalance =
					lastPeriodRow?.accountSnapshots.find(
						(snapshot) => snapshot.accountId === account.id,
					)?.balance ?? 0;
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
												step.delta > 0
													? "text-primary"
													: step.delta < 0
														? "text-destructive"
														: "text-muted-foreground";
											return (
												<TableRow
													key={`${step.postingId}-${index}`}
													className="border-b-0"
												>
													<TableCell
														className={`w-4 type-caption ${signColor}`}
													>
														{step.delta > 0 ? "+" : step.delta < 0 ? "-" : "·"}
													</TableCell>
													<TableCell className={`type-caption ${signColor}`}>
														{step.label}
														{step.isShortfall ? (
															<span className="ml-2 inline-flex items-center gap-1 type-value text-tertiary-foreground">
																Shortfall{" "}
																{currency.format(step.shortfallAmount)}
																{step.constraints.length > 0
																	? ` · ${step.constraints.join(", ")}`
																	: ""}
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
