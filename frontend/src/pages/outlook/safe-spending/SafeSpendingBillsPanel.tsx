import {
	Clock3,
	CreditCard,
	Landmark,
	ShieldCheck,
	ShoppingBag,
	Wallet,
} from "lucide-react";
import { lazy, Suspense, useMemo } from "react";
import { Skeleton } from "../../../components/Skeleton.tsx";
import { useTransactionSelection } from "../../../components/activity/useTransactionSelection.ts";
import { TransactionSortButton } from "../../../components/activity/TransactionSortButton.tsx";
import { TransactionDetail } from "../../../components/activity/TransactionDetail.tsx";
import {
	type BarSegment,
	SegmentedBar,
} from "../../../components/SegmentedBar.tsx";
import { exactMoney, money, monthDay } from "../../../domain/format.ts";
import type { Account, Transaction } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import {
	TransactionSectionView,
	SafeSpendingSectionHeader,
} from "./TransactionSectionView.tsx";
import type {
	CashNowDecomposition,
	CycleAllocation,
	SafeSpendingHeroes,
	SafeSpendingMandatorySection,
	StatementFunding,
} from "./safeSpendingDetailModel.ts";
import { bundleDatesText } from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
const SafeSpendingTrendChart = lazy(() =>
	import("./SafeSpendingTrendChart.tsx").then((module) => ({
		default: module.SafeSpendingTrendChart,
	})),
);
import type { SafeSpendingTrend } from "../../../domain/safeSpendingTrend.ts";
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
	allocation,
	trend,
	section,
	funding,
	accounts,
	transactions,
	readOnly,
	transactionOrder,
	onTransactionOrderChange,
	showHeaders = false,
	closed = false,
}: {
	heroes: SafeSpendingHeroes;
	cashNow: CashNowDecomposition;
	allocation: CycleAllocation;
	trend?: SafeSpendingTrend;
	section: SafeSpendingMandatorySection;
	/** The payday bundle that settles this statement. */
	funding: StatementFunding;
	accounts: Account[];
	/** Saved rules, for the detail view's rule lookups and edit controls. */
	transactions: Transaction[];
	readOnly: boolean;
	transactionOrder: TransactionOrder;
	onTransactionOrderChange: (order: TransactionOrder) => void;
	showHeaders?: boolean;
	/** The statement already closed; the payday and pace are historical. */
	closed?: boolean;
}) {
	const savedById = useMemo(
		() => new Map(transactions.map((saved) => [saved.id, saved])),
		[transactions],
	);
	const { selected, inspect, close } = useTransactionSelection(
		section.transactions,
		savedById,
	);
	const dayUnit = heroes.fullDaysLeft === 1 ? "day" : "days";
	const cardLabel = closed ? labels.closedCardBalances : labels.cardSpending;
	const amountText = (value: number | null) =>
		value === null ? "—" : money(value);
	const reserveUsed = Math.max(0, allocation.reserve - cashNow.cushion);
	const dailyFoot = !allocation.available
		? undefined
		: closed
			? allocation.allowance >= 0
				? `${money(heroes.dailySafe)} a day across the cycle`
				: `${money(-heroes.dailySafe)} a day over the cycle`
			: allocation.allowance >= 0
				? `${money(heroes.dailySafe)} a day · ${heroes.fullDaysLeft} full ${dayUnit} left`
				: `${money(-heroes.dailySafe)} a day over · ${heroes.fullDaysLeft} full ${dayUnit} left`;
	// The funding payday for this statement lands after it closes, so the
	// foot names it as the settler — never as cash that is already here.
	const fundingDates = bundleDatesText(funding);
	const fundingFoot =
		fundingDates === null
			? "No projected paycheck"
			: funding.endDate !== null && funding.endDate !== funding.date
				? `The ${fundingDates} paychecks ${closed ? "paid" : "pay"} this statement`
				: `The ${fundingDates} paycheck ${closed ? "paid" : "pays"} this statement`;
	return (
		<div className="grid content-start gap-4">
			<div className="grid grid-cols-2 gap-3">
				<HouseholdMetricCard
					label={labels.cashAfterBills}
					icon={<Landmark size={16} aria-hidden="true" />}
					value={money(cashNow.cushion)}
					foot={fundingFoot}
				/>
				<HouseholdMetricCard
					label={labels.allowance}
					icon={<CreditCard size={16} aria-hidden="true" />}
					value={amountText(allocation.available ? allocation.allowance : null)}
					tone={
						allocation.available && allocation.allowance < 0
							? "normal"
							: "positive"
					}
					foot={dailyFoot}
				/>
			</div>
			<section className={householdPanelStyles()}>
				<div className="flex items-center justify-between">
					<div className="min-w-0">
						<div className="text-xs text-muted">{cardLabel}</div>
						<div className={householdValueStyles({ size: "metric" })}>
							{amountText(heroes.committedTotal)}
						</div>
					</div>
					<div className="min-w-0 text-right">
						<div className="text-xs text-muted">{labels.reserve}</div>
						<div className="text-xl font-bold tracking-tight text-ink tabular-nums">
							{money(allocation.reserve)}
						</div>
						{reserveUsed > 0 && (
							<div className="text-xs text-warning-text">
								{money(reserveUsed)} used
							</div>
						)}
					</div>
				</div>
				{allocation.available ? (
					<SegmentedBar
						showDetails={false}
						caption={`${cardLabel} ${amountText(heroes.committedTotal)} · ${labels.allowance} ${money(allocation.allowance)} · ${labels.reserve} ${money(allocation.reserve)}`}
						segments={[
							{
								label: cardLabel,
								amount: heroes.committedTotal ?? 0,
								pattern: "solid",
								tone: "tan",
							} as BarSegment,
							...(allocation.allowance > 0
								? [
										{
											label: labels.allowance,
											amount: allocation.allowance,
											pattern: "solid",
											tone: "plum",
										} as BarSegment,
									]
								: []),
							{
								label: labels.reserve,
								amount: allocation.reserve,
								pattern: "dots",
								tone: "blue",
							} as BarSegment,
						]}
						ariaLabel={`${cardLabel} ${amountText(heroes.committedTotal)}, ${labels.allowance} ${money(allocation.allowance)}, ${labels.reserve} ${money(allocation.reserve)}`}
					/>
				) : (
					<p className="m-0 text-xs text-muted">
						Closed card balance unavailable
					</p>
				)}
				<div className="h-px w-full bg-line" />
				{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes native list semantics for list-style:none grids. */}
				<ul
					role="list"
					aria-label={cardLabel}
					className="m-0 flex list-none items-center justify-between gap-2 p-0"
				>
					{heroes.committedByCard.map((card, index) => {
						const Icon =
							index === 0 ? CreditCard : index === 1 ? ShoppingBag : Wallet;
						return (
							<li key={card.id} className="flex min-w-0 items-center gap-2">
								<Icon size={20} aria-hidden="true" />
								<div className="flex flex-col gap-1">
									<span className="text-xs text-muted">{card.name}</span>
									<strong className="text-sm text-ink">
										{amountText(card.amount)}
									</strong>
								</div>
							</li>
						);
					})}
				</ul>
				{trend && (
					<div className="border-t border-line pt-3">
						<Suspense
							fallback={
								<div aria-busy="true">
									<Skeleton className="h-40 w-full" />
								</div>
							}
						>
							<SafeSpendingTrendChart trend={trend} historical={closed} />
						</Suspense>
					</div>
				)}
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
				{cashNow.provisional && (
					<p className="m-0 text-xs text-muted">Latest balance, not at close</p>
				)}
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
					savedTransactions={savedById}
					onInspect={inspect}
					order={transactionOrder}
					showHeaders={showHeaders}
					shortfall
					shortfallLabel="Unfulfilled"
				/>
			</section>
			{selected && (
				<TransactionDetail
					transaction={selected.transaction}
					savedTransaction={selected.savedTransaction}
					accounts={accounts}
					transactions={transactions}
					readOnly={readOnly}
					claimScheduleName={
						selected.savedTransaction.claimScheduleId
							? (transactions.find(
									(item) =>
										item.id === selected.savedTransaction.claimScheduleId,
								)?.name ?? null)
							: null
					}
					onClose={close}
				/>
			)}
		</div>
	);
}
