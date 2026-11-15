import { lazy, Suspense, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useTransactionSelection } from "../../../components/activity/useTransactionSelection.ts";
import { TransactionSortButton } from "../../../components/activity/TransactionSortButton.tsx";
import { TransactionDetail } from "../../../components/activity/TransactionDetail.tsx";
import { money, monthDay } from "../../../domain/format.ts";
import type { Account, Transaction } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import {
	TransactionSectionView,
	SafeSpendingSectionHeader,
} from "./TransactionSectionView.tsx";
import type {
	CycleAllocation,
	SafeSpendingHeroes,
	SafeSpendingMandatorySection,
	StatementFunding,
} from "./safeSpendingDetailModel.ts";
import { bundleDatesText } from "./safeSpendingDetailModel.ts";
import { describeAllowance } from "./allowanceView.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
const SafeSpendingTrendChart = lazy(() =>
	import("./SafeSpendingTrendChart.tsx").then((module) => ({
		default: module.SafeSpendingTrendChart,
	})),
);
import { cn } from "@/lib/utils.ts";
import type { SafeSpendingTrend } from "../../../domain/safeSpendingTrend.ts";

/**
 * One compact decision row: plain label on the left, base-size value on
 * the right, with an optional meter and qualifier underneath.
 */
function StatRow({
	label,
	value,
	tone = "normal",
	testId,
	meter,
	qualifier,
}: {
	label: string;
	value: string;
	tone?: "normal" | "positive" | "negative";
	testId: string;
	meter?: React.ReactNode;
	qualifier?: string;
}) {
	return (
		<div className="grid min-w-0 gap-1">
			<div className="flex items-center justify-between gap-3">
				<span className="text-sm text-muted-foreground">{label}</span>
				<strong
					data-testid={testId}
					className={cn(
						"m-0 text-base font-bold whitespace-nowrap tabular-nums [overflow-wrap:anywhere]",
						tone === "positive"
							? "text-success-text"
							: tone === "negative"
								? "text-danger-text"
								: "text-foreground",
					)}
				>
					{value}
				</strong>
			</div>
			{meter}
			{qualifier && (
				<p className="m-0 text-xs text-muted-foreground">{qualifier}</p>
			)}
		</div>
	);
}

/**
 * Where card spending stands against the hard cap: spent fills from zero
 * and the protected reserve reads as a band at the top of the scale.
 * SegmentedBar cannot draw positional zones, so this is a tiny custom
 * bar on the same surface and warning tokens.
 */
function ReserveMeter({
	spent,
	limit,
	reserve,
	limitWord,
}: {
	spent: number;
	limit: number;
	reserve: number;
	limitWord: string;
}) {
	const scale = Math.max(limit, spent);
	const zoneStart = Math.max(0, limit - reserve);
	return (
		<div
			role="img"
			aria-label={`Spent ${money(spent)} of ${money(limit)} ${limitWord}`}
			className="relative h-1.5 overflow-hidden rounded-full bg-accent"
		>
			<span
				aria-hidden="true"
				data-pattern="dots"
				className="absolute inset-y-0 bg-warning-bg"
				style={{
					left: `${(zoneStart / scale) * 100}%`,
					width: `${((limit - zoneStart) / scale) * 100}%`,
				}}
			/>
			<span
				aria-hidden="true"
				className="absolute inset-y-0 left-0 bg-primary"
				style={{
					width: `${Math.min(100, Math.max(0, (spent / scale) * 100))}%`,
				}}
			/>
		</div>
	);
}

