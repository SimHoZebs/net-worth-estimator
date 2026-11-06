import { CalendarDays } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import type { BackendCheckpoint } from "@/api/contracts.ts";
import { TextButton } from "@/components/Button.tsx";
import { Notice } from "@/components/Notice.tsx";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "@/domain/transactionSort.ts";
import {
	dateLabel,
	daysBetweenInclusive,
	money,
	shiftDate,
	sum,
	todayIso,
} from "@/domain/format.ts";
import { Skeleton } from "@/components/Skeleton.tsx";
import { Card } from "@/components/Card.tsx";
import {
	checkingAccountId,
	mandatoryTransactions,
	nextMonthRange,
	spendingBalance,
} from "@/domain/safeSpending.ts";

import {
	safeSpendingIncome,
	incomeBundleAfter,
} from "@/domain/safeSpendingIncome.ts";
import {
	safeSpendingResults,
	selectObligationResults,
} from "@/domain/safeSpendingHistory.ts";
import { latestCheckpointsThrough } from "@/api/checkpoints.ts";
import { visibleAccounts } from "@/domain/model.ts";
import type { Projection } from "@/domain/result.ts";
import { useCheckpoints } from "@/state/workspaceResources.ts";
import {
	useSavedAccounts,
	useSavedSchedules,
	useSavedStartDate,
	useSavedTransactions,
} from "@/state/savedState.ts";
import { scheduleToDisplay } from "@/domain/transactionRows.ts";
import { useUserReadOnly } from "@/state/useUserScope.ts";
import { SafeSpendingBillsPanel } from "@/pages/outlook/safe-spending/SafeSpendingBillsPanel.tsx";
import { SafeSpendingConfigurePanel } from "@/pages/outlook/safe-spending/SafeSpendingConfigurePanel.tsx";
import { SafeSpendingCyclePanel } from "@/pages/outlook/safe-spending/SafeSpendingCyclePanel.tsx";
import { SafeSpendingDetailShell } from "@/pages/outlook/safe-spending/SafeSpendingDetailShell.tsx";
import {
	isSafeSpendingCycleTab,
	type SafeSpendingChargeCycle,
	type SafeSpendingCycleTab,
	type SafeSpendingDetailTab,
} from "@/pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import { cycleView } from "@/pages/outlook/safe-spending/cycleView.ts";
import {
	resolveEffectiveIds,
	useSafeSpendingSettings,
} from "@/state/useSafeSpendingSettings.ts";
import { useCardCycleActivity } from "@/pages/outlook/safe-spending/useCardCycleActivity.ts";
import { useOutlookProjection } from "@/pages/outlook/useOutlookProjection.ts";
import { SAFE_SPENDING_LABELS as labels } from "@/pages/outlook/safe-spending/safeSpendingLabels.ts";

// The trend chart pulls the chart engine, so it loads lazily like the
// drawer's copy; the summary numbers render without waiting for it.
const SafeSpendingTrendChart = lazy(() =>
	import("./SafeSpendingTrendChart.tsx").then((module) => ({
		default: module.SafeSpendingTrendChart,
	})),
);

// Stable empty input so pending derivations stay null-safe without
// re-running memos on identity churn.
const EMPTY_TRANSACTIONS: Projection["transactions"] = [];
const EMPTY_CHECKPOINTS: BackendCheckpoint[] = [];

