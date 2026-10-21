import { CalendarDays, CheckCircle2 } from "lucide-react";
import { SegmentedBar } from "../../../components/SegmentedBar.tsx";
import { exactMoney, monthDay } from "../../../domain/format.ts";
import { cycleAllowance } from "../../../domain/safeSpending.ts";
import type {
	PaycheckDecomposition,
	SafeSpendingHeroes,
} from "./safeSpendingDetailModel.ts";
import "./household-budget.css";
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
			className="household-budget"
			aria-label={labels.paycheckAllocation}
		>
			<div className="household-panel household-budget-paycheck">
				<div className="household-budget-paycheck-label">
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
				<strong className="household-budget-paycheck-value type-value">
					{exactMoney(paycheck.paycheck)}
				</strong>
				{!heroes.paycheckDate && (
					<p className="household-muted household-tiny">Date not available</p>
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
				<dl className="household-budget-allocation">
					<div>
						<dt>{labels.fixedBills}</dt>
						<dd>{exactMoney(paycheck.fixed)}</dd>
					</div>
					<div>
						<dt>{labels.closedCards}</dt>
						<dd>{budgetMoney(heroes.closedCycle.total)}</dd>
					</div>
					<div>
						<dt>{labels.paycheckBeforeReserve}</dt>
						<dd
							className={
								remainder === null
									? ""
									: remainder < 0
										? "household-negative"
										: "household-positive"
							}
						>
							{budgetMoney(remainder)}
						</dd>
					</div>
				</dl>
				<dl className="household-budget-reserve">
					<div>
						<dt>{labels.reserve}</dt>
						<dd>{exactMoney(paycheck.reserve)}</dd>
					</div>
					<div>
						<dt>{labels.unallocated}</dt>
						<dd
							className={`type-value ${unallocated === null ? "" : unallocated < 0 ? "household-negative" : "household-positive"}`}
						>
							{budgetMoney(unallocated)}
						</dd>
					</div>
				</dl>
				<p className="section-note">{formulas.unallocated}</p>
			</div>
			<div className="household-panel">
				<p className="household-budget-cycle-label">
					<CheckCircle2
						size={17}
						className="household-positive"
						aria-hidden="true"
					/>
					<span>{labels.closedCardBalances}</span>
				</p>
				<span className="household-muted household-tiny">
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
					className="household-budget-closed-cards"
					role="list"
					aria-label={labels.closedCardBalances}
				>
					{heroes.closedCycle.cards.map((card) => (
						<li key={card.id}>
							<span>
								{card.name}
								<small>
									{card.observedOn
										? `Saved ${monthDay(card.observedOn)}`
										: "No saved balance"}
								</small>
							</span>
							<strong>{budgetMoney(card.amount)}</strong>
						</li>
					))}
				</ul>
				{/* oxlint-enable jsx-a11y/no-redundant-roles */}
			</div>
		</section>
	);
}