export function SafeSpendingBillsPanel({
	heroes,
	cashEvidence,
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
	cashEvidence: React.ReactNode;
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
	const limitWord = closed ? "budget" : "limit";
	const amountText = (value: number | null) =>
		value === null ? "—" : money(value);
	// The funding payday for this statement lands after it closes, so it
	// captions the decision rows — never the cash that is already here.
	const fundingDates = bundleDatesText(funding);
	const fundingCaption =
		fundingDates === null
			? "No projected paycheck"
			: funding.endDate !== null && funding.endDate !== funding.date
				? `The ${fundingDates} paychecks ${closed ? "paid" : "pay"} this statement`
				: `The ${fundingDates} paycheck ${closed ? "paid" : "pays"} this statement`;
	const allowanceView = describeAllowance({
		allowance: allocation.allowance,
		theoretical: heroes.theoretical,
		reserve: allocation.reserve,
		available: allocation.available,
	});
	// The hard cap the meter draws: safe headroom plus the protected
	// reserve it may draw into.
	const limit = allocation.allowance + allocation.reserve;
	const spent = heroes.committedTotal ?? 0;
	const showMeter = allocation.available && limit > 0;
	const spendLabel = `Spend till ${monthDay(heroes.cycleEnd)} closing`;
	const spendQualifier =
		allowanceView.phase === "unavailable"
			? undefined
			: allowanceView.phase === "safe"
				? undefined
				: allowanceView.phase === "into-reserve"
					? `${money(allowanceView.intoReserve)} of ${money(allocation.reserve)} reserve in use`
					: closed
						? `Over budget by ${money(allowanceView.overLimit)}`
						: `Over limit by ${money(allowanceView.overLimit)}`;
	const dailyValue =
		allowanceView.phase === "unavailable"
			? null
			: allowanceView.phase === "safe"
				? Math.max(0, heroes.dailySafe)
				: Math.max(0, heroes.dailyTheoretical);
	const dailyQualifier =
		allowanceView.phase === "unavailable" ||
		allowanceView.primary === null ||
		allowanceView.primary === 0
			? undefined
			: closed
				? `of ${money(allowanceView.primary)} across the cycle`
				: `of ${money(allowanceView.primary)}`;
	return (
		<div className="grid content-start gap-4">
			{trend && (
				<div className="grid content-start gap-4">
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
			{cashEvidence}
			<div className="grid content-start gap-4">
				{closed ? (
					<>
						<StatRow
							label={labels.recordedCharges}
							value={amountText(heroes.committedTotal)}
							testId="recorded-charges-value"
						/>
						<StatRow
							label="Closed card balance"
							value={amountText(heroes.closedCycle.total)}
							testId="closed-card-value"
						/>
						<p className="m-0 text-sm text-muted-foreground">
							Historical budget unavailable
						</p>
						<p className="m-0 text-xs text-muted-foreground">
							The historical income, bills, and reserve needed to establish this
							cycle’s budget are not available.
						</p>
					</>
				) : (
					<>
						<p className="m-0 text-xs text-muted-foreground">
							Card allowance · separate from cash
						</p>
						<div className="grid grid-cols-1 gap-3 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
							<StatRow
								label={spendLabel}
								value={amountText(allowanceView.primary)}
								tone={allowanceView.tone}
								testId="spend-value"
								meter={
									showMeter ? (
										<ReserveMeter
											spent={spent}
											limit={limit}
											reserve={allocation.reserve}
											limitWord={limitWord}
										/>
									) : undefined
								}
								qualifier={spendQualifier}
							/>
							<StatRow
								label={labels.perDay}
								value={dailyValue === null ? "—" : money(dailyValue)}
								testId="perday-value"
								qualifier={dailyQualifier}
							/>
						</div>
						<p className="m-0 text-xs text-muted-foreground">
							{fundingCaption}
						</p>
						{!allocation.available && (
							<p className="m-0 text-xs text-muted-foreground">
								Closed card balance unavailable
							</p>
						)}
					</>
				)}
			</div>
			{closed && (
				<div className="grid content-start gap-4">
					<div className="h-px w-full bg-border" />
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
						emptyMessage="No recorded bill payments in this period."
						savedTransactions={savedById}
						onInspect={inspect}
						order={transactionOrder}
						showHeaders={showHeaders}
						shortfall
						shortfallLabel="Unfulfilled"
					/>
				</div>
			)}
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
