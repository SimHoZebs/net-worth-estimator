import { useId, useMemo, useState } from "react";
import { TransactionRow } from "../../components/activity/TransactionRow.tsx";
import {
	type BarSegment,
	SegmentedBar,
} from "../../components/SegmentedBar.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { Badge, Modal } from "../../components/ui.tsx";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { dateLabel, money } from "../../domain/format.ts";
import type { MandatorySpendingGroup } from "../../domain/householdTiming.ts";
import type { Plan } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";

export type TimingDetailTab = "mandatory" | "cycle" | "configure";

export type MandatoryFrame = "calendar" | "cycle";

export interface TimingMandatorySection {
	title: string;
	subtitle: string;
	total: number;
	groups: MandatorySpendingGroup[];
}
export interface CashNowDecomposition {
	checking: number;
	bills: number;
	cushion: number;
}

export interface PaycheckDecomposition {
	paycheck: number;
	fixed: number;
	reserve: number;
	spent: number;
	allowance: number;
}

/** Bucket one: what checking covers right now. */
function CashNowBar({ parts }: { parts: CashNowDecomposition }) {
	const segments: BarSegment[] = [
		{
			label: "Bills due",
			amount: parts.bills,
			pattern: "stripes",
			tone: "sage",
		},
		{
			label: parts.cushion >= 0 ? "Cushion" : "Short",
			amount: Math.max(0, parts.cushion),
			pattern: parts.cushion >= 0 ? "solid" : "hatch",
			tone: parts.cushion >= 0 ? "sage" : "amber",
		},
	];
	return (
		<SegmentedBar
			caption={
				parts.cushion >= 0
					? `${money(parts.checking)} checking · ${money(parts.cushion)} cushion left`
					: `${money(parts.checking)} checking · short ${money(-parts.cushion)}`
			}
			segments={segments}
			ariaLabel={`Checking ${money(parts.checking)}: bills due ${money(parts.bills)}, cushion ${money(Math.max(0, parts.cushion))}`}
		/>
	);
}

/** Bucket two: where the next paycheck goes. */
function PaycheckBar({ parts }: { parts: PaycheckDecomposition }) {
	const segments: BarSegment[] = [
		{ label: "Bills", amount: parts.fixed, pattern: "stripes", tone: "sage" },
		{
			label: "Reserve",
			amount: parts.reserve,
			pattern: "dots",
			tone: "pale",
		},
		{ label: "Spent", amount: parts.spent, pattern: "solid", tone: "dark" },
		{
			label: parts.allowance >= 0 ? "Left" : "Over",
			amount: Math.max(0, parts.allowance),
			pattern: parts.allowance >= 0 ? "solid" : "hatch",
			tone: parts.allowance >= 0 ? "pale" : "amber",
		},
	];
	return (
		<SegmentedBar
			caption={
				parts.allowance >= 0
					? `${money(parts.paycheck)} paycheck · ${money(parts.allowance)} left`
					: `${money(parts.paycheck)} paycheck · over by ${money(-parts.allowance)}`
			}
			segments={segments}
			ariaLabel={`Paycheck ${money(parts.paycheck)}: bills ${money(parts.fixed)}, reserve ${money(parts.reserve)}, spent ${money(parts.spent)}, left ${money(Math.max(0, parts.allowance))}`}
		/>
	);
}

function daysUntil(date: string, today: string): number {
	return Math.round(
		(new Date(`${date}T12:00:00Z`).getTime() -
			new Date(`${today}T12:00:00Z`).getTime()) /
			86_400_000,
	);
}

function dueLabel(date: string, today: string): string {
	const days = daysUntil(date, today);
	if (days <= 0) return dateLabel(date, true);
	if (days === 1) return `${dateLabel(date, true)} · tomorrow`;
	return `${dateLabel(date, true)} · in ${days} days`;
}

