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
import { TransactionSortButton } from "../../components/activity/TransactionSortButton.tsx";
import { TransactionDetail } from "../../components/activity/TransactionDetail.tsx";
import { TransactionRow } from "../../components/activity/TransactionRow.tsx";
import { TransactionTable } from "../../components/activity/TransactionTable.tsx";
import { AccountLabel } from "../../components/AccountIcon.tsx";
import {
	type BarSegment,
	SegmentedBar,
} from "../../components/SegmentedBar.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { Drawer } from "../../components/Drawer.tsx";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { dateLabel, exactMoney, money, monthDay } from "../../domain/format.ts";
import type { MandatorySpendingGroup } from "../../domain/householdTiming.ts";
import type { Plan } from "../../domain/model.ts";
import type { TransactionOrder } from "../../domain/transactionSort.ts";

export type TimingDetailTab = "mandatory" | "cycle" | "configure";

export type MandatoryFrame = "calendar" | "cycle";

export interface TimingMandatorySection {
	title: string;
	subtitle: string;
	total: number;
	groups: MandatorySpendingGroup[];
	transactions: AccountTransaction[];
}
export interface CashNowDecomposition {
	checking: number;
	spentSinceStart: number;
	bills: number;
	cushion: number;
	/** Projection-start date anchoring spentSinceStart, for caption context. */
	since: string;
	/** Simulated unpaid bills in the due window (fulfillment gaps). */
	short: number;
	/** First date the simulation leaves a bill unpaid, if any. */
	firstShort: string | null;
}

export interface PaycheckDecomposition {
	paycheck: number;
	fixed: number;
	reserve: number;
	spent: number;
	allowance: number;
}

function TimingSectionHeader({
	title,
	subtitle,
	total,
}: {
	title: string;
	subtitle: string;
	total: number;
}) {
	return (
		<div className="section-top">
			<div className="timing-section-title">
				<h3>{title}</h3>
				<p className="section-note">{subtitle}</p>
			</div>
			<strong className="timing-total">{money(total)}</strong>
		</div>
	);
}

type HouseholdBillStatus = "posted" | "pending" | "assumed-funded" | "unpaid";

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

function TransactionSectionView({
	transactions,
	caption,
	emptyMessage,
	movements,
	onInspect,
	order,
	showHeaders = false,
}: {
	transactions: AccountTransaction[];
	caption: string;
	emptyMessage: string;
	movements: Map<string, Plan["movements"][number]>;
	onInspect: (
		transaction: AccountTransaction,
		movement: Plan["movements"][number],
	) => void;
	order: TransactionOrder;
	showHeaders?: boolean;
}) {
	if (!transactions.length) {
		return (
			<div className="cycle-breakdown">
				<p>{emptyMessage}</p>
			</div>
		);
	}
	return (
		<TransactionTable
			caption={`${caption}, ${order === "oldest" ? "oldest first" : "newest first"}`}
			showHeaders={showHeaders}
		>
			{transactions.map((transaction) => (
				<TransactionRow
					key={transaction.id}
					transaction={transaction}
					movement={movements.get(transaction.movementId) ?? null}
					onEdit={(movement) => onInspect(transaction, movement)}
				/>
			))}
		</TransactionTable>
	);
}

export interface TimingHeroes {
	cushion: number;
	cushionProvisional: boolean;
	checkingAmount: number;
	checkingObservedOn: string | null;
	safe: number;
	theoretical: number;
	dailySafe: number;
	dailyTheoretical: number;
	fullDaysLeft: number;
	cycleStart: string;
	cycleEnd: string;
	committedTotal: number;
	committedByCard: { id: string; name: string; amount: number }[];
	paycheckAmount: number;
	fixedAmount: number;
	reserveAmount: number;
}

