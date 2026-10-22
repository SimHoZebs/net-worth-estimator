import { CalendarDays, CheckCircle2 } from "lucide-react";
import { SegmentedBar } from "../../../components/SegmentedBar.tsx";
import { exactMoney, monthDay } from "../../../domain/format.ts";
import { cycleAllowance } from "../../../domain/safeSpending.ts";
import {
	householdPanelStyles,
	householdValueStyles,
} from "./householdStyles.ts";
import type {
	PaycheckDecomposition,
	SafeSpendingHeroes,
} from "./safeSpendingDetailModel.ts";
import {
	SAFE_SPENDING_LABELS as labels,
	SAFE_SPENDING_FORMULAS as formulas,
} from "./safeSpendingLabels.ts";

const budgetMoney = (amount: number | null) =>
	amount === null ? "—" : exactMoney(amount);

export function HouseholdBudgetSummary({
	heroes,
	paycheck,
}: {
	heroes: SafeSpendingHeroes;
	paycheck: PaycheckDecomposition;
}) {
	// The next paycheck covers the closed statement. New-cycle charges remain
	// separate from this allocation and from the existing cycle allowance.
	const remainder =
		heroes.closedCycle.total === null
			? null
			: cycleAllowance({
					paycheck: paycheck.paycheck,
					fixedObligations: paycheck.fixed,
					spent: heroes.closedCycle.total,
					reserve: 0,
				});
	const unallocated = remainder === null ? null : remainder - paycheck.reserve;
	return (
		<section
			className="@container grid gap-3"
			aria-label={labels.paycheckAllocation}
		>
			<div className={householdPanelStyles()}>
				<div className="flex items-center justify-between gap-2 text-xs font-bold tracking-wide text-muted uppercase">
					<span>
						{labels.nextPaycheck}
						{heroes.paycheckDate && (
							<>
								{" "}
								·{" "}
								<time dateTime={heroes.paycheckDate}>
									{monthDay(heroes.paycheckDate)}
								</time>
							</>
						)}
					</span>
					<CalendarDays size={19} aria-hidden="true" />
				</div>
				<strong className="text-4xl leading-tight tracking-tight tabular-nums">
					{exactMoney(paycheck.paycheck)}
				</strong>
				{!heroes.paycheckDate && (
					<p className="text-xs text-muted">Date not available</p>
				)}
				{remainder !== null && (
					<SegmentedBar
						caption={labels.paycheckAllocation}
						showDetails={false}
						segments={[
							{
								label: labels.fixedBills,
								amount: paycheck.fixed,
								tone: "blue",
								pattern: "stripes",
							},
							{
								label: labels.closedCards,
								amount: heroes.closedCycle.total ?? 0,
								tone: "tan",
								pattern: "solid",
							},
							{
								label: labels.paycheckBeforeReserve,
								amount: Math.max(0, remainder),
								tone: "sage",
								pattern: "solid",
							},
						]}
						ariaLabel={`${labels.nextPaycheck} ${exactMoney(paycheck.paycheck)}, ${labels.fixedBills} ${exactMoney(paycheck.fixed)}, ${labels.closedCards} ${budgetMoney(heroes.closedCycle.total)}, ${labels.paycheckBeforeReserve} ${exactMoney(remainder)}`}
					/>
				)}
				<dl className="m-0 grid grid-cols-3 gap-x-2 gap-y-4 @max-[320px]:grid-cols-2">
					<div>
						<dt className="mb-2 text-xs text-muted">{labels.fixedBills}</dt>
						<dd className={householdValueStyles()}>
							{exactMoney(paycheck.fixed)}
						</dd>
					</div>
					<div>
						<dt className="mb-2 text-xs text-muted">{labels.closedCards}</dt>
						<dd className={householdValueStyles()}>
							{budgetMoney(heroes.closedCycle.total)}
						</dd>
					</div>
					<div className="text-end @max-[320px]:col-span-full @max-[320px]:text-start">
						<dt className="mb-2 text-xs text-muted">
							{labels.paycheckBeforeReserve}
						</dt>
						<dd
							className={householdValueStyles({
								tone:
									remainder === null
										? "normal"
										: remainder < 0
											? "negative"
											: "positive",
							})}
						>
							{budgetMoney(remainder)}
						</dd>
					</div>
				</dl>
				<dl className="mt-1 mb-0 grid grid-cols-2 items-end gap-x-2 gap-y-4 border-t border-line pt-5">
					<div>
						<dt className="mb-2 text-xs text-muted">{labels.reserve}</dt>
						<dd className={householdValueStyles()}>
							{exactMoney(paycheck.reserve)}
						</dd>
					</div>
					<div className="text-end">
						<dt className="mb-2 text-xs text-muted">{labels.unallocated}</dt>
						<dd
							className={householdValueStyles({
								size: "hero",
								tone:
									unallocated === null
										? "normal"
										: unallocated < 0
											? "negative"
											: "positive",
							})}
						>
							{budgetMoney(unallocated)}
						</dd>
					</div>
				</dl>
				<p className="text-sm leading-relaxed text-muted">
					{formulas.unallocated}
				</p>
			</div>
			<div className={householdPanelStyles()}>
				<p className="flex items-start justify-start gap-2 text-xs leading-normal text-muted">
					<CheckCircle2
						size={17}
						className="text-success-text"
						aria-hidden="true"
					/>
					<span>{labels.closedCardBalances}</span>
				</p>
				<span className="text-xs text-muted">
					{heroes.closedCycle.total === null
						? "Saved balance unavailable"
						: heroes.closedCycle.cards.every(
									(card) => card.observedOn === heroes.closedCycle.end,
							  )
							? "Saved balances at close"
							: "Latest saved balances before close"}
				</span>
				{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes native list semantics for list-style:none grids. */}
				<ul
					className="m-0 grid list-none gap-2 p-0 text-xs"
					role="list"
					aria-label={labels.closedCardBalances}
				>
					{heroes.closedCycle.cards.map((card) => (
						<li
							key={card.id}
							className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2"
						>
							<span>
								{card.name}
								<small className="mt-1 block text-xs text-muted">
									{card.observedOn
										? `Saved ${monthDay(card.observedOn)}`
										: "No saved balance"}
								</small>
							</span>
							<strong className="tabular-nums">
								{budgetMoney(card.amount)}
							</strong>
						</li>
					))}
				</ul>
				{/* oxlint-enable jsx-a11y/no-redundant-roles */}
			</div>
		</section>
	);
}