function MandatorySectionView({
	section,
	today,
}: {
	section: TimingMandatorySection;
	today: string;
}) {
	if (!section.groups.length) {
		return (
			<div className="cycle-breakdown">
				<p>No mandatory spending projected for this period.</p>
			</div>
		);
	}
	const ordered = [...section.groups].sort(
		(a, b) =>
			(a.dates[0] ?? "").localeCompare(b.dates[0] ?? "") || b.total - a.total,
	);
	return (
		<div>
			<p className="section-note">
				{section.subtitle} · <strong>{money(section.total)}</strong>
			</p>
			<ul className="mandatory-list">
				{ordered.map((group) => {
					const first = group.dates[0] ?? today;
					const when =
						group.dates.length === 1
							? dueLabel(first, today)
							: `${dueLabel(first, today)} · ${group.count} charges`;
					return (
						<li key={group.movementId}>
							<div className="mandatory-row">
								<span>
									<strong>{group.name}</strong>
									<small>{when}</small>
								</span>
								<strong>{money(group.total)}</strong>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
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
}

export function TimingDetailDialog({
	eyebrow,
	today,
	heroes,
	cashNow,
	paycheck,
	frame,
	onFrameChange,
	thisMonth,
	nextMonth,
	plan,
	onEdit,
	cycleTransactions,
	config,
	billsFiltered,
	billCandidates,
	trackedBillIds,
	onToggleBill,
	onToggleAccount,
	onUpdateConfig,
	onResetConfig,
	initialTab,
	onClose,
}: {
	eyebrow: string;
	today: string;
	heroes: TimingHeroes;
	cashNow: CashNowDecomposition;
	paycheck: PaycheckDecomposition;
	frame: MandatoryFrame;
	onFrameChange: (frame: MandatoryFrame) => void;
	thisMonth: TimingMandatorySection;
	nextMonth: TimingMandatorySection;
	plan: Plan;
	onEdit: (target: EditorTarget) => void;
	cycleTransactions: AccountTransaction[];
	config: TimingConfigHints;
	billsFiltered: boolean;
	billCandidates: {
		id: string;
		name: string;
		amount: number;
		frequency: string;
	}[];
	trackedBillIds: string[];
	onToggleBill: (movementId: string) => void;
	onToggleAccount: (accountId: string) => void;
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
	}) => void;
	onResetConfig: (
		key: "paycheck" | "fixed" | "spent" | "checking" | "remaining",
	) => void;
	initialTab: TimingDetailTab;
	onClose: () => void;
}) {
	const [tab, setTab] = useState<TimingDetailTab>(initialTab);
	const [expanded, setExpanded] = useState<string | null>(null);
	const detailId = useId();
	const movements = useMemo(
		() => new Map(plan.movements.map((movement) => [movement.id, movement])),
		[plan.movements],
	);
	return (
		<Modal
			title="Timing detail"
			eyebrow={eyebrow}
			onClose={onClose}
			className="modal-drawer"
		>
			<Tabs
				items={[
					{ id: "mandatory", label: "Mandatory spending" },
					{
						id: "cycle",
						label: "Cycle breakdown",
						count: cycleTransactions.length,
					},
					{ id: "configure", label: "Configure" },
				]}
				value={tab}
				onChange={setTab}
				label="Timing detail view"
				className="account-view-tabs"
			>
				{tab === "mandatory" ? (
					<div className="timing-mandatory">
						<h3>Cash cushion</h3>
						<div className="timing-figures">
							<div>
								<span>
									Cash cushion{" "}
									{heroes.cushionProvisional && (
										<Badge tone="amber">Estimated</Badge>
									)}
								</span>
								<strong>{money(heroes.cushion)}</strong>
							</div>
							<div>
								<span>Checking snapshot</span>
								<strong>{money(heroes.checkingAmount)}</strong>
							</div>
						</div>
						<p className="section-note">
							{heroes.checkingObservedOn
								? `As of ${dateLabel(heroes.checkingObservedOn, true)}`
								: "No confirmed balance — estimated"}
						</p>
						<CashNowBar parts={cashNow} />
						<h3>Safe card room</h3>
						<div className="timing-figures">
							<div>
								<span>Safe room</span>
								<strong>{money(heroes.safe)}</strong>
							</div>
							<div>
								<span>Theoretical room</span>
								<strong>{money(heroes.theoretical)}</strong>
							</div>
						</div>
						<PaycheckBar parts={paycheck} />
						<div className="timing-figures">
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
							caption={`Committed ${money(heroes.committedTotal)} — payments toward prior balances excluded`}
							segments={heroes.committedByCard.map((card, index) => ({
								label: `${card.name} · ${money(card.amount)}`,
								amount: card.amount,
								pattern: index % 2 === 0 ? "solid" : "stripes",
								tone: index % 2 === 0 ? "dark" : "sage",
							}))}
							ariaLabel={`Committed cycle spend ${money(heroes.committedTotal)}: ${heroes.committedByCard.map((card) => `${card.name} ${money(card.amount)}`).join(", ")}`}
						/>
						<p className="section-note">
							Paycheck {money(heroes.paycheckAmount)} − fixed{" "}
							{money(heroes.fixedAmount)} − reserve{" "}
							{money(heroes.reserveAmount)} ·{" "}
							{dateLabel(heroes.cycleStart, true)} to{" "}
							{dateLabel(heroes.cycleEnd, true)}
						</p>
						<Tabs
							items={[
								{ id: "calendar", label: "Calendar month" },
								{ id: "cycle", label: "Card cycle" },
							]}
							value={frame}
							onChange={onFrameChange}
							label="Mandatory spending window"
						>
							{null}
						</Tabs>
						<h3>{thisMonth.title}</h3>
						<MandatorySectionView section={thisMonth} today={today} />
						<h3>{nextMonth.title}</h3>
						<MandatorySectionView section={nextMonth} today={today} />
						<p className="section-note">
							{billsFiltered
								? "Filtered to your selected bills — change the set in Configure."
								: "Counting every recurring checking outflow. "}
							Card charges do not appear here; they are budgeted against your
							next paycheck in the cycle allowance.
						</p>
					</div>
				) : tab === "cycle" ? (
					cycleTransactions.length ? (
						<div className="table-scroll">
							<table className="account-activity-table">
								<caption className="sr-only">
									Card charges in this cycle, newest last
								</caption>
								<thead>
									<tr>
										<th scope="col" className="transaction-date-column">
											Date
										</th>
										<th scope="col">Transaction</th>
										<th scope="col" className="transaction-amount-column">
											Amount
										</th>
									</tr>
								</thead>
								<tbody>
									{cycleTransactions.map((transaction, index) => (
										<TransactionRow
											key={transaction.id}
											transaction={transaction}
											movement={movements.get(transaction.movementId) ?? null}
											open={expanded === transaction.id}
											detailId={`${detailId}-row-${index}`}
											onToggle={() =>
												setExpanded(
													expanded === transaction.id ? null : transaction.id,
												)
											}
											onEdit={(item) => onEdit({ kind: "movement", item })}
										/>
									))}
								</tbody>
							</table>
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
								Checking balance ($) — {money(config.checkingHint ?? 0)} in plan
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
							<legend>Accounts in this total</legend>
							{config.cards.map((card) => {
								const checked = config.trackedIds.includes(card.id);
								return (
									<label key={card.id} className="cycle-account-option">
										<input
											type="checkbox"
											checked={checked}
											onChange={() => onToggleAccount(card.id)}
										/>
										<span>{card.name}</span>
									</label>
								);
							})}
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
