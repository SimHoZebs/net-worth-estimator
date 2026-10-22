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
import {
	householdPanelStyles,
	householdValueStyles,
	type HouseholdValueStyleProps,
} from "./householdStyles.ts";

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
	tone?: HouseholdValueStyleProps["tone"];
}) {
	return (
		<section
			aria-label={label}
			className={householdPanelStyles({
				density: "compact",
				className: "min-h-28",
			})}
		>
			<div className="flex items-center gap-1.5 text-xs text-muted">
				{icon}
				{label}
			</div>
			<div
				data-testid="metric-value"
				className={householdValueStyles({ size: "metric", tone })}
			>
				{value}
			</div>
			{foot && <div className="text-xs text-muted">{foot}</div>}
		</section>
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
		<div className="grid content-start gap-4">
			<div className="grid grid-cols-2 gap-2.5">
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
			<section className={householdPanelStyles()}>
				<div className="flex items-center justify-between">
					<div className="min-w-0">
						<div className="text-xs text-muted">{labels.cardSpending}</div>
						<div className={householdValueStyles({ size: "metric" })}>
							{money(heroes.committedTotal)}
						</div>
					</div>
					<div className="min-w-0 text-right">
						<div className="text-xs text-muted">{labels.reserve}</div>
						<div className="text-xl font-bold tracking-tight text-ink tabular-nums">
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
				<p className="text-sm leading-relaxed text-muted">
					{formulas.allowance}
				</p>
				<div className="h-px w-full bg-line" />
				<div className="flex items-center justify-between">
					{heroes.committedByCard.map((card, index) => {
						const Icon =
							index === 0 ? CreditCard : index === 1 ? ShoppingBag : Wallet;
						return (
							<div key={card.id} className="flex min-w-0 items-center gap-2">
								<Icon size={20} aria-hidden="true" />
								<div className="flex flex-col gap-1">
									<span className="text-xs text-muted">{card.name}</span>
									<strong className="text-sm text-ink">
										{money(card.amount)}
									</strong>
								</div>
							</div>
						);
					})}
				</div>
			</section>
			<section className={householdPanelStyles()}>
				<div className="flex items-center justify-between">
					<strong className="text-sm text-ink">{labels.cashAccounts}</strong>
					<ShieldCheck
						size={19}
						className="text-success-text"
						aria-hidden="true"
					/>
				</div>
				<div className="flex items-center justify-between gap-3 text-sm text-ink">
					<span className="flex items-center gap-2 text-muted">
						{labels.cashBalance}
					</span>
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
				<div className="flex items-center justify-between gap-3 text-sm text-ink">
					<span className="flex items-center gap-2">
						<Clock3 size={16} aria-hidden="true" /> {labels.remainingBills}
					</span>
					<strong>−{exactMoney(cashNow.bills)}</strong>
				</div>
				{cashNow.spentSinceStart > 0 ? (
					<div className="flex items-center justify-between gap-3 text-sm text-ink">
						<span className="flex items-center gap-2 text-muted">
							{labels.cashPayments} · {monthDay(cashNow.since)}
						</span>
						<strong>{exactMoney(cashNow.spentSinceStart)}</strong>
					</div>
				) : null}
				<p className="text-sm leading-relaxed text-muted">
					{formulas.cashAfterBills}
				</p>
				<div className="h-px w-full bg-line" />
				<div className="flex flex-wrap items-center justify-end gap-3">
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
			</section>
			<section className={householdPanelStyles()}>
				<div className="flex items-center justify-between">
					<strong className="text-sm text-ink">{labels.dailyAllowance}</strong>
				</div>
				<div className="flex items-center justify-between gap-3 text-sm text-ink">
					<span className="flex items-center gap-2 text-muted">
						{heroes.fullDaysLeft} full{" "}
						{heroes.fullDaysLeft === 1 ? "day" : "days"} left
					</span>
					<strong>
						{heroes.fullDaysLeft > 0 ? money(heroes.dailySafe) : "N/A"}{" "}
						<span className="text-xs text-muted">per day</span>
					</strong>
				</div>
			</section>
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
