import {
	Clock3,
	CreditCard,
	Landmark,
	ShieldCheck,
	ShoppingBag,
	Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { TransactionSortButton } from "../../../components/activity/TransactionSortButton.tsx";
import { TransactionDetail } from "../../../components/activity/TransactionDetail.tsx";
import {
	type BarSegment,
	SegmentedBar,
} from "../../../components/SegmentedBar.tsx";
import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import { exactMoney, money, monthDay } from "../../../domain/format.ts";
import type { Movement, Plan } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import {
	TransactionSectionView,
	SafeSpendingSectionHeader,
} from "./TransactionSectionView.tsx";
import type {
	CashNowDecomposition,
	PaycheckDecomposition,
	SafeSpendingHeroes,
	SafeSpendingMandatorySection,
} from "./safeSpendingDetailModel.ts";
import {
	SAFE_SPENDING_LABELS as labels,
	SAFE_SPENDING_FORMULAS as formulas,
} from "./safeSpendingLabels.ts";

function HouseholdPanel({
	children,
	className = "",
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section className={`household-panel ${className}`}>{children}</section>
	);
}

function HouseholdMetricCard({
	label,
	value,
	icon,
	foot,
	tone = "normal",
}: {
	label: string;
	value: string;
	icon: React.ReactNode;
	foot?: string;
	tone?: "normal" | "positive" | "negative";
}) {
	return (
		<HouseholdPanel className="household-metric-card">
			<div className="household-muted household-tiny household-metric-label">
				{icon}
				{label}
			</div>
			<div
				className={`household-metric-value ${tone === "positive" ? "household-positive" : tone === "negative" ? "household-negative" : ""}`}
			>
				{value}
			</div>
			{foot && <div className="household-muted household-tiny">{foot}</div>}
		</HouseholdPanel>
	);
}

export function SafeSpendingBillsPanel({
	heroes,
	cashNow,
	paycheck,
	section,
	plan,
	transactionOrder,
	onTransactionOrderChange,
	showHeaders = false,
}: {
	heroes: SafeSpendingHeroes;
	cashNow: CashNowDecomposition;
	paycheck: PaycheckDecomposition;
	section: SafeSpendingMandatorySection;
	plan: Plan;
	transactionOrder: TransactionOrder;
	onTransactionOrderChange: (order: TransactionOrder) => void;
	showHeaders?: boolean;
}) {
	const movements = useMemo(
		() => new Map(plan.movements.map((movement) => [movement.id, movement])),
		[plan.movements],
	);
	const [selected, setSelected] = useState<{
		transaction: AccountTransaction;
		movement: Movement;
	} | null>(null);
	const inspect = (transaction: AccountTransaction, movement: Movement) =>
		setSelected({ transaction, movement });
	return (
		<div className="safe-spending-mandatory">
			<div className="household-metric-grid">
				<HouseholdMetricCard
					label={labels.cashAfterBills}
					icon={<Landmark size={16} aria-hidden="true" />}
					value={money(cashNow.cushion)}
					foot="After cash payments and bills before month-end"
				/>
				<HouseholdMetricCard
					label={labels.allowance}
					icon={<CreditCard size={16} aria-hidden="true" />}
					value={money(paycheck.allowance)}
					tone={paycheck.allowance < 0 ? "normal" : "positive"}
					foot="After protected reserve"
				/>
			</div>
			<HouseholdPanel>
				<div className="household-two-col">
					<div>
						<div className="household-muted household-tiny">
							{labels.cardSpending}
						</div>
						<div className="household-big-number">
							{money(heroes.committedTotal)}
						</div>
					</div>
					<div className="household-align-right">
						<div className="household-muted household-tiny">
							{labels.reserve}
						</div>
						<div className="household-medium-number">
							{money(paycheck.reserve)}
						</div>
					</div>
				</div>
				<SegmentedBar
					showDetails={false}
					caption={`${labels.cardSpending} ${money(heroes.committedTotal)} · ${labels.allowance} ${money(paycheck.allowance)} · ${labels.reserve} ${money(paycheck.reserve)}`}
					segments={[
						{
							label: labels.cardSpending,
							amount: heroes.committedTotal,
							pattern: "solid",
							tone: "tan",
						} as BarSegment,
						...(paycheck.allowance > 0
							? [
									{
										label: labels.allowance,
										amount: paycheck.allowance,
										pattern: "solid",
										tone: "plum",
									} as BarSegment,
								]
							: []),
						{
							label: labels.reserve,
							amount: paycheck.reserve,
							pattern: "dots",
							tone: "blue",
						} as BarSegment,
					]}
					ariaLabel={`${labels.cardSpending} ${money(heroes.committedTotal)}, ${labels.allowance} ${money(paycheck.allowance)}, ${labels.reserve} ${money(paycheck.reserve)}`}
				/>
				<p className="section-note">{formulas.allowance}</p>
				<div className="household-divider" />
				<div className="household-two-col household-card-breakdown">
					{heroes.committedByCard.map((card, index) => {
						const Icon =
							index === 0 ? CreditCard : index === 1 ? ShoppingBag : Wallet;
						return (
							<div key={card.id}>
								<Icon size={20} aria-hidden="true" />
								<div>
									<span className="household-muted household-tiny">
										{card.name}
									</span>
									<strong>{money(card.amount)}</strong>
								</div>
							</div>
						);
					})}
				</div>
			</HouseholdPanel>
			<HouseholdPanel>
				<div className="household-panel-heading">
					<strong>{labels.cashAccounts}</strong>
					<ShieldCheck
						size={19}
						className="household-positive"
						aria-hidden="true"
					/>
				</div>
				<div className="household-amount-line">
					<span className="household-muted">{labels.cashBalance}</span>
					<strong>{exactMoney(cashNow.checking)}</strong>
				</div>
				<SegmentedBar
					showDetails={false}
					caption={`${labels.cashBalance} ${exactMoney(cashNow.checking)} · ${labels.remainingBills} ${exactMoney(cashNow.bills)} · ${labels.cashAfterBills} ${exactMoney(cashNow.cushion)}`}
					segments={[
						{
							label: labels.remainingBills,
							amount: Math.min(cashNow.checking, Math.max(0, cashNow.bills)),
							pattern: "stripes",
							tone: "sage",
						} as BarSegment,
						...(cashNow.cushion > 0
							? [
									{
										label: labels.cashAfterBills,
										amount: cashNow.cushion,
										pattern: "solid",
										tone: "plum",
									} as BarSegment,
								]
							: []),
					]}
					ariaLabel={`${labels.cashBalance} ${exactMoney(cashNow.checking)}, ${labels.remainingBills} ${exactMoney(cashNow.bills)}, ${labels.cashAfterBills} ${exactMoney(cashNow.cushion)}`}
				/>
				<div className="household-amount-line">
					<span>
						<Clock3 size={16} aria-hidden="true" /> {labels.remainingBills}
					</span>
					<strong>−{exactMoney(cashNow.bills)}</strong>
				</div>
				{cashNow.spentSinceStart > 0 ? (
					<div className="household-amount-line">
						<span className="household-muted">
							{labels.cashPayments} · {monthDay(cashNow.since)}
						</span>
						<strong>{exactMoney(cashNow.spentSinceStart)}</strong>
					</div>
				) : null}
				<p className="section-note">{formulas.cashAfterBills}</p>
				<div className="household-divider" />
				<div className="household-safe-spending-controls">
					<TransactionSortButton
						order={transactionOrder}
						onChange={onTransactionOrderChange}
					/>
				</div>
				<SafeSpendingSectionHeader
					title={section.title}
					subtitle={section.subtitle}
					total={section.total}
				/>
				<TransactionSectionView
					transactions={section.transactions}
					caption={section.title}
					emptyMessage="No bills due in this period."
					movements={movements}
					onInspect={inspect}
					order={transactionOrder}
					showHeaders={showHeaders}
				/>
			</HouseholdPanel>
			<HouseholdPanel>
				<div className="household-panel-heading">
					<strong>{labels.dailyAllowance}</strong>
				</div>
				<div className="household-amount-line">
					<span className="household-muted">
						{heroes.fullDaysLeft} full{" "}
						{heroes.fullDaysLeft === 1 ? "day" : "days"} left
					</span>
					<strong>
						{heroes.fullDaysLeft > 0 ? money(heroes.dailySafe) : "N/A"}{" "}
						<span className="household-muted household-tiny">per day</span>
					</strong>
				</div>
			</HouseholdPanel>
			{selected && (
				<TransactionDetail
					transaction={selected.transaction}
					movement={selected.movement}
					accounts={plan.accounts}
					plan={plan}
					claimRuleName={
						selected.movement.claimRuleId
							? (plan.movements.find(
									(item) => item.id === selected.movement.claimRuleId,
								)?.name ?? null)
							: null
					}
					onClose={() => setSelected(null)}
				/>
			)}
		</div>
	);
}
