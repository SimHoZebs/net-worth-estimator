import { memo } from "react";
import {
	EmptyState,
	Metric,
	PageHeader,
	Pill,
	SectionCard,
} from "@/components/present/present";
import { currency, formatDate, pct } from "@/lib/format";
import type {
	FinancialIndependenceDetailedRunOutcome,
	FinancialIndependencePlan,
	FinancialIndependenceRow,
	FinancialModelDocument,
} from "@/lib/projection";

interface OverviewCardProps {
	document: FinancialModelDocument;
	plan: FinancialIndependencePlan;
	row: FinancialIndependenceRow | undefined;
	outcome: FinancialIndependenceDetailedRunOutcome | undefined;
}

export const OverviewCard = memo(function OverviewCard({
	document,
	plan,
	row,
	outcome,
}: OverviewCardProps) {
	const accountsById = new Map(
		document.accounts.map((account) => [account.id, account]),
	);
	const postingsById = new Map(
		document.postings.map((posting) => [posting.id, posting]),
	);
	const directIncomeLabels = [
		...new Set(
			plan.sources.flatMap((source) => {
				if (source.type !== "cashflow" || !source.included) return [];
				const posting = postingsById.get(source.postingId);
				return posting?.enabled ? [posting.label] : [];
			}),
		),
	];

	return (
		<SectionCard
			className="rounded-[1.8rem] border-primary-border/55 bg-gradient-to-br from-card/96 via-card/92 to-primary-subtle/30"
			contentClassName="p-4"
		>
			{row && outcome ? (
				<>
					<PageHeader
						stacked
						level="h3"
						eyebrow="FI date"
						eyebrowClassName="type-eyebrow"
						title={formatDate(row.date)}
						titleClassName="mt-2 text-balance text-xl font-semibold tracking-tight text-foreground"
						description={`Spending target in ${expenseBasisLabel(plan)}`}
						descriptionClassName="mt-1 type-caption"
						className="border-b border-border/70 pb-4"
					/>

					<TestSummary plan={plan} row={row} outcome={outcome} />

					{directIncomeLabels.length > 0 || row.annualDirectIncome > 0 ? (
						<div className="border-b border-border/70 py-3">
							<div className="type-label">Annual direct income</div>
							<div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
								<span className="text-foreground/85">
									{directIncomeLabels.length > 0
										? formatList(directIncomeLabels)
										: "Selected cash flow"}
								</span>
								<strong className="type-value tabular-nums">
									{currency.format(row.annualDirectIncome)}
								</strong>
							</div>
						</div>
					) : null}

					{row.assetContributions.length > 0 ? (
						<div className="py-3">
							<div className="mb-2 type-label">Selected accounts</div>
							<div className="overflow-x-auto">
								<div className="min-w-[34rem]">
									<div className="grid grid-cols-[minmax(10rem,1fr)_8rem_7rem_9rem] gap-3 border-b border-border/70 pb-2 type-label">
										<span>Account</span>
										<span className="text-right">FI-date balance</span>
										<span className="text-right">Withdrawal rate</span>
										<span className="text-right">Annual capacity</span>
									</div>
									{row.assetContributions.map((contribution) => {
										const account = accountsById.get(contribution.accountId);
										return (
											<div
												key={contribution.accountId}
												className="grid grid-cols-[minmax(10rem,1fr)_8rem_7rem_9rem] gap-3 border-b border-border/45 py-2 text-sm last:border-0"
											>
												<span className="flex min-w-0 items-center gap-2 text-foreground/85">
													<span
														className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground"
														style={
															account?.color
																? { backgroundColor: account.color }
																: undefined
														}
													/>
													<span className="truncate">
														{account?.label ?? contribution.accountId}
													</span>
												</span>
												<span className="text-right tabular-nums">
													{currency.format(contribution.balance)}
												</span>
												<span className="text-right tabular-nums">
													{pct.format(contribution.withdrawalRate)}
												</span>
												<strong className="text-right type-value tabular-nums">
													{currency.format(
														contribution.annualWithdrawalCapacity,
													)}
												</strong>
											</div>
										);
									})}
								</div>
							</div>
						</div>
					) : null}
				</>
			) : (
				<EmptyState>
					<p className="text-pretty text-foreground">
						No complete {yearTestLabel(plan.evaluationYears)} fits in the
						projection horizon.
					</p>
				</EmptyState>
			)}
		</SectionCard>
	);
});

