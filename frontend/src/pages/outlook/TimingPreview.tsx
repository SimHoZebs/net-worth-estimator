import { CalendarDays } from "lucide-react";
import { useMemo, useState } from "react";
import { accountTransactions } from "../../domain/accountActivity.ts";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "../../domain/transactionSort.ts";
import {
	cycleSpentSoFar,
	isCycleOutflow,
	resolveStatementCycle,
} from "../../domain/cardCycle.ts";
import {
	dateLabel,
	money,
	shiftDate,
	sum,
	todayIso,
} from "../../domain/format.ts";
import { Skeleton } from "../../components/ui.tsx";
import {
	cashCushion,
	checkingAccountId,
	checkingShortfall,
	cycleAllowance,
	filterMovementsById,
	groupMandatorySpending,
	mandatoryTransactions,
	nextMonthObligations,
	nextPaycheck,
	realizedCheckingOutflows,
	remainingMonthlyObligations,
	spendingBalance,
} from "../../domain/householdTiming.ts";
import type { Plan } from "../../domain/model.ts";
import { visibleAccounts } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";
import type { Projection } from "../../domain/result.ts";
import {
	TimingDetailDialog,
	type TimingDetailTab,
} from "./TimingDetailDialog.tsx";
import { useTimingSettings } from "../../state/useTimingSettings.ts";

// Stable empty input so pending derivations stay null-safe without
// re-running memos on identity churn.
const EMPTY_MOVEMENTS: Projection["movements"] = [];

