import {
	AlertCircle,
	CheckCircle2,
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
import type { MandatorySpendingGroup } from "../../../domain/safeSpending.ts";
import type { Movement, Plan } from "../../../domain/model.ts";
import type { TransactionOrder } from "../../../domain/transactionSort.ts";
import {
	TransactionSectionView,
	SafeSpendingSectionHeader,
} from "./TransactionSectionView.tsx";
import type {
	CashNowDecomposition,
	MandatoryFrame,
	PaycheckDecomposition,
	SafeSpendingHeroes,
	SafeSpendingMandatorySection,
} from "./safeSpendingDetailModel.ts";

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

type HouseholdBillStatus = "posted" | "pending" | "assumed-funded" | "unpaid";

function HouseholdBillChip({
	name,
	amount,
	status,
	note,
}: {
	name: string;
	amount: number;
	status: HouseholdBillStatus;
	note?: string;
}) {
	return (
		<div className="household-bill-chip" title={note ?? `${name}: ${status}`}>
			<span className={`household-bill-status ${status}`} aria-label={status}>
				{status === "posted" ? (
					<CheckCircle2 size={19} />
				) : status === "unpaid" ? (
					<Clock3 size={19} />
				) : status === "pending" ? (
					<Clock3 size={19} />
				) : (
					<AlertCircle size={19} />
				)}
			</span>
			<span className="household-tiny household-muted household-bill-name">
				{name}
			</span>
			<strong>{money(amount)}</strong>
		</div>
	);
}

function billStatusForGroup({
	group,
	transactions,
}: {
	group: MandatorySpendingGroup;
	transactions: AccountTransaction[];
}): { status: HouseholdBillStatus; note?: string } {
	const rows = transactions.filter(
		(transaction) => transaction.movementId === group.movementId,
	);
	if (rows.some((row) => row.pending))
		return { status: "pending", note: `${group.name}: pending` };
	if (rows.some((row) => row.shortfall > 0.01))
		return { status: "unpaid", note: `${group.name}: unpaid` };
	if (rows.length > 0 && rows.every((row) => row.category === "transfer"))
		return {
			status: "assumed-funded",
			note: `${group.name}: assumed funded via household transfer`,
		};
	return { status: "posted", note: `${group.name}: posted` };
}

export function SafeSpendingBillsPanel({
	heroes,
	cashNow,
	paycheck,
	section,
	frame,
	onFrameChange,
	plan,
	transactionOrder,
	onTransactionOrderChange,
	showHeaders = false,
}: {
	heroes: SafeSpendingHeroes;
	cashNow: CashNowDecomposition;
	paycheck: PaycheckDecomposition;
	section: SafeSpendingMandatorySection;
	frame: MandatoryFrame;
	onFrameChange: (frame: MandatoryFrame) => void;
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
					label="Cash cushion"
					icon={<Landmark size={16} aria-hidden="true" />}
					value={money(cashNow.cushion)}
					foot={
						heroes.checkingObservedOn
							? "Verified balance"
							: "Estimated · balance age unknown"
					}
				/>
				<HouseholdMetricCard
					label="Conservative room"
					icon={<CreditCard size={16} aria-hidden="true" />}
					value={money(paycheck.allowance)}
					tone={paycheck.allowance < 0 ? "normal" : "positive"}
					foot={`Through ${monthDay(heroes.cycleEnd)}`}
				/>
			</div>
			<HouseholdPanel>
				<div className="household-panel-heading">
					<strong>Card cycle</strong>
					<span className="household-muted household-tiny">
						{monthDay(heroes.cycleStart)} – {monthDay(heroes.cycleEnd)}
					</span>
				</div>
				<div className="household-two-col">
					<div>
						<div className="household-muted household-tiny">Committed</div>
						<div className="household-big-number">
							{money(heroes.committedTotal)}
						</div>
					</div>
					<div className="household-align-right">
						<div className="household-muted household-tiny">
							Theoretical room
						</div>
						<div className="household-medium-number">
							{money(heroes.theoretical)}
						</div>
					</div>
				</div>
				<SegmentedBar
					caption={`Card cycle ${money(heroes.committedTotal)} committed · ${money(Math.max(0, paycheck.allowance))} safe · ${money(paycheck.reserve)} reserve`}
					segments={[
						{
							label: "Committed",
							amount: heroes.committedTotal,
							pattern: "solid",
							tone: "tan",
						} as BarSegment,
						...(paycheck.allowance > 0
							? [
									{
										label: "Safe",
										amount: paycheck.allowance,
										pattern: "solid",
										tone: "plum",
									} as BarSegment,
								]
							: []),
						{
							label: "Reserve",
							amount: paycheck.reserve,
							pattern: "dots",
							tone: "blue",
						} as BarSegment,
					]}
					ariaLabel={`Card cycle: committed ${money(heroes.committedTotal)}, safe ${money(Math.max(0, paycheck.allowance))}, reserve ${money(paycheck.reserve)}`}
				/>
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
					<strong>Cash flow</strong>
					<ShieldCheck
						size={19}
						className="household-positive"
						aria-hidden="true"
					/>
				</div>
				<div className="household-amount-line">
					<span className="household-muted">Checking snapshot</span>
					<strong>{exactMoney(cashNow.checking)}</strong>
				</div>
				<SegmentedBar
					caption={`${exactMoney(cashNow.checking)} checking · ${exactMoney(Math.max(0, cashNow.bills))} unpaid bills · ${exactMoney(Math.max(0, cashNow.cushion))} cushion${cashNow.spentSinceStart > 0 ? ` · ${exactMoney(cashNow.spentSinceStart)} paid since ${monthDay(cashNow.since)}` : ""}`}
					segments={[
						{
							label: "Unpaid bills",
							amount: Math.min(cashNow.checking, Math.max(0, cashNow.bills)),
							pattern: "stripes",
							tone: "sage",
						} as BarSegment,
						...(cashNow.cushion > 0
							? [
									{
										label: "Cushion",
										amount: cashNow.cushion,
										pattern: "solid",
										tone: "plum",
									} as BarSegment,
								]
							: []),
					]}
					ariaLabel={`Checking ${exactMoney(cashNow.checking)}: unpaid bills ${exactMoney(Math.max(0, cashNow.bills))}, cushion ${exactMoney(Math.max(0, cashNow.cushion))}`}
				/>
				<div className="household-amount-line">
					<span>
						<Clock3 size={16} aria-hidden="true" /> Unpaid cash bills
					</span>
					<strong>−{exactMoney(cashNow.bills)}</strong>
				</div>
				{cashNow.spentSinceStart > 0 ? (
					<div className="household-amount-line">
						<span className="household-muted">
							Paid since {monthDay(cashNow.since)}
						</span>
						<strong>{exactMoney(cashNow.spentSinceStart)}</strong>
					</div>
				) : null}
				<div className="household-divider" />
				{section.groups.length ? (
					<div className="household-bill-grid">
						{section.groups.map((group) => {
							const { status, note } = billStatusForGroup({
								group,
								transactions: section.transactions,
							});
							return (
								<HouseholdBillChip
									key={group.movementId}
									name={group.name}
									amount={group.total}
									status={status}
									note={note}
								/>
							);
						})}
					</div>
				) : (
					<p className="household-muted household-tiny">
						No bills due in this period.
					</p>
				)}
				<div className="household-safe-spending-controls">
					<div className="segmented" role="toolbar" aria-label="Bills window">
						{(
							[
								{ id: "calendar", label: "Calendar month" },
								{ id: "cycle", label: "Card cycle" },
							] as const
						).map((option) => (
							<button
								type="button"
								key={option.id}
								aria-pressed={frame === option.id}
								onClick={() => onFrameChange(option.id)}
							>
								{option.label}
							</button>
						))}
					</div>
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
					<strong>Next paycheck</strong>
					<span className="household-medium-number">
						{money(paycheck.paycheck)}
					</span>
				</div>
				<div className="household-two-col household-paycheck-cols">
					<div>
						<div className="household-muted household-tiny">Fixed bills</div>
						<div className="household-medium-number">
							{money(paycheck.fixed)}
						</div>
					</div>
					<div className="household-align-right">
						<div className="household-muted household-tiny">Card spending</div>
						<div className="household-medium-number">
							{money(heroes.committedTotal)}
						</div>
					</div>
				</div>
				<div className="household-divider" />
				<div className="household-amount-line">
					<span className="household-muted">Protected reserve</span>
					<strong>{money(paycheck.reserve)}</strong>
				</div>
				<div className="household-amount-line">
					<span className="household-muted">Safe remainder</span>
					<strong
						className={
							paycheck.allowance < 0
								? "household-negative"
								: "household-positive"
						}
					>
						{money(paycheck.allowance)}
					</strong>
				</div>
				<div className="household-divider" />
				<div className="household-amount-line">
					<span className="household-muted">
						Daily · {heroes.fullDaysLeft} full{" "}
						{heroes.fullDaysLeft === 1 ? "day" : "days"}
					</span>
					<strong>
						{heroes.fullDaysLeft > 0
							? money(Math.max(0, heroes.dailySafe))
							: "N/A"}{" "}
						<span className="household-muted household-tiny">safe</span>
					</strong>
				</div>
				<div className="household-amount-line">
					<span className="household-muted">Daily theoretical</span>
					<strong>
						{heroes.fullDaysLeft > 0
							? money(Math.max(0, heroes.dailyTheoretical))
							: "N/A"}
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
