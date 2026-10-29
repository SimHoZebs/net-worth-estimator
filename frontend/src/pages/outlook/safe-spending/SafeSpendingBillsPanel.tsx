import {
	Clock3,
	CreditCard,
	Landmark,
	ShieldCheck,
	ShoppingBag,
	Wallet,
} from "lucide-react";
import { useMemo } from "react";
import { useTransactionSelection } from "../../../components/activity/useTransactionSelection.ts";
import { TransactionSortButton } from "../../../components/activity/TransactionSortButton.tsx";
import { TransactionDetail } from "../../../components/activity/TransactionDetail.tsx";
import {
	type BarSegment,
	SegmentedBar,
} from "../../../components/SegmentedBar.tsx";
import { exactMoney, money, monthDay } from "../../../domain/format.ts";
import { paycheckBeforeReserve } from "../../../domain/safeSpending.ts";
import type { Plan } from "../../../domain/model.ts";
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
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
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
			<div className="flex items-center gap-2 text-xs text-muted">
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
	const planTransactions = useMemo(
		() =>
			new Map(
				plan.transactions.map((planTransaction) => [
					planTransaction.id,
					planTransaction,
				]),
			),
		[plan.transactions],
	);
	const { selected, inspect, close } = useTransactionSelection(
		section.transactions,
		planTransactions,
	);
	const incoming = paycheckBeforeReserve({
		paycheck: paycheck.paycheck,
		fixedObligations: paycheck.fixed,
		closedTotal: heroes.closedCycle.total,
	});
	const dayUnit = heroes.fullDaysLeft === 1 ? "day" : "days";
	const dailyFoot =
		paycheck.allowance >= 0
			? `${money(heroes.dailySafe)} a day · ${heroes.fullDaysLeft} full ${dayUnit} left`
			: `${money(-heroes.dailySafe)} a day over · ${heroes.fullDaysLeft} full ${dayUnit} left`;
	// The next paycheck arrives inside this statement cycle, so name its
	// date here. This cycle funds spending from it; Last cycle shows the
	// full allocation against the closed balance. Mirror the Last-cycle
	// date range when several income sources span many days.
	const incomingDate =
		heroes.paycheckDate === null
			? ""
			: heroes.paycheckEndDate !== null &&
				  heroes.paycheckEndDate !== heroes.paycheckDate
				? ` · ${monthDay(heroes.paycheckDate)} – ${monthDay(heroes.paycheckEndDate)}`
				: ` · ${monthDay(heroes.paycheckDate)}`;
	return (
		<div className="grid content-start gap-4">
			<div className="grid grid-cols-2 gap-3">
				<HouseholdMetricCard
					label={labels.cashAfterBills}
					icon={<Landmark size={16} aria-hidden="true" />}
					value={money(cashNow.cushion)}
					foot={
						incoming === null
							? paycheck.paycheck
								? `${exactMoney(paycheck.paycheck)} incoming${incomingDate}`
								: "No incoming paycheck"
							: `${exactMoney(incoming)} incoming before reserve${incomingDate}`
					}
				/>
				<HouseholdMetricCard
					label={labels.allowance}
					icon={<CreditCard size={16} aria-hidden="true" />}
					value={money(paycheck.allowance)}
					tone={paycheck.allowance < 0 ? "normal" : "positive"}
					foot={dailyFoot}
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
						<Clock3 size={16} aria-hidden="true" /> {labels.remainingBills} ·{" "}
						through {monthDay(cashNow.monthEnd)}
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
					planTransactions={planTransactions}
					onInspect={inspect}
					order={transactionOrder}
					showHeaders={showHeaders}
				/>
			</section>
			{selected && (
				<TransactionDetail
					transaction={selected.transaction}
					planTransaction={selected.planTransaction}
					accounts={plan.accounts}
					plan={plan}
					claimRuleName={
						selected.planTransaction.claimRuleId
							? (plan.transactions.find(
									(item) => item.id === selected.planTransaction.claimRuleId,
								)?.name ?? null)
							: null
					}
					onClose={close}
				/>
			)}
		</div>
	);
}