export function SafeSpendingPreview({
	detail,
	onDetail,
	onTabChange,
}: {
	detail: SafeSpendingDetailTab | null;
	onDetail: (tab: SafeSpendingDetailTab | null) => void;
	onTabChange: (tab: SafeSpendingDetailTab) => void;
}) {
	// The preview subscribes to its own queries; TanStack caches share the
	// Outlook forecast instead of receiving it as props.
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const savedRules = useSavedSchedules();
	const startDate = useSavedStartDate();
	const readOnly = useUserReadOnly();
	const checkpoints = useCheckpoints().data?.checkpoints ?? EMPTY_CHECKPOINTS;
	const { base: projection, pending } = useOutlookProjection();
	// Rules are their own rows; bills and income read them through the same
	// display shape as the posting rows.
	const rules = useMemo(
		() => (savedRules ?? []).map(scheduleToDisplay),
		[savedRules],
	);
	// Detail mapping spans both row kinds: projected occurrences of a rule
	// resolve to the rule definition, posted rows to the posting.
	const savedState = useMemo(
		() => [...(transactions ?? []), ...rules],
		[transactions, rules],
	);
	// Hooks stay mounted while rows load, so derivations below are
	// null-safe; the null gate before rendering only skips output.
	const projectionTransactions = projection?.transactions ?? EMPTY_TRANSACTIONS;
	const cards = useMemo(
		() =>
			visibleAccounts(accounts ?? []).filter(
				(account) => account.kind === "debt",
			),
		[accounts],
	);
	const settingsState = useSafeSpendingSettings();
	const { updateSettings, ...settings } = settingsState;
	const [transactionOrder, setTransactionOrder] = useState<TransactionOrder>(
		DEFAULT_TRANSACTION_ORDER,
	);

	// Safe spending display follows the real calendar day so due dates read
	// correctly, while the projection math stays on startDate (the
	// latest balance checkpoint). Never before the projection start.
	const [displayToday] = useState(() => {
		const today = todayIso();
		const start = (startDate ?? today).slice(0, 10);
		return today >= start ? today : start;
	});
	const staleData = displayToday > (startDate ?? displayToday).slice(0, 10);

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
			accounts: accounts ?? [],
			transactions: transactions ?? [],
			startDate: startDate ?? displayToday,
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
			visibleAccounts(accounts ?? []).filter(
				(account) => account.kind !== "debt",
			),
		[accounts],
	);
	const spendingIds = useMemo(() => {
		const knownIds = spendableAccounts.map((account) => account.id);
		const fallbackId = checkingAccountId(accounts ?? []);
		const fallback =
			fallbackId && knownIds.includes(fallbackId) ? [fallbackId] : [];
		return resolveEffectiveIds(settings.spendingAccountIds, knownIds, fallback);
	}, [settings.spendingAccountIds, spendableAccounts, accounts]);
	const incomeIds = useMemo(() => {
		const knownIds = spendableAccounts.map((account) => account.id);
		const fallbackId = checkingAccountId(accounts ?? []);
		const fallback =
			fallbackId && knownIds.includes(fallbackId) ? [fallbackId] : [];
		return resolveEffectiveIds(settings.incomeAccountIds, knownIds, fallback);
	}, [settings.incomeAccountIds, spendableAccounts, accounts]);
	const spendingDerived = useMemo(
		() => spendingBalance(accounts ?? [], spendingIds),
		[accounts, spendingIds],
	);
	const billCandidates = useMemo(() => {
		if (!spendingIds.length) return [];
		return rules
			.filter(
				(rule) => rule.fromId !== null && spendingIds.includes(rule.fromId),
			)
			.map((rule) => ({
				id: rule.id,
				name: rule.name,
				amount: rule.amount,
			}));
	}, [rules, spendingIds]);

	const trackedBillIds = useMemo(() => {
		const knownIds = billCandidates.map((bill) => bill.id);
		return resolveEffectiveIds(settings.transactionIds, knownIds);
	}, [settings.transactionIds, billCandidates]);
	// Posted rows join the projection under the same rule identities. Both
	// cycle tabs read this one stream, so the closed tab sees the paycheck
	// and bills that already happened.
	const historyResults = useMemo(
		() =>
			safeSpendingResults({
				transactions: transactions ?? [],
				rules,
				schedules: savedRules ?? [],
				incomeAccountIds: incomeIds,
				incomeScheduleIds: settings.incomeScheduleIds,
				billScheduleIds: trackedBillIds,
				billWindowStart: closedCycle.start,
				billWindowEnd: nextMonthRange(cycle.cycleEnd).end,
				projectionTransactions,
			}),
		[
			transactions,
			rules,
			savedRules,
			incomeIds,
			settings.incomeScheduleIds,
			trackedBillIds,
			closedCycle.start,
			cycle.cycleEnd,
			projectionTransactions,
		],
	);
	const obligationTransactions = useMemo(
		() =>
			selectObligationResults(
				historyResults,
				settings.transactionIds,
				trackedBillIds,
			),
		[historyResults, settings.transactionIds, trackedBillIds],
	);
	const income = useMemo(
		() =>
			safeSpendingIncome({
				accounts: accounts ?? [],
				rules,
				transactions: projectionTransactions,
				incomeAccountIds: incomeIds,
				incomeScheduleIds: settings.incomeScheduleIds,
				todayIso: displayToday,
			}),
		[
			accounts,
			rules,
			projectionTransactions,
			incomeIds,
			settings.incomeScheduleIds,
			displayToday,
		],
	);
	// Each statement names the payday that settles it. Both tabs read the
	// same posted-plus-projected stream, so the closed statement finds its
	// own payday instead of the upcoming one.
	const currentFunding = useMemo(
		() =>
			incomeBundleAfter({
				accounts: accounts ?? [],
				rules,
				transactions: historyResults,
				incomeAccountIds: incomeIds,
				incomeScheduleIds: settings.incomeScheduleIds,
				afterIso: cycle.cycleEnd,
				todayIso: displayToday,
			}),
		[
			accounts,
			rules,
			historyResults,
			incomeIds,
			settings.incomeScheduleIds,
			cycle.cycleEnd,
			displayToday,
		],
	);
	const closedFunding = useMemo(
		() =>
			incomeBundleAfter({
				accounts: accounts ?? [],
				rules,
				transactions: historyResults,
				incomeAccountIds: incomeIds,
				incomeScheduleIds: settings.incomeScheduleIds,
				afterIso: closedCycle.end,
				todayIso: displayToday,
			}),
		[
			accounts,
			rules,
			historyResults,
			incomeIds,
			settings.incomeScheduleIds,
			closedCycle.end,
			displayToday,
		],
	);

	const billsStart = shiftDate({ date: displayToday, days: 1 });

	// Bills list shows tracked bills only; one-time purchases live under
	// direct cash spending so the two sections partition upcoming checking
	// outflows with no duplication. Cushion math (remaining/fixed) stays on
	// obligationTransactions and is unchanged.
	const billBaseTransactions = useMemo(() => {
		const bills = new Set(trackedBillIds);
		return historyResults.filter((transaction) =>
			bills.has(transaction.transactionId),
		);
	}, [historyResults, trackedBillIds]);
	// Direct cash spend: checking outflows outside the tracked bill set.
	// Only genuine one-time postings belong here; occurrences owned by a
	// recurrence rule stay out even when the rule is deselected, since the
	// rule (not this list) owns its schedule. Card allowance stays
	// card-only; this list lives beside it under cash. The list covers the
	// same upcoming window as bills (after today through cycle end) so
	// section totals stay comparable; past direct spend lives only in the
	// since-balance summary rows, matching past bills.
	const directBaseTransactions = useMemo(() => {
		if (!spendingIds.length) return [];
		const bills = new Set(trackedBillIds);
		const ruleIds = new Set(rules.map((rule) => rule.id));
		const sources = new Set(spendingIds);
		return historyResults.filter(
			(transaction) =>
				transaction.fromId !== null &&
				sources.has(transaction.fromId) &&
				!bills.has(transaction.transactionId) &&
				!ruleIds.has(transaction.transactionId),
		);
	}, [historyResults, spendingIds, trackedBillIds, rules]);

	const directTransactions = useMemo(() => {
		if (!spendingIds.length) return [];
		return sortTransactionsByDate({
			items: mandatoryTransactions({
				transactions: directBaseTransactions,
				checkingIds: spendingIds,
				start: cycle.cycleStart,
				end: cycle.cycleEnd,
				accounts: accounts ?? [],
				savedTransactions: transactions ?? [],
			}),
			getDate: (transaction) => transaction.date,
			getId: (transaction) => transaction.id,
			order: transactionOrder,
		});
	}, [
		directBaseTransactions,
		spendingIds,
		accounts,
		transactions,
		cycle.cycleStart,
		cycle.cycleEnd,
		transactionOrder,
	]);

	// Card charges and direct cash share one list so spending never reads
	// as two ledgers. Cards contribute recorded outflows since the cycle
	// start; direct cash covers the whole statement cycle. Funding stays
	// split (allowance for cards, cushion for cash); only the rows merge.
	const lastAtClose = latestCheckpointsThrough(checkpoints, closedCycle.end);
	const lastComplete =
		spendingIds.length > 0 && spendingIds.every((id) => lastAtClose.has(id));
	const lastChecking = lastComplete
		? sum(spendingIds.map((id) => lastAtClose.get(id)?.Balance ?? 0))
		: spendingDerived;
	const currentCardTransactions = perAccount.flatMap((item) => item.inCycle);
	const lastCardTransactions = perAccount.flatMap((item) => item.lastCycle);
	const currentCardByCard = perAccount.map((item) => ({
		id: item.accountId,
		name: item.name,
		amount: sum(item.inCycle.map((transaction) => transaction.amount)),
	}));
	const currentCardSpent = sum(currentCardByCard.map((card) => card.amount));
	const currentView = cycleView({
		cycle: { start: cycle.cycleStart, end: cycle.cycleEnd },
		referenceDay: displayToday,
		checking: spendingDerived,
		spentSince: (startDate ?? displayToday).slice(0, 10),
		spentThrough: displayToday,
		spendingIds,
		results: historyResults,
		obligationResults: obligationTransactions,
		directResults: directBaseTransactions,
		billResults: billBaseTransactions,
		billWindowStart: billsStart,
		incomeScheduleIds: settings.incomeScheduleIds,
		cardTransactions: currentCardTransactions,
		cardSpent: currentCardSpent,
		cardSpentByCard: currentCardByCard,
		funding: {
			paycheck: currentFunding?.amount ?? 0,
			date: currentFunding?.date ?? null,
			endDate: currentFunding?.endDate ?? null,
			fixedBills: 0,
		},
		reserve: settings.reserve,
		accounts: accounts ?? [],
		savedTransactions: transactions ?? [],
		transactionOrder,
		closedCycle,
		fullDaysLeft: Math.max(1, cycle.daysLeft - 1),
	});
	const lastView = cycleView({
		cycle: { start: closedCycle.start, end: closedCycle.end },
		referenceDay: closedCycle.end,
		checking: lastChecking,
		spentSince: closedCycle.end,
		spentThrough: closedCycle.end,
		spendingIds,
		results: historyResults,
		obligationResults: obligationTransactions,
		directResults: directBaseTransactions,
		billResults: billBaseTransactions,
		billWindowStart: closedCycle.start,
		incomeScheduleIds: settings.incomeScheduleIds,
		cardTransactions: lastCardTransactions,
		cardSpent: closedCycle.total,
		cardSpentByCard: closedCycle.cards.map((card) => ({
			id: card.id,
			name: card.name,
			amount: card.amount,
		})),
		funding: {
			paycheck: closedFunding?.amount ?? 0,
			date: closedFunding?.date ?? null,
			endDate: closedFunding?.endDate ?? null,
			fixedBills: 0,
		},
		reserve: settings.reserve,
		accounts: accounts ?? [],
		savedTransactions: transactions ?? [],
		transactionOrder,
		closedCycle,
		provisional: !lastComplete,
		fullDaysLeft: daysBetweenInclusive(closedCycle.start, closedCycle.end),
		closed: true,
	});

	const tabChargeCycles = useMemo<
		Record<SafeSpendingCycleTab, SafeSpendingChargeCycle>
	>(() => {
		const spending = sortTransactionsByDate({
			items: [...chargeCycles.cycle.transactions, ...directTransactions],
			getDate: (transaction) => transaction.date,
			getId: (transaction) => transaction.id,
			order: transactionOrder,
		});
		return {
			...chargeCycles,
			cycle: {
				...chargeCycles.cycle,
				title: labels.cycleSpending,
				emptyMessage: "No spending this cycle yet.",
				transactions: spending,
				thresholds: {
					safetyNetDate:
						currentView.trend.safetyNetHit &&
						!currentView.trend.safetyNetHit.projected
							? currentView.trend.safetyNetHit.date
							: null,
					limitDate:
						currentView.trend.limitHit && !currentView.trend.limitHit.projected
							? currentView.trend.limitHit.date
							: null,
				},
			},
		};
	}, [chargeCycles, directTransactions, transactionOrder, currentView.trend]);
	// Saved rows gate rendering, not hooks: every subscription above stays
	// mounted while rows load.
	if (!accounts || !transactions || savedRules === null || !startDate)
		return <SafeSpendingSkeleton />;
	if (settingsState.pending) return <SafeSpendingSkeleton />;
	if (settingsState.error)
		return (
			<Notice tone="danger" aria-label="Safe card spending settings">
				<span>Budget settings could not be loaded.</span>
				<TextButton onClick={settingsState.retry}>Retry</TextButton>
			</Notice>
		);
	if (!projection && !pending) return null;
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

	const checking = currentView.view.cashNow.checking;
	const remainingObligations = currentView.view.cashNow.bills;
	const cushion = currentView.view.cashNow.cushion;
	const allowance = currentView.view.allocation.allowance;
	const heroes = currentView.view.heroes;
	const { fullDaysLeft, dailySafe } = heroes;

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

	const toggleBill = (transactionId: string) => {
		const explicit =
			settings.transactionIds ?? billCandidates.map((bill) => bill.id);
		const next = explicit.includes(transactionId)
			? explicit.filter((id) => id !== transactionId)
			: [...explicit, transactionId];
		updateSettings({
			transactionIds:
				next.length === billCandidates.length || next.length === 0
					? null
					: next,
		});
	};

	const toggleSpendingAccount = (accountId: string) => {
		const known = new Set(spendableAccounts.map((account) => account.id));
		const fallbackId = checkingAccountId(accounts);
		const fallback = fallbackId && known.has(fallbackId) ? [fallbackId] : [];
		const explicit = settings.spendingAccountIds ?? fallback;
		const next = explicit.includes(accountId)
			? explicit.filter((id) => id !== accountId)
			: [...explicit, accountId];
		updateSettings({ spendingAccountIds: next.length ? next : null });
	};

	const toggleIncomeAccount = (accountId: string) => {
		const known = new Set(spendableAccounts.map((account) => account.id));
		const fallbackId = checkingAccountId(accounts);
		const fallback = fallbackId && known.has(fallbackId) ? [fallbackId] : [];
		const explicit = settings.incomeAccountIds ?? fallback;
		const next = explicit.includes(accountId)
			? explicit.filter((id) => id !== accountId)
			: [...explicit, accountId];
		updateSettings({ incomeAccountIds: next.length ? next : null });
	};

	// Saved-data frame (header, cycle dates) renders regardless; only the
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
					{staleData ? ` · balances ${dateLabel(startDate, true)}` : ""}
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
				{staleData ? ` · balances ${dateLabel(startDate, true)}` : ""}
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
						{currentView.view.cashNow.short > 0
							? labels.billShortfall
							: labels.cashAfterBills}
					</span>
					<strong className="text-xl font-medium tracking-tight whitespace-nowrap tabular-nums max-sm:text-lg">
						{money(
							currentView.view.cashNow.short > 0
								? -currentView.view.cashNow.short
								: cushion,
						)}
					</strong>
				</div>
			</div>
			<Suspense
				fallback={
					<div aria-busy="true">
						<Skeleton className="h-48 w-full" />
					</div>
				}
			>
				<div className="relative z-1 border-t border-line pt-4">
					<SafeSpendingTrendChart trend={currentView.trend} />
				</div>
			</Suspense>
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
						Object.entries(tabChargeCycles).map(([id, entry]) => [
							id,
							entry.transactions.length,
						]),
					)}
					range={
						isSafeSpendingCycleTab(detail) ? tabChargeCycles[detail] : undefined
					}
					onClose={() => onDetail(null)}
				>
					{isSafeSpendingCycleTab(detail) && (
						<div className="grid content-start gap-4">
							<SafeSpendingBillsPanel
								heroes={
									detail === "cycle"
										? currentView.view.heroes
										: lastView.view.heroes
								}
								cashNow={
									detail === "cycle"
										? currentView.view.cashNow
										: lastView.view.cashNow
								}
								allocation={
									detail === "cycle"
										? currentView.view.allocation
										: lastView.view.allocation
								}
								funding={
									detail === "cycle"
										? currentView.view.funding
										: lastView.view.funding
								}
								trend={detail === "cycle" ? currentView.trend : lastView.trend}
								section={
									detail === "cycle" ? currentView.section : lastView.section
								}
								closed={detail === "last-cycle"}
								accounts={accounts}
								transactions={savedState}
								readOnly={readOnly}
								transactionOrder={transactionOrder}
								onTransactionOrderChange={setTransactionOrder}
							/>
							<SafeSpendingCyclePanel
								key={detail}
								cycle={tabChargeCycles[detail]}
								accounts={accounts}
								transactions={savedState}
								readOnly={readOnly}
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
							accounts={accounts}
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

/** Reserve the summary card while saved rows or settings hydrate. */
function SafeSpendingSkeleton() {
	return (
		<div
			className="rounded-surface border border-line bg-surface p-5"
			aria-busy="true"
			aria-label="Loading safe card spending"
		>
			<div className="flex items-center gap-2">
				<Skeleton className="size-4" />
				<Skeleton className="h-4 w-40" />
			</div>
			<Skeleton className="mt-4 h-3 w-64" />
			<Skeleton className="mt-2 h-3 w-52" />
			<Skeleton className="mt-6 h-8 w-44" />
			<div className="mt-6 grid grid-cols-3 gap-4 max-sm:grid-cols-1">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		</div>
	);
}
