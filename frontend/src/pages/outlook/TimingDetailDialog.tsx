import { useMemo } from "react";
import { TransactionSortButton } from "../../components/activity/TransactionSortButton.tsx";
import { TransactionRow } from "../../components/activity/TransactionRow.tsx";
import { TransactionTable } from "../../components/activity/TransactionTable.tsx";
import { AccountLabel } from "../../components/AccountIcon.tsx";
import {
	type BarSegment,
	SegmentedBar,
} from "../../components/SegmentedBar.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { Modal } from "../../components/ui.tsx";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { dateLabel, money } from "../../domain/format.ts";
import type { MandatorySpendingGroup } from "../../domain/householdTiming.ts";
import type { Plan } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";
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

/** Bucket one: what checking covers right now. Short comes from the
 * simulated unpaid bills (the fulfillment signal), not the cushion: with a
 * floor the simulation pays partially and reports the gap. The cushion only
 * stands in when the plan permits invisible overdraft (no gaps to report).
 * The walk-forward adjustment stays in the math but only appears in the bar
 * when nonzero. */
function CashNowBar({ parts }: { parts: CashNowDecomposition }) {
	const isShort = parts.short > 0 || parts.cushion < 0;
	const shortAmount = parts.short > 0 ? parts.short : -parts.cushion;
	const segments: BarSegment[] = isShort
		? [
				{
					label: "Bills due",
					amount: parts.bills,
					pattern: "stripes",
					tone: "sage",
				},
			]
		: [
				{
					label: "Bills due",
					amount: parts.bills,
					pattern: "stripes",
					tone: "sage",
				},
				{
					label: "Left to spend",
					amount: parts.cushion,
					pattern: "solid",
					tone: "plum",
				},
			];
	const paidNote =
		parts.spentSinceStart > 0
			? ` · ${money(parts.spentSinceStart)} paid since ${dateLabel(parts.since, true)}`
			: "";
	const shortNote =
		isShort && parts.short > 0 && parts.firstShort
			? ` from ${dateLabel(parts.firstShort, true)}`
			: "";
	return (
		<SegmentedBar
			caption={
				isShort
					? `${money(parts.checking)} total${paidNote} · ${money(-shortAmount)} left to spend${shortNote}`
					: `${money(parts.checking)} total${paidNote} · ${money(parts.cushion)} left to spend`
			}
			segments={segments}
			ariaLabel={
				isShort
					? `Available balance ${money(parts.checking)}: bills due ${money(parts.bills)}, left to spend ${money(-shortAmount)}${shortNote}${paidNote}`
					: `Available balance ${money(parts.checking)}: bills due ${money(parts.bills)}, left to spend ${money(parts.cushion)}${paidNote}`
			}
		/>
	);
}

/** Bucket two: where the next paycheck goes. A negative allowance buys
 * nothing, so the bar draws only the claims on the paycheck; the overage
 * lives in the caption as a negative number. */
function PaycheckBar({ parts }: { parts: PaycheckDecomposition }) {
	const segments: BarSegment[] = [
		{ label: "Bills", amount: parts.fixed, pattern: "stripes", tone: "sage" },
		{
			label: "Reserve",
			amount: parts.reserve,
			pattern: "dots",
			tone: "blue",
		},
		{ label: "Spent", amount: parts.spent, pattern: "solid", tone: "tan" },
		...(parts.allowance >= 0
			? [
					{
						label: "Left",
						amount: parts.allowance,
						pattern: "solid",
						tone: "plum",
					} as BarSegment,
				]
			: []),
	];
	return (
		<SegmentedBar
			caption={
				parts.allowance >= 0
					? `${money(parts.paycheck)} paycheck · ${money(parts.allowance)} left`
					: `${money(parts.paycheck)} paycheck · over by ${money(-parts.allowance)}`
			}
			segments={segments}
			ariaLabel={
				parts.allowance >= 0
					? `Paycheck ${money(parts.paycheck)}: bills ${money(parts.fixed)}, reserve ${money(parts.reserve)}, spent ${money(parts.spent)}, left ${money(parts.allowance)}`
					: `Paycheck ${money(parts.paycheck)}: bills ${money(parts.fixed)}, reserve ${money(parts.reserve)}, spent ${money(parts.spent)}, over by ${money(-parts.allowance)}`
			}
		/>
	);
}

