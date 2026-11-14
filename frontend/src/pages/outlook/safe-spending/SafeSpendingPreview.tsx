import { CalendarDays } from "lucide-react";
import { useMemo, useState } from "react";
import type { BackendCheckpoint } from "@/api/contracts.ts";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "@/domain/transactionSort.ts";
import {
	dateLabel,
	daysBetweenInclusive,
	shiftDate,
	sum,
	todayIso,
} from "@/domain/format.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import {
	checkingAccountId,
	mandatoryTransactions,
	spendingBalance,
	nextMonthRange,
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
	SAFE_SPENDING_DETAIL_TABS,
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
	// display shape as the transaction rows.
	const rules = useMemo(
		() => (savedRules ?? []).map(scheduleToDisplay),
		[savedRules],
	);
	// Detail mapping spans both row kinds: projected occurrences of a rule
	// resolve to the rule definition, posted rows to the transaction.
	const savedState = useMemo(
		() => [...(transactions ?? []), ...rules],
		[transactions, rules],
	);
	// Hooks stay mounted while rows load, so derivations below are
	// null-safe; the null gate before rendering only skips output.
	const projectionTransactions = projection?.transactions ?? EMPTY_TRANSACTIONS;
	const candidateAccounts = useMemo(
		() => visibleAccounts(accounts ?? []),
		[accounts],
	);
	const settingsState = useSafeSpendingSettings();
	const { updateSettings, ...settings } = settingsState;
	const [transactionOrder, setTransactionOrder] = useState<TransactionOrder>(
		DEFAULT_TRANSACTION_ORDER,
	);
	// The cycle views render inline on the page; the drawer keeps the
	// per-cycle transaction lists and Configure. This tab switches cycles
	// inline only and never opens the drawer.
	const [cycleViewTab, setCycleViewTab] =
		useState<SafeSpendingCycleTab>("cycle");

	// Safe spending display follows the real calendar day so due dates read
	// correctly, while the projection math stays on startDate (the
	// latest balance checkpoint). Never before the projection start.
	const [displayToday] = useState(() => {
		const today = todayIso();
		const start = (startDate ?? today).slice(0, 10);
		return today >= start ? today : start;
	});
	const staleData = displayToday > (startDate ?? displayToday).slice(0, 10);

	// Tracked cards are a user designation across every account. Before one
	// is made, the default set stays the model's card accounts: `*_card`
	// debt accounts, else debt accounts.
	const defaultCardIds = useMemo(() => {
		const debtAccounts = candidateAccounts.filter(
			(account) => account.kind === "debt",
		);
		const cardLike = debtAccounts
			.map((account) => account.id)
			.filter((id) => id.endsWith("_card"));
		return cardLike.length
			? cardLike
			: debtAccounts.map((account) => account.id);
	}, [candidateAccounts]);
	const trackedIds = useMemo(
		() =>
			resolveEffectiveIds(
				settings.accountIds,
				candidateAccounts.map((account) => account.id),
				defaultCardIds,
			),
		[settings.accountIds, candidateAccounts, defaultCardIds],
	);

	const { cycle, closedCycle, perAccount, chargeCycles } = useCardCycleActivity(
		{
			accounts: accounts ?? [],
			transactions: transactions ?? [],
			startDate: startDate ?? displayToday,
			checkpoints,
			projection,
			cards: candidateAccounts,
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
				projectionTransactions,
				schedules: savedRules ?? [],
				billScheduleIds: trackedBillIds,
				billWindowStart: closedCycle.start,
				billWindowEnd: nextMonthRange(cycle.cycleEnd).end,
				rules,
				incomeAccountIds: incomeIds,
				incomeScheduleIds: settings.incomeScheduleIds,
			}),
		[
			transactions,
			projectionTransactions,
			savedRules,
			trackedBillIds,
			closedCycle.start,
			cycle.cycleEnd,
			rules,
			incomeIds,
			settings.incomeScheduleIds,
		],
	);
	const obligationTransactions = useMemo(
		() => selectObligationResults(historyResults, settings.transactionIds),
		[historyResults, settings.transactionIds],
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

	// Bills show tracked bills only; purchases live under direct cash to avoid duplication.
	const billBaseTransactions = useMemo(() => {
		const bills = new Set(trackedBillIds);
		return historyResults.filter((transaction) =>
			bills.has(transaction.transactionId),
		);
	}, [historyResults, trackedBillIds]);
	// Direct cash is checking outflows outside the bill set and outside recurrence rules.
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

	// Card and direct cash share one list; only the rows merge.
	const lastAtClose = latestCheckpointsThrough(checkpoints, closedCycle.end);
	const lastComplete =
		spendingIds.length > 0 && spendingIds.every((id) => lastAtClose.has(id));
	const lastChecking = lastComplete
		? sum(spendingIds.map((id) => lastAtClose.get(id)?.Balance ?? 0))
		: spendingDerived;
	const currentCardTransactions = useMemo(
		() => perAccount.flatMap((item) => item.inCycle),
		[perAccount],
	);
	const lastCardTransactions = useMemo(
		() => perAccount.flatMap((item) => item.lastCycle),
		[perAccount],
	);
	const currentCardByCard = useMemo(
		() =>
			perAccount.map((item) => ({
				id: item.accountId,
				name: item.name,
				amount: sum(item.inCycle.map((transaction) => transaction.amount)),
			})),
		[perAccount],
	);
	const currentCardSpent = useMemo(
		() => sum(currentCardByCard.map((card) => card.amount)),
		[currentCardByCard],
	);
	const currentView = useMemo(
		() =>
			cycleView({
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
			}),
		[
			cycle.cycleStart,
			cycle.cycleEnd,
			cycle.daysLeft,
			displayToday,
			spendingDerived,
			startDate,
			spendingIds,
			historyResults,
			obligationTransactions,
			directBaseTransactions,
			billBaseTransactions,
			billsStart,
			settings.incomeScheduleIds,
			currentCardTransactions,
			currentCardSpent,
			currentCardByCard,
			currentFunding,
			settings.reserve,
			accounts,
			transactions,
			transactionOrder,
			closedCycle,
		],
	);
	const lastView = useMemo(
		() =>
			cycleView({
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
			}),
		[
			closedCycle,
			lastChecking,
			spendingIds,
			historyResults,
			obligationTransactions,
			directBaseTransactions,
			billBaseTransactions,
			settings.incomeScheduleIds,
			lastCardTransactions,
			closedFunding,
			settings.reserve,
			accounts,
			transactions,
			transactionOrder,
			lastComplete,
		],
	);

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
				summary: {
					total: currentView.view.heroes.committedTotal,
					byCard: currentView.view.heroes.committedByCard,
				},
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
			"last-cycle": {
				...chargeCycles["last-cycle"],
				summary: {
					total: lastView.view.heroes.committedTotal,
					byCard: lastView.view.heroes.committedByCard,
				},
			},
		};
	}, [chargeCycles, directTransactions, transactionOrder, currentView, lastView]);
	// Saved rows hydrate after the card header. The header renders
	// immediately; only the computed body waits for rows, settings,
	// and the forecast.
	const savedRowsPending =
		!accounts || !transactions || savedRules === null || !startDate;
	if (settingsState.error)
		return (
			<Alert variant="destructive" aria-label="Safe card spending settings">
				<AlertDescription>Budget settings could not be loaded.</AlertDescription>
				<Button variant="link" onClick={settingsState.retry}>
					Retry
				</Button>
			</Alert>
		);
	if (!projection && !pending) return null;

	const { fullDaysLeft } = currentView.view.heroes;
	const inlineView = cycleViewTab === "cycle" ? currentView : lastView;

	const toggleAccount = (accountId: string) => {
		const explicit = settings.accountIds ?? defaultCardIds;
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
		const fallbackId = checkingAccountId(accounts ?? []);
		const fallback = fallbackId && known.has(fallbackId) ? [fallbackId] : [];
		const explicit = settings.spendingAccountIds ?? fallback;
		const next = explicit.includes(accountId)
			? explicit.filter((id) => id !== accountId)
			: [...explicit, accountId];
		updateSettings({ spendingAccountIds: next.length ? next : null });
	};

	const toggleIncomeAccount = (accountId: string) => {
		const known = new Set(spendableAccounts.map((account) => account.id));
		const fallbackId = checkingAccountId(accounts ?? []);
		const fallback = fallbackId && known.has(fallbackId) ? [fallbackId] : [];
		const explicit = settings.incomeAccountIds ?? fallback;
		const next = explicit.includes(accountId)
			? explicit.filter((id) => id !== accountId)
			: [...explicit, accountId];
		updateSettings({ incomeAccountIds: next.length ? next : null });
	};

	// Saved-data frame (header, cycle dates) renders regardless; only the
	// computed safe spending body skeletonizes while rows, settings, or the
	// projection are absent.
	if (savedRowsPending || settingsState.pending || pending)
		return (
			<Card role="region" aria-label="Safe card spending" className="relative">
				<div className="flex items-center justify-between gap-4">
					<CardTitle className="m-0 flex min-h-8 items-center gap-2 text-sm font-semibold leading-[1.5] [overflow-wrap:anywhere]">
						<CalendarDays
							size={16}
							className="shrink-0 text-muted"
							aria-hidden="true"
						/>
						Safe card spending
					</CardTitle>
				</div>
				<p className="m-0 text-xs">
					{dateLabel(cycle.cycleEnd, true)} · {fullDaysLeft}{" "}
					{fullDaysLeft === 1 ? "day" : "days"} left
					{staleData
						? ` · balances ${dateLabel(startDate ?? displayToday, true)}`
						: ""}
				</p>
				<div aria-busy="true">
					<Skeleton className="h-32 w-full" />
				</div>
			</Card>
		);

	return (
		<Card role="region" aria-label="Safe card spending" className="relative">
			<div className="flex items-center justify-between gap-4">
				<CardTitle className="m-0 flex min-h-8 items-center gap-2 text-sm font-semibold leading-[1.5] [overflow-wrap:anywhere]">
					<CalendarDays
						size={16}
						className="shrink-0 text-muted"
						aria-hidden="true"
					/>
					Safe card spending
				</CardTitle>
				{trackedIds.length > 0 && (
					<Button variant="link" onClick={() => onDetail("configure")}>
						Configure
					</Button>
				)}
			</div>
			{trackedIds.length > 0 ? (
				<>
					<p className="m-0 text-xs">
						{dateLabel(cycle.cycleEnd, true)} · {fullDaysLeft}{" "}
						{fullDaysLeft === 1 ? "day" : "days"} left
						{staleData
							? ` · balances ${dateLabel(startDate ?? displayToday, true)}`
							: ""}
					</p>
					<ToggleGroup
						aria-label="Safe card spending cycle view"
						value={[cycleViewTab]}
						onValueChange={(next) => {
							const nextValue = next.find(
								(candidate) => candidate !== cycleViewTab,
							);
							if (nextValue !== undefined)
								setCycleViewTab(nextValue as SafeSpendingCycleTab);
						}}
						className="mb-4 inline-flex gap-0.5 rounded-control border border-line bg-surface-2 p-1"
					>
						{SAFE_SPENDING_DETAIL_TABS.filter(
							(
								item,
							): item is Extract<
								(typeof SAFE_SPENDING_DETAIL_TABS)[number],
								{ view: "charges" }
							> => isSafeSpendingCycleTab(item.id),
						).map((item) => (
							<ToggleGroupItem
								key={item.id}
								value={item.id}
								className="h-auto rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted pointer-coarse:min-h-12 aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs focus-visible:outline-solid focus-visible:ring-0 data-[state=on]:bg-surface"
							>
								{item.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<SafeSpendingBillsPanel
						heroes={inlineView.view.heroes}
						cashNow={inlineView.view.cashNow}
						allocation={inlineView.view.allocation}
						funding={inlineView.view.funding}
						trend={inlineView.trend}
						section={inlineView.section}
						closed={cycleViewTab === "last-cycle"}
						accounts={accounts ?? []}
						transactions={savedState}
						readOnly={readOnly}
						transactionOrder={transactionOrder}
						onTransactionOrderChange={setTransactionOrder}
					/>
					<div className="flex flex-wrap items-center gap-4 border-t border-line pt-4">
						<Button variant="link" onClick={() => onDetail("cycle")}>
							This cycle transactions
						</Button>
						<Button
							variant="link"
							className="ml-auto"
							onClick={() => onDetail("last-cycle")}
						>
							Last cycle transactions
						</Button>
					</div>
				</>
			) : (
				<div className="grid gap-3">
					<p className="m-0 text-sm leading-relaxed text-muted">
						Its statement cycle, spending, and balance settle here.
					</p>
					<Button variant="link" onClick={() => onDetail("configure")}>
						Choose a card
					</Button>
				</div>
			)}
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
						<SafeSpendingCyclePanel
							key={detail}
							cycle={tabChargeCycles[detail]}
							accounts={accounts ?? []}
							transactions={savedState}
							readOnly={readOnly}
							transactionOrder={transactionOrder}
							onTransactionOrderChange={setTransactionOrder}
						/>
					)}
					{detail === "configure" && (
						<SafeSpendingConfigurePanel
							income={income}
							config={{
								statementDay: settings.statementDay,
								reserve: settings.reserve,
								cards: candidateAccounts.map((account) => ({
									id: account.id,
									name: account.name,
								})),
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
							accounts={accounts ?? []}
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