export interface TimingConfigHints {
	statementDay: number;
	reserve: number;
	spentOverride: number | null;
	paycheckOverride: number | null;
	fixedOverride: number | null;
	checkingOverride: number | null;
	remainingOverride: number | null;
	paycheckHint: { date: string; amount: number } | null;
	fixedHint: { total: number; start: string; end: string };
	checkingHint: number | null;
	remainingHint: { total: number; monthEnd: string };
	spentHint: number;
	cards: { id: string; name: string }[];
	trackedIds: string[];
	spendingAccounts: { id: string; name: string }[];
	trackedSpendingIds: string[];
}

function AccountToggle({
	account,
	checked,
	onToggle,
}: {
	account: Pick<Plan["accounts"][number], "id" | "kind" | "color" | "name">;
	checked: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			className="account-toggle table-name"
			aria-pressed={checked}
			onClick={onToggle}
		>
			<AccountLabel account={account} />
		</button>
	);
}

export function TimingDetailDialog({
	heroes,
	cashNow,
	paycheck,
	frame,
	onFrameChange,
	thisMonth,
	plan,
	cycleTransactions,
	config,
	billCandidates,
	trackedBillIds,
	onToggleBill,
	onToggleAccount,
	onToggleSpendingAccount,
	onUpdateConfig,
	onResetConfig,
	tab,
	onTabChange,
	transactionOrder,
	onTransactionOrderChange,
	showHeaders = false,
	onClose,
}: {
	heroes: TimingHeroes;
	cashNow: CashNowDecomposition;
	paycheck: PaycheckDecomposition;
	frame: MandatoryFrame;
	onFrameChange: (frame: MandatoryFrame) => void;
	thisMonth: TimingMandatorySection;
	plan: Plan;
	cycleTransactions: AccountTransaction[];
	config: TimingConfigHints;
	billCandidates: {
		id: string;
		name: string;
		amount: number;
		frequency: string;
	}[];
	trackedBillIds: string[];
	onToggleBill: (movementId: string) => void;
	onToggleAccount: (accountId: string) => void;
	onToggleSpendingAccount: (accountId: string) => void;
	onUpdateConfig: (next: {
		statementDay?: number;
		statementDaySet?: boolean;
		reserve?: number;
		spentOverride?: number | null;
		paycheckOverride?: number | null;
		fixedOverride?: number | null;
		checkingOverride?: number | null;
		remainingOverride?: number | null;
		accountIds?: string[] | null;
		spendingAccountIds?: string[] | null;
	}) => void;
	onResetConfig: (
		key: "paycheck" | "fixed" | "spent" | "checking" | "remaining",
	) => void;
	tab: TimingDetailTab;
	onTabChange: (tab: TimingDetailTab) => void;
	transactionOrder: TransactionOrder;
	onTransactionOrderChange: (order: TransactionOrder) => void;
	showHeaders?: boolean;
	onClose: () => void;
}) {
	const movements = useMemo(
		() => new Map(plan.movements.map((movement) => [movement.id, movement])),
		[plan.movements],
	);
	const accountsById = useMemo(
		() => new Map(plan.accounts.map((account) => [account.id, account])),
		[plan.accounts],
	);
	const [selected, setSelected] = useState<{
		transaction: AccountTransaction;
		movement: Plan["movements"][number];
	} | null>(null);
	const inspect = (
		transaction: AccountTransaction,
		movement: Plan["movements"][number],
	) => setSelected({ transaction, movement });
	const title =
		tab === "mandatory"
			? "Bills"
			: tab === "cycle"
				? "Where the cycle went"
				: "Configure";
	return (
		<Drawer
			side="right"
			open
			onClose={onClose}
			label={title}
			title={title}
			coverage="full"
		>
			<Tabs
				items={[
					{ id: "mandatory", label: "Bills" },
					{
						id: "cycle",
						label: "Where the cycle went",
						count: cycleTransactions.length,
					},
					{ id: "configure", label: "Configure" },
				]}
				value={tab}
				onChange={onTabChange}
				label="Timing detail view"
				className="account-view-tabs timing-detail-tabs"
			>
				{tab === "mandatory" ? (
					<div className="timing-mandatory">
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
									<div className="household-muted household-tiny">
										Committed
									</div>
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
										index === 0
											? CreditCard
											: index === 1
												? ShoppingBag
												: Wallet;
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
										amount: Math.min(
											cashNow.checking,
											Math.max(0, cashNow.bills),
										),
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
							{thisMonth.groups.length ? (
								<div className="household-bill-grid">
									{thisMonth.groups.map((group) => {
										const { status, note } = billStatusForGroup({
											group,
											transactions: thisMonth.transactions,
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
							<div className="household-timing-controls">
								<div
									className="segmented"
									role="toolbar"
									aria-label="Bills window"
								>
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
							<TimingSectionHeader
								title={thisMonth.title}
								subtitle={thisMonth.subtitle}
								total={thisMonth.total}
							/>
							<TransactionSectionView
								transactions={thisMonth.transactions}
								caption={thisMonth.title}
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
									<div className="household-muted household-tiny">
										Fixed bills
									</div>
									<div className="household-medium-number">
										{money(paycheck.fixed)}
									</div>
								</div>
								<div className="household-align-right">
									<div className="household-muted household-tiny">
										Card spending
									</div>
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
					</div>
				) : tab === "cycle" ? (
					<div className="timing-mandatory">
						<TimingSectionHeader
							title="Card charges in this cycle"
							subtitle={`${dateLabel(heroes.cycleStart, true)} to ${dateLabel(heroes.cycleEnd, true)}`}
							total={cycleTransactions.reduce(
								(total, transaction) => total + transaction.amount,
								0,
							)}
						/>
						<div className="table-toolbar">
							<TransactionSortButton
								order={transactionOrder}
								onChange={onTransactionOrderChange}
							/>
						</div>
						<TransactionSectionView
							transactions={cycleTransactions}
							caption="Card charges in this cycle"
							emptyMessage="No charges in this cycle yet."
							movements={movements}
							onInspect={inspect}
							order={transactionOrder}
							showHeaders={showHeaders}
						/>
					</div>
				) : (
					<div className="cycle-config">
						<label className="field">
							<span>Statement starts on day (1–28)</span>
							<input
								type="number"
								min={1}
								max={28}
								value={config.statementDay}
								onChange={(event) =>
									onUpdateConfig({
										statementDay: Math.min(
											28,
											Math.max(1, Math.floor(Number(event.target.value) || 20)),
										),
										statementDaySet: true,
									})
								}
							/>
						</label>
						<label className="field">
							<span>
								Expected next paycheck ($) —{" "}
								{config.paycheckHint
									? `${money(config.paycheckHint.amount)} on ${dateLabel(config.paycheckHint.date, true)}`
									: "no upcoming inflow in projection"}
							</span>
							<input
								type="number"
								min={0}
								step="10"
								placeholder={String(
									Math.round(config.paycheckHint?.amount ?? 0),
								)}
								value={config.paycheckOverride ?? ""}
								onChange={(event) =>
									onUpdateConfig({
										paycheckOverride:
											event.target.value === ""
												? null
												: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						{config.paycheckOverride !== null && (
							<button
								type="button"
								className="text-button"
								onClick={() => onResetConfig("paycheck")}
							>
								Use projected {money(config.paycheckHint?.amount ?? 0)} instead
							</button>
						)}
						<label className="field">
							<span>
								Next month fixed obligations ($) —{" "}
								{money(config.fixedHint.total)} for{" "}
								{dateLabel(config.fixedHint.start, true)} to{" "}
								{dateLabel(config.fixedHint.end, true)}
							</span>
							<input
								type="number"
								min={0}
								step="10"
								placeholder={String(Math.round(config.fixedHint.total))}
								value={config.fixedOverride ?? ""}
								onChange={(event) =>
									onUpdateConfig({
										fixedOverride:
											event.target.value === ""
												? null
												: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						{config.fixedOverride !== null && (
							<button
								type="button"
								className="text-button"
								onClick={() => onResetConfig("fixed")}
							>
								Use projected {money(config.fixedHint.total)} instead
							</button>
						)}
						<label className="field">
							<span>Protected reserve ($)</span>
							<input
								type="number"
								min={0}
								step="5"
								value={config.reserve}
								onChange={(event) =>
									onUpdateConfig({
										reserve: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						<label className="field">
							<span>
								Actual spent ($) — empty uses {money(config.spentHint)} tracked
							</span>
							<input
								type="number"
								min={0}
								step="1"
								placeholder={String(Math.round(config.spentHint))}
								value={config.spentOverride ?? ""}
								onChange={(event) =>
									onUpdateConfig({
										spentOverride:
											event.target.value === ""
												? null
												: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						{config.spentOverride !== null && (
							<button
								type="button"
								className="text-button"
								onClick={() => onResetConfig("spent")}
							>
								Use tracked {money(config.spentHint)} instead
							</button>
						)}
						<label className="field">
							<span>
								Available balance ($) — {money(config.checkingHint ?? 0)} in
								plan
							</span>
							<input
								type="number"
								min={0}
								step="10"
								placeholder={String(Math.round(config.checkingHint ?? 0))}
								value={config.checkingOverride ?? ""}
								onChange={(event) =>
									onUpdateConfig({
										checkingOverride:
											event.target.value === ""
												? null
												: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						{config.checkingOverride !== null && (
							<button
								type="button"
								className="text-button"
								onClick={() => onResetConfig("checking")}
							>
								Use plan {money(config.checkingHint ?? 0)} instead
							</button>
						)}
						<fieldset className="cycle-accounts">
							<legend>Accounts in available balance</legend>
							<div className="account-toggles">
								{config.spendingAccounts.map((account) => {
									const full = accountsById.get(account.id);
									const checked = config.trackedSpendingIds.includes(
										account.id,
									);
									if (!full) return null;
									return (
										<AccountToggle
											key={account.id}
											account={full}
											checked={checked}
											onToggle={() => onToggleSpendingAccount(account.id)}
										/>
									);
								})}
							</div>
						</fieldset>
						<label className="field">
							<span>
								Remaining bills this month ($) —{" "}
								{money(config.remainingHint.total)} through{" "}
								{dateLabel(config.remainingHint.monthEnd, true)}
							</span>
							<input
								type="number"
								min={0}
								step="10"
								placeholder={String(Math.round(config.remainingHint.total))}
								value={config.remainingOverride ?? ""}
								onChange={(event) =>
									onUpdateConfig({
										remainingOverride:
											event.target.value === ""
												? null
												: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						{config.remainingOverride !== null && (
							<button
								type="button"
								className="text-button"
								onClick={() => onResetConfig("remaining")}
							>
								Use projected {money(config.remainingHint.total)} instead
							</button>
						)}
						<fieldset className="cycle-accounts">
							<legend>Cards in cycle total</legend>
							<div className="account-toggles">
								{config.cards.map((card) => {
									const full = accountsById.get(card.id);
									const checked = config.trackedIds.includes(card.id);
									if (!full) return null;
									return (
										<AccountToggle
											key={card.id}
											account={full}
											checked={checked}
											onToggle={() => onToggleAccount(card.id)}
										/>
									);
								})}
							</div>
						</fieldset>
						<fieldset className="cycle-accounts">
							<legend>Recurring payments in this total</legend>
							{billCandidates.length ? (
								billCandidates.map((bill) => {
									const checked = trackedBillIds.includes(bill.id);
									return (
										<label key={bill.id} className="cycle-account-option">
											<input
												type="checkbox"
												checked={checked}
												onChange={() => onToggleBill(bill.id)}
											/>
											<span>
												{bill.name} · {money(bill.amount)} · {bill.frequency}
											</span>
										</label>
									);
								})
							) : (
								<p className="section-note">
									No recurring checking outflows found in the plan.
								</p>
							)}
						</fieldset>
					</div>
				)}
			</Tabs>
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
		</Drawer>
	);
}