function MandatorySectionView({
	section,
	movements,
	onEdit,
	order,
	showHeaders = false,
}: {
	section: TimingMandatorySection;
	movements: Map<string, Plan["movements"][number]>;
	onEdit: (movement: Plan["movements"][number]) => void;
	order: TransactionOrder;
	showHeaders?: boolean;
}) {
	if (!section.transactions.length) {
		return (
			<div className="cycle-breakdown">
				<p>No bills due in this period.</p>
			</div>
		);
	}
	return (
		<TransactionTable
			caption={`${section.title}, ${order === "oldest" ? "oldest first" : "newest first"}`}
			showHeaders={showHeaders}
		>
			{section.transactions.map((transaction) => (
				<TransactionRow
					key={transaction.id}
					transaction={transaction}
					movement={movements.get(transaction.movementId) ?? null}
					onEdit={onEdit}
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
	eyebrow,
	heroes,
	cashNow,
	paycheck,
	frame,
	onFrameChange,
	thisMonth,
	plan,
	onEdit,
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
	eyebrow: string;
	heroes: TimingHeroes;
	cashNow: CashNowDecomposition;
	paycheck: PaycheckDecomposition;
	frame: MandatoryFrame;
	onFrameChange: (frame: MandatoryFrame) => void;
	thisMonth: TimingMandatorySection;
	plan: Plan;
	onEdit: (target: EditorTarget) => void;
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
	return (
		<Modal
			title="Timing detail"
			eyebrow={eyebrow}
			onClose={onClose}
			className="modal-drawer"
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
				className="account-view-tabs"
			>
				{tab === "mandatory" ? (
					<div className="timing-mandatory">
						<div className="section-top">
							<div className="timing-section-title">
								<h3>Available balance</h3>
								{heroes.checkingObservedOn ? (
									<p className="section-note">
										As of {dateLabel(heroes.checkingObservedOn, true)}
									</p>
								) : null}
							</div>
						</div>
						<CashNowBar parts={cashNow} />
						<div className="timing-controls">
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
						<div className="section-top">
							<div className="timing-section-title">
								<h3>{thisMonth.title}</h3>
								<p className="section-note">{thisMonth.subtitle}</p>
							</div>
							<strong className="timing-total">{money(thisMonth.total)}</strong>
						</div>
						<MandatorySectionView
							section={thisMonth}
							movements={movements}
							onEdit={(item) => onEdit({ kind: "movement", item })}
							order={transactionOrder}
							showHeaders={showHeaders}
						/>
						<h3>Safe card room</h3>
						<PaycheckBar parts={paycheck} />
						<div className="timing-figures">
							<div>
								<span>Theoretical room</span>
								<strong>{money(heroes.theoretical)}</strong>
							</div>
							<div>
								<span>Daily safe · {heroes.fullDaysLeft} days</span>
								<strong>{money(Math.max(0, heroes.dailySafe))}</strong>
							</div>
							<div>
								<span>Daily theoretical</span>
								<strong>{money(Math.max(0, heroes.dailyTheoretical))}</strong>
							</div>
						</div>
						<SegmentedBar
							caption={`Card charges ${money(heroes.committedTotal)} — payments toward prior balances excluded`}
							segments={heroes.committedByCard.map((card, index) => ({
								label: `${card.name} · ${money(card.amount)}`,
								amount: card.amount,
								pattern: index % 2 === 0 ? "solid" : "stripes",
								tone: index % 2 === 0 ? "blue" : "plum",
							}))}
							ariaLabel={`Card charges ${money(heroes.committedTotal)}: ${heroes.committedByCard.map((card) => `${card.name} ${money(card.amount)}`).join(", ")}`}
						/>
					</div>
				) : tab === "cycle" ? (
					cycleTransactions.length ? (
						<div className="timing-cycle">
							<div className="table-toolbar">
								<TransactionSortButton
									order={transactionOrder}
									onChange={onTransactionOrderChange}
								/>
							</div>
							<TransactionTable
								caption={`Card charges in this cycle, ${transactionOrder === "oldest" ? "oldest first" : "newest first"}`}
								showHeaders={showHeaders}
							>
								{cycleTransactions.map((transaction) => (
									<TransactionRow
										key={transaction.id}
										transaction={transaction}
										movement={movements.get(transaction.movementId) ?? null}
										onEdit={(item) => onEdit({ kind: "movement", item })}
									/>
								))}
							</TransactionTable>
						</div>
					) : (
						<p>No charges in this cycle yet.</p>
					)
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
		</Modal>
	);
}
