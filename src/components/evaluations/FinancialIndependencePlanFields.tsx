import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
	FinancialIndependencePlan,
	FinancialIndependencePrincipalPolicy,
	Posting,
} from "@/lib/projection";

export const FI_INPUT_CLASS =
	"mt-1 min-w-0 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring dark:border-white/10";

export function FinancialIndependenceEditorSection({
	number,
	title,
	description,
	children,
}: {
	number: string;
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<section className="overflow-hidden rounded-[1.35rem] border border-border/80 bg-surface/60 dark:border-white/10 dark:bg-surface/45">
			<header className="flex gap-3 border-b border-border/70 px-4 py-4 dark:border-white/10">
				<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary-border bg-primary-subtle type-label text-primary">
					{number}
				</span>
				<div>
					<h3 className="type-title text-base">{title}</h3>
					<p className="mt-0.5 max-w-3xl type-caption text-muted-foreground">
						{description}
					</p>
				</div>
			</header>
			<div className="space-y-4 p-4">{children}</div>
		</section>
	);
}

export function FiNumberField({
	label,
	description,
	value,
	min,
	max,
	step,
	onChange,
}: {
	label: string;
	description?: string;
	value: number;
	min?: number;
	max?: number;
	step?: number;
	onChange: (value: number) => void;
}) {
	return (
		<label className="min-w-0 type-caption">
			<span className="type-label text-foreground">{label}</span>
			{description ? (
				<span className="mt-0.5 block text-muted-foreground">
					{description}
				</span>
			) : null}
			<input
				type="number"
				aria-label={label}
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(event) => {
					const parsed = Number(event.target.value);
					onChange(Number.isFinite(parsed) ? parsed : value);
				}}
				className={FI_INPUT_CLASS}
			/>
		</label>
	);
}

const portfolioPolicies: Array<{
	value: FinancialIndependencePrincipalPolicy;
	label: string;
	badge: string;
	description: (plan: FinancialIndependencePlan) => string;
}> = [
	{
		value: "preserve-real-principal",
		label: "Preserve purchasing power",
		badge: "Strictest",
		description: (plan) =>
			`Fund all spending and finish ${plan.evaluationYears} years with selected assets worth at least their starting value after ${formatPercent(plan.annualExpenseGrowthRate)} yearly spending inflation.`,
	},
	{
		value: "preserve-nominal-principal",
		label: "Preserve starting dollars",
		badge: "Moderate",
		description: (plan) =>
			`Fund all spending and finish ${plan.evaluationYears} years with at least the starting dollar balance in selected assets. Purchasing power may decline.`,
	},
	{
		value: "allow-drawdown",
		label: "Allow portfolio drawdown",
		badge: "Most flexible",
		description: (plan) =>
			`Fund all spending for ${plan.evaluationYears} years. Selected assets may finish below their starting balance or near zero.`,
	},
];

export function EndingPortfolioPolicy({
	plan,
	onChange,
}: {
	plan: FinancialIndependencePlan;
	onChange: (policy: FinancialIndependencePrincipalPolicy) => void;
}) {
	const groupName = useId();
	return (
		<fieldset>
			<legend className="type-label text-foreground">
				Ending portfolio requirement
			</legend>
			<p className="mt-0.5 type-caption text-muted-foreground">
				This rule is checked after every expense in the FI test period has been
				funded.
			</p>
			<div className="mt-3 grid gap-2 xl:grid-cols-3">
				{portfolioPolicies.map((option) => {
					const selected = plan.principalPolicy === option.value;
					return (
						<label
							key={option.value}
							className={`cursor-pointer rounded-2xl border p-4 transition ${
								selected
									? "border-primary-border bg-primary-subtle/55 shadow-sm"
									: "border-border/70 bg-card/55 hover:border-ring/60"
							}`}
						>
							<span className="flex items-start gap-2">
								<input
									type="radio"
									aria-label={option.label}
									name={groupName}
									value={option.value}
									checked={selected}
									onChange={() => onChange(option.value)}
									className="mt-1 accent-primary"
								/>
								<span>
									<span className="block type-label text-foreground">
										{option.label}
									</span>
									<span className="mt-1 inline-block rounded-full border border-border/70 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
										{option.badge}
									</span>
								</span>
							</span>
							<span className="mt-3 block type-caption leading-relaxed text-muted-foreground">
								{option.description(plan)}
							</span>
						</label>
					);
				})}
			</div>
		</fieldset>
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

function formatPercent(value: number) {
	return `${new Intl.NumberFormat("en-US", {
		maximumFractionDigits: 2,
	}).format(value * 100)}%`;
}