export function TimingPreview({
	plan,
	projection,
	onEdit,
	pending = false,
	detail,
	onDetail,
	onTabChange,
}: {
	plan: Plan;
	projection: Projection | null;
	onEdit: (target: EditorTarget) => void;
	pending?: boolean;
	detail: TimingDetailTab | null;
	onDetail: (tab: TimingDetailTab | null) => void;
	onTabChange: (tab: TimingDetailTab) => void;
}) {
	const movements = projection?.movements ?? EMPTY_MOVEMENTS;
	const cards = useMemo(
		() =>
			visibleAccounts(plan.accounts).filter(
				(account) => account.kind === "debt",
			),
		[plan.accounts],
	);
	const settingsState = useTimingSettings();
	const { updateSettings, resetConfig, ...settings } = settingsState;
	const [transactionOrder, setTransactionOrder] = useState<TransactionOrder>(
		DEFAULT_TRANSACTION_ORDER,
	);

	// Display timing follows the real calendar day so due dates read
	// correctly, while the projection math stays on plan.startDate (the
	// latest balance checkpoint). Never before the projection start.
	const [displayToday] = useState(() => {
		const today = todayIso();
		const start = plan.startDate.slice(0, 10);
		return today >= start ? today : start;
	});
	const staleData = displayToday > plan.startDate.slice(0, 10);

	const trackedIds = useMemo(() => {
		const known = new Set(cards.map((card) => card.id));
		// Spending cards are debt accounts by convention (`*_card`); loans
		// and other debt fall back to the full set when no card is present.
		const cardLike = cards
			.map((card) => card.id)
			.filter((id) => id.endsWith("_card"));
		const fallback = cardLike.length ? cardLike : cards.map((card) => card.id);
		if (!settings.accountIds) return fallback.filter((id) => known.has(id));
		const selected = settings.accountIds.filter((id) => known.has(id));
		return selected.length ? selected : fallback.filter((id) => known.has(id));
	}, [settings.accountIds, cards]);

	const trackedCards = useMemo(() => {
		const selected = new Set(trackedIds);
		return cards.filter((card) => selected.has(card.id));
	}, [trackedIds, cards]);

	const cycle = useMemo(
		() =>
			resolveStatementCycle({
				todayIso: displayToday,
				statementDay: settings.statementDay,
			}),
		[displayToday, settings.statementDay],
	);

	const perAccount = useMemo(
		() =>
			!projection
				? []
				: trackedIds.map((accountId) => {
						const transactions = accountTransactions({
							accountId,
							plan,
							projection,
						});
						const name =
							cards.find((card) => card.id === accountId)?.name ?? accountId;
						return {
							accountId,
							name,
							derived: cycleSpentSoFar({
								transactions,
								cycleStart: cycle.cycleStart,
								todayIso: displayToday,
							}),
							inCycle: transactions.filter(
								(transaction) =>
									isCycleOutflow(transaction) &&
									transaction.date >= cycle.cycleStart &&
									transaction.date <= displayToday,
							),
						};
					}),
		[trackedIds, cards, plan, projection, cycle, displayToday],
	);
	const cycleTransactions = useMemo(
		() =>
			sortTransactionsByDate({
				items: perAccount.flatMap((item) => item.inCycle),
				getDate: (transaction) => transaction.date,
				getId: (transaction) => transaction.id,
				order: transactionOrder,
			}),
		[perAccount, transactionOrder],
	);

	const spendableAccounts = useMemo(
		() =>
			visibleAccounts(plan.accounts).filter(
				(account) => account.kind !== "debt",
			),
		[plan.accounts],
	);
	const spendingIds = useMemo(() => {
		const known = new Set(spendableAccounts.map((account) => account.id));
		const fallbackId = checkingAccountId(plan);
		const fallback = fallbackId && known.has(fallbackId) ? [fallbackId] : [];
		if (!settings.spendingAccountIds) return fallback;
		const selected = settings.spendingAccountIds.filter((id) => known.has(id));
		return selected.length ? selected : fallback;
	}, [settings.spendingAccountIds, spendableAccounts, plan]);
	const spendingDerived = useMemo(
		() => spendingBalance(plan, spendingIds),
		[plan, spendingIds],
	);
	const obligationMovements = useMemo(
		() => filterMovementsById(movements, settings.movementIds),
		[movements, settings.movementIds],
	);
	const remainingDerived = useMemo(() => {
		if (!spendingIds.length)
			return { total: 0, monthEnd: displayToday.slice(0, 10) };
		return remainingMonthlyObligations({
			movements: obligationMovements,
			checkingIds: spendingIds,
			todayIso: displayToday,
		});
	}, [obligationMovements, spendingIds, displayToday]);
	const fixedDerived = useMemo(() => {
		if (!spendingIds.length)
			return { total: 0, start: displayToday, end: displayToday };
		return nextMonthObligations({
			movements: obligationMovements,
			checkingIds: spendingIds,
			todayIso: displayToday,
		});
	}, [obligationMovements, spendingIds, displayToday]);
	const paycheckDerived = useMemo(() => {
		if (!spendingIds.length) return null;
		return nextPaycheck({
			movements,
			checkingIds: spendingIds,
			todayIso: displayToday,
		});
	}, [movements, spendingIds, displayToday]);
	const spentSinceStart = useMemo(
		() =>
			spendingIds.length
				? realizedCheckingOutflows({
						movements: obligationMovements,
						checkingIds: spendingIds,
						after: plan.startDate,
						through: displayToday,
					})
				: 0,
		[obligationMovements, spendingIds, plan.startDate, displayToday],
	);
	const shortWindow = useMemo(
		() =>
			spendingIds.length
				? checkingShortfall({
						movements: obligationMovements,
						checkingIds: spendingIds,
						after: displayToday,
						through: remainingDerived.monthEnd,
					})
				: { total: 0, firstDate: null as string | null },
		[obligationMovements, spendingIds, displayToday, remainingDerived.monthEnd],
	);

	const billCandidates = useMemo(() => {
		if (!spendingIds.length) return [];
		return plan.movements
			.filter(
				(movement) =>
					movement.fromId !== null &&
					spendingIds.includes(movement.fromId) &&
					movement.frequency !== "once",
			)
			.map((movement) => ({
				id: movement.id,
				name: movement.name,
				amount: movement.amount,
				frequency: movement.frequency,
			}));
	}, [plan.movements, spendingIds]);

	const trackedBillIds = useMemo(() => {
		const known = new Set(billCandidates.map((bill) => bill.id));
		if (!settings.movementIds) return billCandidates.map((bill) => bill.id);
		const selected = settings.movementIds.filter((id) => known.has(id));
		return selected.length ? selected : billCandidates.map((bill) => bill.id);
	}, [settings.movementIds, billCandidates]);

	const mandatoryThisMonth = useMemo(() => {
		if (!spendingIds.length) return [];
		return groupMandatorySpending({
			movements: obligationMovements,
			checkingIds: spendingIds,
			start: shiftDate({ date: displayToday, days: 1 }),
			end: remainingDerived.monthEnd,
		});
	}, [
		obligationMovements,
		spendingIds,
		displayToday,
		remainingDerived.monthEnd,
	]);
	const cycleThisGroups = useMemo(() => {
		if (!spendingIds.length) return [];
		return groupMandatorySpending({
			movements: obligationMovements,
			checkingIds: spendingIds,
			start: shiftDate({ date: displayToday, days: 1 }),
			end: cycle.cycleEnd,
		});
	}, [obligationMovements, spendingIds, displayToday, cycle.cycleEnd]);
	const thisMonthTransactions = useMemo(() => {
		if (!spendingIds.length) return [];
		const range =
			settings.mandatoryFrame === "calendar"
				? {
						start: shiftDate({ date: displayToday, days: 1 }),
						end: remainingDerived.monthEnd,
					}
				: {
						start: shiftDate({ date: displayToday, days: 1 }),
						end: cycle.cycleEnd,
					};
		return sortTransactionsByDate({
			items: mandatoryTransactions({
				movements: obligationMovements,
				checkingIds: spendingIds,
				start: range.start,
				end: range.end,
				plan,
			}),
			getDate: (transaction) => transaction.date,
			getId: (transaction) => transaction.id,
			order: transactionOrder,
		});
	}, [
		obligationMovements,
		spendingIds,
		plan,
		settings.mandatoryFrame,
		displayToday,
		remainingDerived.monthEnd,
		cycle.cycleEnd,
		transactionOrder,
	]);
	if (!cards.length) {
		return (
			<section className="timing-preview" aria-label="Safe card spending">
				<div className="section-top">
					<h2>
						<CalendarDays size={18} />
						Safe card spending
					</h2>
				</div>
				<p className="section-note">
					Add a debt account to track a card statement cycle here.
				</p>
			</section>
		);
	}

	const derivedSpent = perAccount.reduce((sum, item) => sum + item.derived, 0);

	const checking = settings.checkingOverride ?? spendingDerived;
	const remainingObligations =
		settings.remainingOverride ?? remainingDerived.total;
	const cushion = cashCushion({
		checking,
		spentSinceStart,
		remainingObligations,
	});

	const paycheck = settings.paycheckOverride ?? paycheckDerived?.amount ?? 0;
	const fixedObligations = settings.fixedOverride ?? fixedDerived.total;
	const spent = settings.spentOverride ?? derivedSpent;
	const allowance = cycleAllowance({
		paycheck,
		fixedObligations,
		spent,
		reserve: settings.reserve,
	});
	const theoretical = paycheck - fixedObligations - spent;
	const fullDaysLeft = Math.max(1, cycle.daysLeft - 1);
	const dailySafe = allowance / fullDaysLeft;
	const dailyTheoretical = theoretical / fullDaysLeft;

	const spendingAccounts = spendingIds
		.map((id) => plan.accounts.find((account) => account.id === id))
		.filter((account) => account !== undefined);
	const observedOn = spendingAccounts
		.map((account) => account.observedOn)
		.sort();
	const heroes = {
		cushion,
		cushionProvisional: false,
		checkingAmount: checking,
		checkingObservedOn: observedOn.at(-1) ?? null,
		safe: allowance,
		theoretical,
		dailySafe,
		dailyTheoretical,
		fullDaysLeft,
		cycleStart: cycle.cycleStart,
		cycleEnd: cycle.cycleEnd,
		committedTotal: spent,
		committedByCard: perAccount.map((item) => ({
			id: item.accountId,
			name: item.name,
			amount: item.derived,
		})),
		paycheckAmount: paycheck,
		fixedAmount: fixedObligations,
		reserveAmount: settings.reserve,
	};

	const toggleAccount = (accountId: string) => {
		const cardLike = cards
			.map((card) => card.id)
			.filter((id) => id.endsWith("_card"));
		const fallback = cardLike.length ? cardLike : cards.map((card) => card.id);
		const explicit = settings.accountIds ?? fallback;
		const next = explicit.includes(accountId)
			? explicit.filter((id) => id !== accountId)
			: [...explicit, accountId];
		updateSettings({ accountIds: next.length ? next : null });
	};

	const toggleBill = (movementId: string) => {
		const explicit =
			settings.movementIds ?? billCandidates.map((bill) => bill.id);
		const next = explicit.includes(movementId)
			? explicit.filter((id) => id !== movementId)
			: [...explicit, movementId];
		updateSettings({
			movementIds:
				next.length === billCandidates.length || next.length === 0
					? null
					: next,
		});
	};

	const toggleSpendingAccount = (accountId: string) => {
		const known = new Set(spendableAccounts.map((account) => account.id));
		const fallbackId = checkingAccountId(plan);
		const fallback = fallbackId && known.has(fallbackId) ? [fallbackId] : [];
		const explicit = settings.spendingAccountIds ?? fallback;
		const next = explicit.includes(accountId)
			? explicit.filter((id) => id !== accountId)
			: [...explicit, accountId];
		updateSettings({ spendingAccountIds: next.length ? next : null });
	};

	const narrowedAccounts = trackedIds.length !== cards.length;
	const accountLabel = narrowedAccounts
		? trackedCards.map((card) => card.name).join(", ")
		: null;

	const activeThisMonth =
		settings.mandatoryFrame === "calendar"
			? {
					title: "Due before month-end",
					subtitle: `${dateLabel(displayToday, true)} to ${dateLabel(remainingDerived.monthEnd, true)}`,
					total: remainingObligations,
					groups: mandatoryThisMonth,
					transactions: thisMonthTransactions,
				}
			: {
					title: "Due before cycle end",
					subtitle: `${dateLabel(displayToday, true)} to ${dateLabel(cycle.cycleEnd, true)}`,
					total: sum(cycleThisGroups.map((group) => group.total)),
					groups: cycleThisGroups,
					transactions: thisMonthTransactions,
				};
	// Plan-derived frame (header, cycle dates) renders regardless; only the
	// computed timing body skeletonizes while the projection is absent.
	if (pending)
		return (
			<section className="timing-preview" aria-label="Safe card spending">
				<div className="section-top">
					<h2>
						<CalendarDays size={18} />
						Safe card spending
					</h2>
				</div>
				<p className="cycle-dates">
					{dateLabel(cycle.cycleEnd, true)} · {fullDaysLeft}{" "}
					{fullDaysLeft === 1 ? "day" : "days"} left
					{staleData ? ` · balances ${dateLabel(plan.startDate, true)}` : ""}
				</p>
				<div aria-busy="true">
					<Skeleton width={"100%"} height={120} />
				</div>
			</section>
		);

	return (
		<section className="timing-preview" aria-label="Safe card spending">
			<button
				type="button"
				className="timing-open"
				onClick={() => onDetail("mandatory")}
			>
				<span className="sr-only">Open timing details</span>
			</button>
			<div className="section-top">
				<h2>
					<CalendarDays size={18} />
					Safe card spending
				</h2>
			</div>
			<p className="cycle-dates">
				{dateLabel(cycle.cycleEnd, true)} · {fullDaysLeft}{" "}
				{fullDaysLeft === 1 ? "day" : "days"} left
				{staleData ? ` · balances ${dateLabel(plan.startDate, true)}` : ""}
			</p>
			<div className="spend-answer">
				<span>{allowance >= 0 ? "You can spend" : "Over budget"}</span>
				<strong>{money(Math.abs(allowance))}</strong>
				<span>
					{allowance >= 0
						? `${money(dailySafe)} a day`
						: `${money(-dailySafe)} a day over`}
				</span>
			</div>
			<div className="cycle-remaining">
				<div>
					<span>Balance</span>
					<strong>{money(checking)}</strong>
				</div>
				<div>
					<span>Bills due</span>
					<strong>{money(remainingObligations)}</strong>
				</div>
				<div>
					<span>Left to spend</span>
					<strong>
						{money(shortWindow.total > 0 ? -shortWindow.total : cushion)}
					</strong>
				</div>
			</div>
			<div className="cycle-actions">
				<button
					type="button"
					className="text-button"
					onClick={(event) => {
						event.stopPropagation();
						onDetail("mandatory");
					}}
				>
					Bills
				</button>
				<button
					type="button"
					className="text-button"
					onClick={(event) => {
						event.stopPropagation();
						onDetail("cycle");
					}}
				>
					Charges
				</button>
			</div>
			{detail && (
				<TimingDetailDialog
					eyebrow={`${dateLabel(cycle.cycleStart, true)} to ${dateLabel(cycle.cycleEnd, true)}${accountLabel ? ` · ${accountLabel}` : ""}`}
					heroes={heroes}
					cashNow={{
						checking,
						spentSinceStart,
						bills: remainingObligations,
						cushion,
						since: plan.startDate.slice(0, 10),
						short: shortWindow.total,
						firstShort: shortWindow.firstDate,
					}}
					paycheck={{
						paycheck,
						fixed: fixedObligations,
						reserve: settings.reserve,
						spent,
						allowance,
					}}
					thisMonth={activeThisMonth}
					frame={settings.mandatoryFrame}
					onFrameChange={(frame) => updateSettings({ mandatoryFrame: frame })}
					billCandidates={billCandidates}
					trackedBillIds={trackedBillIds}
					onToggleBill={toggleBill}
					plan={plan}
					onEdit={onEdit}
					cycleTransactions={cycleTransactions}
					config={{
						statementDay: settings.statementDay,
						reserve: settings.reserve,
						spentOverride: settings.spentOverride,
						paycheckOverride: settings.paycheckOverride,
						fixedOverride: settings.fixedOverride,
						checkingOverride: settings.checkingOverride,
						remainingOverride: settings.remainingOverride,
						paycheckHint: paycheckDerived,
						fixedHint: fixedDerived,
						checkingHint: spendingDerived,
						remainingHint: remainingDerived,
						spentHint: derivedSpent,
						cards: cards.map((card) => ({ id: card.id, name: card.name })),
						trackedIds,
						spendingAccounts: spendableAccounts.map((account) => ({
							id: account.id,
							name: account.name,
						})),
						trackedSpendingIds: spendingIds,
					}}
					onToggleAccount={toggleAccount}
					onToggleSpendingAccount={toggleSpendingAccount}
					onUpdateConfig={updateSettings}
					onResetConfig={resetConfig}
					tab={detail}
					onTabChange={onTabChange}
					transactionOrder={transactionOrder}
					onTransactionOrderChange={setTransactionOrder}
					onClose={() => onDetail(null)}
				/>
			)}
		</section>
	);
}
