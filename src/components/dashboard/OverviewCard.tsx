import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
		<Card className="rounded-[1.8rem] border-primary-border/55 bg-gradient-to-br from-card/96 via-card/92 to-primary-subtle/30">
			<CardContent className="p-5 md:p-6">
				{row && outcome ? (
					<>
						<div className="border-b border-border/70 pb-5">
							<div className="type-eyebrow">FI date</div>
							<h3 className="mt-2 text-balance text-xl font-semibold tracking-tight text-foreground md:text-2xl">
								{formatDate(row.date)}
							</h3>
							<div className="mt-1 type-caption">
								Spending target in {expenseBasisLabel(plan)}
							</div>
						</div>

						<TestSummary plan={plan} row={row} outcome={outcome} />

						{directIncomeLabels.length > 0 || row.annualDirectIncome > 0 ? (
							<div className="border-b border-border/70 py-4">
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
							<div className="py-4">
								<div className="mb-3 type-label">Selected accounts</div>
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
													className="grid grid-cols-[minmax(10rem,1fr)_8rem_7rem_9rem] gap-3 border-b border-border/45 py-3 text-sm last:border-0"
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
					<div className="rounded-2xl border border-dashed border-border/80 p-5">
						<div className="type-eyebrow">Financial independence result</div>
						<p className="mt-2 text-pretty text-foreground">
							No complete {yearTestLabel(plan.evaluationYears)} fits in the
							projection horizon.
						</p>
					</div>
				)}
			</CardContent>
		</Card>
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
			className={`my-4 rounded-2xl border px-4 py-4 md:px-5 ${passed ? "border-primary-border/60 bg-primary-subtle/40" : "border-tertiary-border/70 bg-tertiary-subtle/45"}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-current/15 pb-3">
				<div className="type-label">{yearTestLabel(plan.evaluationYears)}</div>
				<strong className="rounded-full border border-current/15 bg-card/55 px-3 py-1 type-label uppercase tracking-[0.12em]">
					{status}
				</strong>
			</div>
			<div className="grid gap-3 pt-3 sm:grid-cols-2">
				<SummaryCheck
					label="Net worth"
					value={`${currency.format(row.netWorth)} / ${currency.format(row.minimumNetWorth)}`}
					basis="current / minimum"
					met={outcome.minimumNetWorthMet}
				/>
				<SummaryCheck
					label="FI-date annual capacity"
					value={`${currency.format(row.totalAnnualCapacity)} / ${currency.format(row.annualExpenseTarget)}`}
					basis="capacity / target"
					met={outcome.initialCoverageMet}
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

function SummaryCheck({
	label,
	value,
	basis,
	met,
}: {
	label: string;
	value: string;
	basis: string;
	met: boolean;
}) {
	return (
		<section
			aria-label={label}
			className="rounded-xl border border-border/60 bg-card/55 px-3 py-3"
		>
			<div className="flex items-center justify-between gap-3">
				<div className="type-label text-foreground/75">{label}</div>
				<span
					className={`rounded-full px-2 py-0.5 type-label uppercase tracking-[0.1em] ${met ? "bg-primary-subtle text-primary" : "bg-tertiary-subtle text-tertiary-foreground"}`}
				>
					{met ? "Met" : "Below"}
				</span>
			</div>
			<div className="mt-2 type-value tabular-nums">{value}</div>
			<div className="mt-0.5 type-caption">{basis}</div>
		</section>
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