function TestSummary({
	plan,
	row,
	outcome,
}: {
	plan: FinancialIndependencePlan;
	row: FinancialIndependenceRow;
	outcome: FinancialIndependenceDetailedRunOutcome;
}) {
	const status =
		outcome.status === "ineligible"
			? "Not ready"
			: !outcome.expensesFullyCovered
				? `${currency.format(outcome.withdrawals.shortfallAmount)} short`
				: !outcome.principalReplenished
					? "Principal below target"
					: "Passed";
	const passed = status === "Passed";
	return (
		<div
			className={`my-3 rounded-2xl border px-4 py-3 ${passed ? "border-primary-border/60 bg-primary-subtle/40" : "border-tertiary-border/70 bg-tertiary-subtle/45"}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-current/15 pb-3">
				<div className="type-label">{yearTestLabel(plan.evaluationYears)}</div>
				<Pill
					tone="neutral"
					textClassName="type-label tracking-[0.12em]"
					className="border-current/15 bg-card/55"
				>
					{status}
				</Pill>
			</div>
			<div className="grid gap-2 pt-3 sm:grid-cols-2">
				<Metric
					size="sm"
					label="Net worth"
					ariaLabel="Net worth"
					value={`${currency.format(row.netWorth)} / ${currency.format(row.minimumNetWorth)}`}
					detail="current / minimum"
					trailing={
						<Pill
							size="xs"
							tone={outcome.minimumNetWorthMet ? "primary" : "tertiary"}
							textClassName="type-label tracking-[0.1em]"
							className="border-0"
						>
							{outcome.minimumNetWorthMet ? "Met" : "Below"}
						</Pill>
					}
					className="border-border/60 bg-card/55 px-3 py-2"
					labelClassName="type-label text-foreground/75"
					valueClassName="mt-1 type-value tabular-nums"
					detailClassName="mt-0.5 type-caption"
				/>
				<Metric
					size="sm"
					label="FI-date annual capacity"
					ariaLabel="FI-date annual capacity"
					value={`${currency.format(row.totalAnnualCapacity)} / ${currency.format(row.annualExpenseTarget)}`}
					detail="capacity / target"
					trailing={
						<Pill
							size="xs"
							tone={outcome.initialCoverageMet ? "primary" : "tertiary"}
							textClassName="type-label tracking-[0.1em]"
							className="border-0"
						>
							{outcome.initialCoverageMet ? "Met" : "Below"}
						</Pill>
					}
					className="border-border/60 bg-card/55 px-3 py-2"
					labelClassName="type-label text-foreground/75"
					valueClassName="mt-1 type-value tabular-nums"
					detailClassName="mt-0.5 type-caption"
				/>
			</div>
			<div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-current/15 pt-3 type-caption">
				<span>
					Spending growth: {pct.format(plan.annualExpenseGrowthRate)} / year
				</span>
				<span>Principal target: {principalTargetLabel(plan)}</span>
			</div>
		</div>
	);
}

function expenseBasisLabel(plan: FinancialIndependencePlan) {
	return plan.annualExpenseTargetBasis === "projection-start-purchasing-power"
		? "projection-start purchasing power"
		: "dollars at FI start";
}

function principalTargetLabel(plan: FinancialIndependencePlan) {
	switch (plan.principalPolicy) {
		case "preserve-real-principal":
			return "Purchasing power";
		case "preserve-nominal-principal":
			return "Starting dollars";
		case "allow-drawdown":
			return "Drawdown allowed";
	}
}

function yearTestLabel(years: number) {
	return `${years}-year test`;
}

function formatList(items: string[]) {
	if (items.length < 2) return items[0] ?? "the required gates";
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
