import { useState } from "react";
import {
	type ChoiceCardOption,
	ChoiceCards,
} from "@/components/fields/editor-section";
import { LabeledField } from "@/components/fields/field-kit";
import { Button } from "@/components/ui/button";
import { formatPercentRate } from "@/lib/format";
import type {
	FinancialIndependenceExpenseBasis,
	FinancialIndependencePlan,
	FinancialIndependencePrincipalPolicy,
	Posting,
} from "@/lib/projection";

// Thin kit-backed number field. Raw draft text stays in the parent until
// submit, so intermediate states ("", "-", "0x10") are preserved.
export function FiNumberField({
	label,
	description,
	value,
	min,
	max,
	step,
	id,
	onChange,
}: {
	label: string;
	description?: string;
	value: string;
	min?: number;
	max?: number;
	step?: number;
	id?: string;
	onChange: (value: string) => void;
}) {
	return (
		<LabeledField
			label={label}
			description={description}
			id={id}
			type="text"
			inputMode="decimal"
			min={min}
			max={max}
			step={step}
			value={value}
			onChange={onChange}
			className="min-h-11 tabular-nums"
		/>
	);
}

const spendingBasisOptions: Array<
	ChoiceCardOption<FinancialIndependenceExpenseBasis>
> = [
	{
		value: "projection-start-purchasing-power",
		label: "Today's purchasing power",
		badge: "Inflation-adjusted",
		description:
			"Treat the entered amount as purchasing power at the projection start (normally today) and inflate it through each tested FI date.",
	},
	{
		value: "fi-date-dollars",
		label: "Dollars at FI start",
		badge: "Fixed target",
		description:
			"Use the entered amount as first-year spending for every tested FI date. Inflation begins from that date.",
	},
];

export function SpendingValueBasis({
	value,
	onChange,
}: {
	value: FinancialIndependenceExpenseBasis;
	onChange: (basis: FinancialIndependenceExpenseBasis) => void;
}) {
	return (
		<ChoiceCards
			legend="Spending value"
			description="Choose when the entered annual spending amount is valued."
			value={value}
			options={spendingBasisOptions}
			onChange={onChange}
			columns="md:grid-cols-2"
		/>
	);
}

function portfolioPolicies(
	plan: FinancialIndependencePlan,
): Array<ChoiceCardOption<FinancialIndependencePrincipalPolicy>> {
	return [
		{
			value: "preserve-real-principal",
			label: "Preserve purchasing power",
			badge: "Strictest",
			description: `Fund all spending and finish ${plan.evaluationYears} years with selected assets worth at least their starting value after ${formatPercentRate(plan.annualExpenseGrowthRate, 2)} yearly spending inflation.`,
		},
		{
			value: "preserve-nominal-principal",
			label: "Preserve starting dollars",
			badge: "Moderate",
			description: `Fund all spending and finish ${plan.evaluationYears} years with at least the starting dollar balance in selected assets. Purchasing power may decline.`,
		},
		{
			value: "allow-drawdown",
			label: "Allow portfolio drawdown",
			badge: "Most flexible",
			description: `Fund all spending for ${plan.evaluationYears} years. Selected assets may finish below their starting balance or near zero.`,
		},
	];
}

export function EndingPortfolioPolicy({
	plan,
	onChange,
}: {
	plan: FinancialIndependencePlan;
	onChange: (policy: FinancialIndependencePrincipalPolicy) => void;
}) {
	return (
		<ChoiceCards
			legend="Ending portfolio requirement"
			description="This rule is checked after every expense in the FI test period has been funded."
			value={plan.principalPolicy}
			options={portfolioPolicies(plan)}
			onChange={onChange}
			columns="xl:grid-cols-3"
		/>
	);
}

export function RetirementIncomeField({
	postings,
	selectedIds,
	continuingIds,
	onToggle,
}: {
	postings: Posting[];
	selectedIds: ReadonlySet<string>;
	continuingIds: ReadonlySet<string>;
	onToggle: (postingId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const selected = postings.filter((posting) => selectedIds.has(posting.id));
	const candidates = postings.filter(
		(posting) => selectedIds.has(posting.id) || !continuingIds.has(posting.id),
	);
	return (
		<div className="rounded-2xl border border-border/70 bg-card/55 p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<div className="type-label text-foreground">
						Other retirement income
					</div>
					{selected.length === 0 ? (
						<p className="mt-1 type-caption text-muted-foreground">
							None configured. This plan currently relies on portfolio
							withdrawals.
						</p>
					) : (
						<p className="mt-1 type-caption text-muted-foreground">
							{selected.map((posting) => posting.label).join(", ")} will be
							counted as spendable income during FI.
						</p>
					)}
				</div>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => setOpen((current) => !current)}
					aria-expanded={open}
				>
					{open ? "Close income choices" : "Add retirement income"}
				</Button>
			</div>
			{open ? (
				<div className="mt-4 border-t border-border/70 pt-4">
					<p className="mb-3 type-caption text-muted-foreground">
						Choose only income that remains available without continued
						employment. Selected income is treated as spendable and is not
						replayed into its destination account.
					</p>
					{candidates.length === 0 ? (
						<p className="type-caption text-muted-foreground">
							No unassigned income postings are available.
						</p>
					) : (
						<div className="grid gap-2 sm:grid-cols-2">
							{candidates.map((posting) => (
								<label
									key={posting.id}
									className="flex items-start gap-2 rounded-xl border border-border/60 bg-surface/60 p-3 type-caption"
								>
									<input
										type="checkbox"
										checked={selectedIds.has(posting.id)}
										onChange={() => onToggle(posting.id)}
										className="mt-0.5 accent-primary"
									/>
									<span>{posting.label}</span>
								</label>
							))}
						</div>
					)}
				</div>
			) : null}
		</div>
	);
}
