import { CalendarDays } from "lucide-react";
import { useMemo, useState } from "react";
import type { BackendCheckpoint } from "../../../api/contracts.ts";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "../../../domain/transactionSort.ts";
import {
	dateLabel,
	money,
	shiftDate,
	sum,
	todayIso,
} from "../../../domain/format.ts";
import { Skeleton } from "../../../components/ui.tsx";
import {
	cashCushion,
	checkingAccountId,
	checkingShortfall,
	cycleAllowance,
	filterMovementsById,
	mandatoryTransactions,
	nextMonthObligations,
	nextPaycheck,
	realizedCheckingOutflows,
	remainingMonthlyObligations,
	spendingBalance,
} from "../../../domain/safeSpending.ts";
import type { Plan } from "../../../domain/model.ts";
import { visibleAccounts } from "../../../domain/model.ts";
import type { Projection } from "../../../domain/result.ts";
import { SafeSpendingBillsPanel } from "./SafeSpendingBillsPanel.tsx";
import { SafeSpendingConfigurePanel } from "./SafeSpendingConfigurePanel.tsx";
import { SafeSpendingCyclePanel } from "./SafeSpendingCyclePanel.tsx";
import { SafeSpendingDetailShell } from "./SafeSpendingDetailShell.tsx";
import {
	isSafeSpendingCycleTab,
	type SafeSpendingDetailTab,
} from "./safeSpendingDetailModel.ts";
import { useSafeSpendingSettings } from "../../../state/useSafeSpendingSettings.ts";
import { useCardCycleActivity } from "./useCardCycleActivity.ts";
import { HouseholdBudgetSummary } from "./HouseholdBudgetSummary.tsx";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

// Stable empty input so pending derivations stay null-safe without
// re-running memos on identity churn.
const EMPTY_MOVEMENTS: Projection["movements"] = [];

export function SafeSpendingPreview({
	plan,
	checkpoints,
	projection,
	pending = false,
	detail,
	onDetail,
	onTabChange,
}: {
	plan: Plan;
	checkpoints: BackendCheckpoint[];
	projection: Projection | null;
	pending?: boolean;
	detail: SafeSpendingDetailTab | null;
	onDetail: (tab: SafeSpendingDetailTab | null) => void;
	onTabChange: (tab: SafeSpendingDetailTab) => void;
}) {
	const movements = projection?.movements ?? EMPTY_MOVEMENTS;
	const cards = useMemo(
		() =>
			visibleAccounts(plan.accounts).filter(
				(account) => account.kind === "debt",
			),
		[plan.accounts],
	);
	const settingsState = useSafeSpendingSettings();
	const { updateSettings, resetConfig, ...settings } = settingsState;
	const [transactionOrder, setTransactionOrder] = useState<TransactionOrder>(
		DEFAULT_TRANSACTION_ORDER,
	);

	// Safe spending display follows the real calendar day so due dates read
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

	const { cycle, closedCycle, perAccount, chargeCycles } = useCardCycleActivity(
		{
			plan,
			checkpoints,
			projection,
			cards,
			trackedIds,
			statementDay: settings.statementDay,
			displayToday,
			transactionOrder,
		},
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

	const billTransactions = useMemo(() => {
		if (!spendingIds.length) return [];
		return sortTransactionsByDate({
			items: mandatoryTransactions({
				movements: obligationMovements,
				checkingIds: spendingIds,
				start: shiftDate({ date: displayToday, days: 1 }),
				end: cycle.cycleEnd,
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
		displayToday,
		cycle.cycleEnd,
		transactionOrder,
	]);
	if (!cards.length) {
		return (
			<section
				className="safe-spending-preview"
				aria-label="Safe card spending"
			>
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
		closedCycle,
		committedTotal: spent,
		recordedTotal: derivedSpent,
		committedByCard: perAccount.map((item) => ({
			id: item.accountId,
			name: item.name,
			amount: item.derived,
		})),
		paycheckAmount: paycheck,
		paycheckDate: paycheckDerived?.date ?? null,
		fixedAmount: fixedObligations,
		reserveAmount: settings.reserve,
	};
	const paycheckDetails = {
		paycheck,
		fixed: fixedObligations,
		reserve: settings.reserve,
		spent,
		allowance,
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

	const billsSection = {
		title: labels.scheduledBills,
		subtitle: "Scheduled amounts",
		total: sum(billTransactions.map((transaction) => transaction.requested)),
		transactions: billTransactions,
	};
	// Plan-derived frame (header, cycle dates) renders regardless; only the
	// computed safe spending body skeletonizes while the projection is absent.
	if (pending)
		return (
			<section
				className="safe-spending-preview"
				aria-label="Safe card spending"
			>
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
		<section className="safe-spending-preview" aria-label="Safe card spending">
			<button
				type="button"
				className="safe-spending-open"
				onClick={() => onDetail("cycle")}
			>
				<span className="sr-only">Open safe spending details</span>
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
				<span>{labels.allowance}</span>
				<strong className="type-value">{money(allowance)}</strong>
				<span>
					{allowance >= 0
						? `${money(dailySafe)} a day`
						: `${money(-dailySafe)} a day over`}
				</span>
			</div>
			<div className="cycle-remaining">
				<div>
					<span>{labels.cashBalance}</span>
					<strong>{money(checking)}</strong>
				</div>
				<div>
					<span>{labels.remainingBills}</span>
					<strong>{money(remainingObligations)}</strong>
				</div>
				<div>
					<span>
						{shortWindow.total > 0
							? labels.billShortfall
							: labels.cashAfterBills}
					</span>
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
						onDetail("cycle");
					}}
				>
					This cycle
				</button>
				<button
					type="button"
					className="text-button"
					onClick={(event) => {
						event.stopPropagation();
						onDetail("last-cycle");
					}}
				>
					Last cycle
				</button>
			</div>
			{detail && (
				<SafeSpendingDetailShell
					tab={detail}
					onTabChange={onTabChange}
					cycleCounts={Object.fromEntries(
						Object.entries(chargeCycles).map(([id, entry]) => [
							id,
							entry.transactions.length,
						]),
					)}
					range={
						isSafeSpendingCycleTab(detail) ? chargeCycles[detail] : undefined
					}
					onClose={() => onDetail(null)}
				>
					{isSafeSpendingCycleTab(detail) && (
						<div className="safe-spending-mandatory">
							{detail === "cycle" ? (
								<SafeSpendingBillsPanel
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
									paycheck={paycheckDetails}
									section={billsSection}
									plan={plan}
									transactionOrder={transactionOrder}
									onTransactionOrderChange={setTransactionOrder}
								/>
							) : (
								<HouseholdBudgetSummary
									heroes={heroes}
									paycheck={paycheckDetails}
								/>
							)}
							<SafeSpendingCyclePanel
								key={detail}
								cycle={chargeCycles[detail]}
								plan={plan}
								transactionOrder={transactionOrder}
								onTransactionOrderChange={setTransactionOrder}
							/>
						</div>
					)}
					{detail === "configure" && (
						<SafeSpendingConfigurePanel
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
							billCandidates={billCandidates}
							trackedBillIds={trackedBillIds}
							accounts={plan.accounts}
							onToggleBill={toggleBill}
							onToggleAccount={toggleAccount}
							onToggleSpendingAccount={toggleSpendingAccount}
							onUpdateConfig={updateSettings}
							onResetConfig={resetConfig}
						/>
					)}
				</SafeSpendingDetailShell>
			)}
		</section>
	);
}
