import { CalendarDays } from "lucide-react";
import { useMemo, useState } from "react";
import type { BackendCheckpoint } from "@/api/contracts.ts";
import { TextButton } from "@/components/Button.tsx";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "@/domain/transactionSort.ts";
import {
	dateLabel,
	money,
	monthDay,
	shiftDate,
	sum,
	todayIso,
} from "@/domain/format.ts";
import { Skeleton } from "@/components/Skeleton.tsx";
import { Card } from "@/components/Card.tsx";
import {
	cashCushion,
	checkingAccountId,
	checkingShortfall,
	cycleAllowance,
	filterMovementsById,
	mandatoryTransactions,
	monthEndIso,
	nextMonthObligations,
	realizedCheckingOutflows,
	remainingMonthlyObligations,
	spendingBalance,
} from "@/domain/safeSpending.ts";
import { safeSpendingIncome } from "@/domain/safeSpendingIncome.ts";
import type { Plan } from "@/domain/model.ts";
import { visibleAccounts } from "@/domain/model.ts";
import type { Projection } from "@/domain/result.ts";
import { SafeSpendingBillsPanel } from "@/pages/outlook/safe-spending/SafeSpendingBillsPanel.tsx";
import { SafeSpendingConfigurePanel } from "@/pages/outlook/safe-spending/SafeSpendingConfigurePanel.tsx";
import { SafeSpendingCyclePanel } from "@/pages/outlook/safe-spending/SafeSpendingCyclePanel.tsx";
import { SafeSpendingDetailShell } from "@/pages/outlook/safe-spending/SafeSpendingDetailShell.tsx";
import {
	isSafeSpendingCycleTab,
	type SafeSpendingDetailTab,
} from "@/pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import {
	resolveEffectiveIds,
	useSafeSpendingSettings,
} from "@/state/useSafeSpendingSettings.ts";
import { useCardCycleActivity } from "@/pages/outlook/safe-spending/useCardCycleActivity.ts";
import { HouseholdBudgetSummary } from "@/pages/outlook/safe-spending/HouseholdBudgetSummary.tsx";
import { SAFE_SPENDING_LABELS as labels } from "@/pages/outlook/safe-spending/safeSpendingLabels.ts";

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
	const { updateSettings, ...settings } = settingsState;
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
		// Spending cards are debt accounts by convention (`*_card`); loans
		// and other debt fall back to the full set when no card is present.
		const cardLike = cards
			.map((card) => card.id)
			.filter((id) => id.endsWith("_card"));
		const fallback = cardLike.length ? cardLike : cards.map((card) => card.id);
		return resolveEffectiveIds(
			settings.accountIds,
			cards.map((card) => card.id),
			fallback,
		);
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
		const knownIds = spendableAccounts.map((account) => account.id);
		const fallbackId = checkingAccountId(plan);
		const fallback =
			fallbackId && knownIds.includes(fallbackId) ? [fallbackId] : [];
		return resolveEffectiveIds(settings.spendingAccountIds, knownIds, fallback);
	}, [settings.spendingAccountIds, spendableAccounts, plan]);
	const incomeIds = useMemo(() => {
		const knownIds = spendableAccounts.map((account) => account.id);
		const fallbackId = checkingAccountId(plan);
		const fallback =
			fallbackId && knownIds.includes(fallbackId) ? [fallbackId] : [];
		return resolveEffectiveIds(settings.incomeAccountIds, knownIds, fallback);
	}, [settings.incomeAccountIds, spendableAccounts, plan]);
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
			return { total: 0, monthEnd: monthEndIso(displayToday) };
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
	const income = useMemo(
		() =>
			safeSpendingIncome({
				plan,
				movements,
				incomeAccountIds: incomeIds,
				incomeRuleIds: settings.incomeRuleIds,
				todayIso: displayToday,
			}),
		[plan, movements, incomeIds, settings.incomeRuleIds, displayToday],
	);
	const paycheckDerived = income.paycheck;
	// Past cash outflow stays filter-proof: bill toggles shape the bills
	// list only, never the cushion. Direct checking spend always counts here.
	const spentSinceStart = useMemo(
		() =>
			spendingIds.length
				? realizedCheckingOutflows({
						movements,
						checkingIds: spendingIds,
						after: plan.startDate,
						through: displayToday,
					})
				: 0,
		[movements, spendingIds, plan.startDate, displayToday],
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
		const knownIds = billCandidates.map((bill) => bill.id);
		return resolveEffectiveIds(settings.movementIds, knownIds);
	}, [settings.movementIds, billCandidates]);

	const billsStart = shiftDate({ date: displayToday, days: 1 });

	// Bills list shows tracked bills only; one-time purchases live under
	// direct cash spending so the two sections partition upcoming checking
	// outflows with no duplication. Cushion math (remaining/fixed) stays on
	// obligationMovements and is unchanged.
	const billMovements = useMemo(() => {
		const bills = new Set(trackedBillIds);
		return movements.filter((movement) => bills.has(movement.movementId));
	}, [movements, trackedBillIds]);
	const billTransactions = useMemo(() => {
		if (!spendingIds.length) return [];
		return sortTransactionsByDate({
			items: mandatoryTransactions({
				movements: billMovements,
				checkingIds: spendingIds,
				start: billsStart,
				end: cycle.cycleEnd,
				plan,
			}),
			getDate: (transaction) => transaction.date,
			getId: (transaction) => transaction.id,
			order: transactionOrder,
		});
	}, [
		billMovements,
		spendingIds,
		plan,
		billsStart,
		cycle.cycleEnd,
		transactionOrder,
	]);

	// Direct cash spend: checking outflows outside the tracked bill set
	// (one-time purchases plus deselected recurring rules). Card allowance
	// stays card-only; this list lives beside it under cash. The list covers
	// the same upcoming window as bills (after today through cycle end) so
	// section totals stay comparable; past direct spend lives only in the
	// since-balance summary rows, matching past bills.
	const directMovements = useMemo(() => {
		if (!spendingIds.length) return [];
		const bills = new Set(trackedBillIds);
		const sources = new Set(spendingIds);
		return movements.filter(
			(movement) =>
				movement.fromId !== null &&
				sources.has(movement.fromId) &&
				!bills.has(movement.movementId),
		);
	}, [movements, spendingIds, trackedBillIds]);

	const directSpentSinceStart = useMemo(
		() =>
			spendingIds.length
				? realizedCheckingOutflows({
						movements: directMovements,
						checkingIds: spendingIds,
						after: plan.startDate,
						through: displayToday,
					})
				: 0,
		[directMovements, spendingIds, plan.startDate, displayToday],
	);

	const directTransactions = useMemo(() => {
		if (!spendingIds.length) return [];
		return sortTransactionsByDate({
			items: mandatoryTransactions({
				movements: directMovements,
				checkingIds: spendingIds,
				start: billsStart,
				end: cycle.cycleEnd,
				plan,
			}),
			getDate: (transaction) => transaction.date,
			getId: (transaction) => transaction.id,
			order: transactionOrder,
		});
	}, [
		directMovements,
		spendingIds,
		plan,
		billsStart,
		cycle.cycleEnd,
		transactionOrder,
	]);
	if (!cards.length) {
		return (
			<Card aria-label="Safe card spending" className="relative">
				<div className="flex items-center justify-between gap-4">
					<h2 className="m-0 flex min-h-8 items-center gap-2 text-sm font-semibold leading-[1.5] [overflow-wrap:anywhere]">
						<CalendarDays
							size={16}
							className="shrink-0 text-muted"
							aria-hidden="true"
						/>
						Safe card spending
					</h2>
				</div>
				<p className="m-0 text-sm leading-relaxed text-muted">
					Add a debt account to track a card statement cycle here.
				</p>
			</Card>
		);
	}

	const derivedSpent = perAccount.reduce((sum, item) => sum + item.derived, 0);

	const checking = spendingDerived;
	const remainingObligations = remainingDerived.total;
	const cushion = cashCushion({
		checking,
		spentSinceStart,
		remainingObligations,
	});

	const paycheck = paycheckDerived?.amount ?? 0;
	const fixedObligations = fixedDerived.total;
	const spent = derivedSpent;
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
		paycheckEndDate: paycheckDerived?.endDate ?? null,
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

	const toggleIncomeAccount = (accountId: string) => {
		const known = new Set(spendableAccounts.map((account) => account.id));
		const fallbackId = checkingAccountId(plan);
		const fallback = fallbackId && known.has(fallbackId) ? [fallbackId] : [];
		const explicit = settings.incomeAccountIds ?? fallback;
		const next = explicit.includes(accountId)
			? explicit.filter((id) => id !== accountId)
			: [...explicit, accountId];
		updateSettings({ incomeAccountIds: next.length ? next : null });
	};

	const billsSection = {
		title: labels.scheduledBills,
		subtitle: `Scheduled amounts · ${monthDay(billsStart)} – ${monthDay(cycle.cycleEnd)}`,
		total: sum(billTransactions.map((transaction) => transaction.requested)),
		transactions: billTransactions,
	};

	const directSection = {
		title: labels.cashSpending,
		subtitle: "Upcoming non-bill amounts",
		total: sum(directTransactions.map((transaction) => transaction.requested)),
		transactions: directTransactions,
	};
	// Plan-derived frame (header, cycle dates) renders regardless; only the
	// computed safe spending body skeletonizes while the projection is absent.
	if (pending)
		return (
			<Card aria-label="Safe card spending" className="relative">
				<div className="flex items-center justify-between gap-4">
					<h2 className="m-0 flex min-h-8 items-center gap-2 text-sm font-semibold leading-[1.5] [overflow-wrap:anywhere]">
						<CalendarDays
							size={16}
							className="shrink-0 text-muted"
							aria-hidden="true"
						/>
						Safe card spending
					</h2>
				</div>
				<p className="m-0 text-xs">
					{dateLabel(cycle.cycleEnd, true)} · {fullDaysLeft}{" "}
					{fullDaysLeft === 1 ? "day" : "days"} left
					{staleData ? ` · balances ${dateLabel(plan.startDate, true)}` : ""}
				</p>
				<div aria-busy="true">
					<Skeleton className="h-32 w-full" />
				</div>
			</Card>
		);

	return (
		<Card aria-label="Safe card spending" className="relative">
			<button
				type="button"
				className="absolute inset-0 cursor-pointer rounded-surface border-0 bg-transparent p-0"
				onClick={() => onDetail("cycle")}
			>
				<span className="sr-only">Open safe spending details</span>
			</button>
			<div className="flex items-center justify-between gap-4">
				<h2 className="m-0 flex min-h-8 items-center gap-2 text-sm font-semibold leading-[1.5] [overflow-wrap:anywhere]">
					<CalendarDays
						size={16}
						className="shrink-0 text-muted"
						aria-hidden="true"
					/>
					Safe card spending
				</h2>
			</div>
			<p className="m-0 text-xs">
				{dateLabel(cycle.cycleEnd, true)} · {fullDaysLeft}{" "}
				{fullDaysLeft === 1 ? "day" : "days"} left
				{staleData ? ` · balances ${dateLabel(plan.startDate, true)}` : ""}
			</p>
			<div className="flex flex-col">
				<span className="text-xs text-muted">{labels.allowance}</span>
				<strong className="mt-2 text-4xl leading-tight font-medium tracking-tight tabular-nums">
					{money(allowance)}
				</strong>
				<span className="mt-2 text-xs text-muted">
					{allowance >= 0
						? `${money(dailySafe)} a day`
						: `${money(-dailySafe)} a day over`}
				</span>
			</div>
			<div className="grid grid-cols-3 gap-x-4 gap-y-0 border-t border-line pt-4 max-sm:gap-x-3">
				<div className="flex min-w-0 flex-col">
					<span className="mb-2 text-xs text-muted">{labels.cashBalance}</span>
					<strong className="text-xl font-medium tracking-tight whitespace-nowrap tabular-nums max-sm:text-lg">
						{money(checking)}
					</strong>
				</div>
				<div className="flex min-w-0 flex-col border-l border-line pl-4 max-sm:pl-3">
					<span className="mb-2 text-xs text-muted">
						{labels.remainingBills}
					</span>
					<strong className="text-xl font-medium tracking-tight whitespace-nowrap tabular-nums max-sm:text-lg">
						{money(remainingObligations)}
					</strong>
				</div>
				<div className="flex min-w-0 flex-col border-l border-line pl-4 max-sm:pl-3">
					<span className="mb-2 text-xs text-muted">
						{shortWindow.total > 0
							? labels.billShortfall
							: labels.cashAfterBills}
					</span>
					<strong className="text-xl font-medium tracking-tight whitespace-nowrap tabular-nums max-sm:text-lg">
						{money(shortWindow.total > 0 ? -shortWindow.total : cushion)}
					</strong>
				</div>
			</div>
			<div className="relative z-1 flex flex-wrap items-center gap-4 border-t border-line pt-4">
				<TextButton
					onClick={(event) => {
						event.stopPropagation();
						onDetail("cycle");
					}}
				>
					This cycle
				</TextButton>
				<TextButton
					className="ml-auto"
					onClick={(event) => {
						event.stopPropagation();
						onDetail("last-cycle");
					}}
				>
					Last cycle
				</TextButton>
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
						<div className="grid content-start gap-4">
							{detail === "cycle" ? (
								<SafeSpendingBillsPanel
									heroes={heroes}
									cashNow={{
										checking,
										spentSinceStart,
										directSpentSinceStart,
										bills: remainingObligations,
										cushion,
										since: plan.startDate.slice(0, 10),
										monthEnd: remainingDerived.monthEnd,
										short: shortWindow.total,
										firstShort: shortWindow.firstDate,
									}}
									paycheck={paycheckDetails}
									section={billsSection}
									directSection={directSection}
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
							income={income}
							config={{
								statementDay: settings.statementDay,
								reserve: settings.reserve,
								cards: cards.map((card) => ({ id: card.id, name: card.name })),
								trackedIds,
								spendingAccounts: spendableAccounts.map((account) => ({
									id: account.id,
									name: account.name,
								})),
								trackedSpendingIds: spendingIds,
								incomeAccounts: spendableAccounts.map((account) => ({
									id: account.id,
									name: account.name,
								})),
								trackedIncomeIds: incomeIds,
							}}
							billCandidates={billCandidates}
							trackedBillIds={trackedBillIds}
							accounts={plan.accounts}
							onToggleBill={toggleBill}
							onToggleAccount={toggleAccount}
							onToggleSpendingAccount={toggleSpendingAccount}
							onToggleIncomeAccount={toggleIncomeAccount}
							onUpdateConfig={updateSettings}
						/>
					)}
				</SafeSpendingDetailShell>
			)}
		</Card>
	);
}
