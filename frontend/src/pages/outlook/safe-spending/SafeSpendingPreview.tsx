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
import { sum, todayIso } from "@/domain/format.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card.tsx";
import {
	checkingAccountId,
	monthEndIso,
	nextMonthRange,
} from "@/domain/safeSpending.ts";

import {
	safeSpendingResults,
	selectObligationResults,
} from "@/domain/safeSpendingHistory.ts";
import { visibleAccounts } from "@/domain/model.ts";
import { spendingLedger, spendingAmount } from "@/domain/safeSpendingTrend.ts";
import {
	currentCashActivity,
	currentSpendingActivity,
} from "./currentCashActivity.ts";
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
	cycleCaption,
	isSafeSpendingCycleTab,
	type SafeSpendingChargeCycle,
	type SafeSpendingCycleTab,
	type SafeSpendingDetailTab,
} from "@/pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import { cycleView } from "@/pages/outlook/safe-spending/cycleView.ts";
import { historicalCycleView } from "@/pages/outlook/safe-spending/historicalCycleView.ts";
import {
	resolveEffectiveIds,
	useSafeSpendingSettings,
} from "@/state/useSafeSpendingSettings.ts";
import { useCardCycleActivity } from "@/pages/outlook/safe-spending/useCardCycleActivity.ts";
import { useOutlookProjection } from "@/pages/outlook/useOutlookProjection.ts";
import { SAFE_SPENDING_LABELS as labels } from "@/pages/outlook/safe-spending/safeSpendingLabels.ts";
import { useSafeSpendingSummary } from "@/state/useSafeSpendingSummary.ts";
import { SafeSpendingCashEvidence } from "./SafeSpendingCashEvidence.tsx";
import {
	expectedMonthlyIncome,
	incomeSourceCandidates,
} from "@/domain/safeSpendingIncome.ts";
import { recurringBillIncreases } from "@/domain/recurringBillIncreases.ts";

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
	// Current cash stays mounted even while the inline view shows Last cycle.
	// The independently opened This-cycle drawer must never borrow close cash.
	const currentCashSummary = useSafeSpendingSummary(
		displayToday,
		monthEndIso(displayToday),
	);
	const closedCashSummary = useSafeSpendingSummary(
		closedCycle.end,
		closedCycle.end,
		cycleViewTab === "last-cycle",
	);
	const cashSummary =
		cycleViewTab === "cycle" ? currentCashSummary : closedCashSummary;

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
	const incomeCandidates = useMemo(
		() =>
			incomeSourceCandidates({
				accounts: accounts ?? [],
				rules,
				spendingIds,
				incomeScheduleIds: settings.incomeScheduleIds,
				today: displayToday,
			}),
		[accounts, rules, spendingIds, settings.incomeScheduleIds, displayToday],
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
			}),
		[
			transactions,
			projectionTransactions,
			savedRules,
			trackedBillIds,
			closedCycle.start,
			cycle.cycleEnd,
		],
	);
	const obligationTransactions = useMemo(
		() => selectObligationResults(historyResults, settings.transactionIds),
		[historyResults, settings.transactionIds],
	);
	const directTransactions = useMemo(() => {
		return sortTransactionsByDate({
			items: currentSpendingActivity(
				currentCashActivity({
					accounts: accounts ?? [],
					transactions: transactions ?? [],
					spendingIds,
					cycleStart:
						cycle.cycleStart < `${displayToday.slice(0, 7)}-01`
							? cycle.cycleStart
							: `${displayToday.slice(0, 7)}-01`,
					cycleEnd: cycle.cycleEnd,
					today: displayToday,
				}),
				transactions ?? [],
			),
			getDate: (transaction) => transaction.date,
			getId: (transaction) => transaction.id,
			order: transactionOrder,
		});
	}, [
		displayToday,
		spendingIds,
		accounts,
		transactions,
		cycle.cycleStart,
		cycle.cycleEnd,
		transactionOrder,
	]);
	// Cash transfers and card settlements remain inspectable, but do not
	// consume the same purchase budget twice. Scheduled bills are server-owned.
	const directSpending = useMemo(
		() =>
			directTransactions.filter(
				(row) => row.flow !== "transfer" && row.source === "historical",
			),
		[directTransactions],
	);
	const cashPayments = useMemo(() => {
		const rows = directTransactions.filter(
			(row) =>
				row.flow === "transfer" &&
				row.source === "historical" &&
				row.date >= cycle.cycleStart,
		);
		return {
			title: "Cash payments this cycle",
			subtitle: "Recorded transfers and card payments",
			total: sum(rows.map((row) => row.amount)),
			transactions: rows,
		};
	}, [directTransactions, cycle.cycleStart]);

	// Card and direct cash share one list; only the rows merge.
	const currentCardTransactions = useMemo(
		() => perAccount.flatMap((item) => item.recorded),
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
				amount: sum(
					spendingLedger({
						transactions: currentSpendingActivity(
							item.recorded,
							transactions ?? [],
						),
						cycleStart: cycle.cycleStart,
						cycleEnd: cycle.cycleEnd,
						todayIso: displayToday,
					}).map(spendingAmount),
				),
			})),
		[perAccount, cycle.cycleStart, cycle.cycleEnd, displayToday, transactions],
	);
	const currentSpendingTransactions = useMemo(
		() =>
			currentSpendingActivity(
				[...currentCardTransactions, ...directSpending],
				transactions ?? [],
			),
		[transactions, currentCardTransactions, directSpending],
	);
	const billIncreases = useMemo(
		() =>
			recurringBillIncreases({
				obligations: currentCashSummary.data?.outstandingObligations ?? [],
				schedules: savedRules ?? [],
				transactions: transactions ?? [],
				accountIds: (accounts ?? []).map((account) => account.id),
				today: displayToday,
				cycleEnd: cycle.cycleEnd,
			}),
		[
			accounts,
			currentCashSummary.data,
			cycle.cycleEnd,
			displayToday,
			savedRules,
			transactions,
		],
	);
	const currentView = useMemo(
		() =>
			cycleView({
				cycle: { start: cycle.cycleStart, end: cycle.cycleEnd },
				referenceDay: displayToday,
				transactions: currentSpendingTransactions,
				monthlyIncome: expectedMonthlyIncome({
					schedules: savedRules ?? [],
					incomeScheduleIds: settings.incomeScheduleIds,
					monthStart: `${displayToday.slice(0, 7)}-01`,
					monthEnd: monthEndIso(displayToday),
				}),
				cashSummary: currentCashSummary.data,
				cardSpentByCard: currentCardByCard,
				reserve: settings.reserve,
				closedCycle,
				fullDaysLeft: Math.max(1, cycle.daysLeft - 1),
				scheduledOutflows: billIncreases,
			}),
		[
			cycle.cycleStart,
			cycle.cycleEnd,
			cycle.daysLeft,
			displayToday,
			currentSpendingTransactions,
			savedRules,
			settings.incomeScheduleIds,
			currentCashSummary.data,
			currentCardByCard,
			settings.reserve,
			closedCycle,
			billIncreases,
		],
	);
	const lastView = useMemo(
		() =>
			historicalCycleView({
				spendingIds,
				billResults: obligationTransactions,
				cardTransactions: lastCardTransactions,
				accounts: accounts ?? [],
				savedTransactions: transactions ?? [],
				transactionOrder,
				closedCycle,
			}),
		[
			closedCycle,
			spendingIds,
			obligationTransactions,
			lastCardTransactions,
			accounts,
			transactions,
			transactionOrder,
		],
	);

	const tabChargeCycles = useMemo<
		Record<SafeSpendingCycleTab, SafeSpendingChargeCycle>
	>(() => {
		const spending = sortTransactionsByDate({
			items: currentView.ledger,
			getDate: (transaction) => transaction.sortDate ?? transaction.date,
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
					incomeTransactionId:
						currentView.trend.monthlyIncome?.hit?.transactionId ?? null,
					safetyNetTransactionId:
						currentView.trend.safetyNetHit &&
						!currentView.trend.safetyNetHit.projected
							? (currentView.trend.safetyNetHit.transactionId ?? null)
							: null,
					limitTransactionId:
						currentView.trend.limitHit && !currentView.trend.limitHit.projected
							? (currentView.trend.limitHit.transactionId ?? null)
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
	}, [chargeCycles, transactionOrder, currentView, lastView]);
	// Saved rows hydrate after the card header. The header renders
	// immediately; only the computed body waits for rows, settings,
	// and the forecast.
	const savedRowsPending =
		!accounts || !transactions || savedRules === null || !startDate;
	if (settingsState.error)
		return (
			<Alert variant="destructive" aria-label="Safe spending settings">
				<AlertDescription>
					Budget settings could not be loaded.
				</AlertDescription>
				<Button variant="link" onClick={settingsState.retry}>
					Retry
				</Button>
			</Alert>
		);
	if (!projection && !pending) return null;

	const { fullDaysLeft } = currentView.view.heroes;
	const inlineView = cycleViewTab === "cycle" ? currentView : lastView;
	const selectedCaption = cycleCaption({
		start: inlineView.view.heroes.cycleStart,
		end: inlineView.view.heroes.cycleEnd,
		closed: cycleViewTab === "last-cycle",
		daysLeft: fullDaysLeft,
	});

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
	const toggleIncomeSource = (id: string) =>
		updateSettings({
			incomeScheduleIds: settings.incomeScheduleIds.includes(id)
				? settings.incomeScheduleIds.filter((item) => item !== id)
				: [...settings.incomeScheduleIds, id],
		});

	// Saved-data frame (header, cycle dates) renders regardless; only the
	// computed safe spending body skeletonizes while rows, settings, or the
	// projection are absent.
	if (savedRowsPending || settingsState.pending || pending)
		return (
			<Card role="region" aria-label={labels.title}>
				<CardHeader>
					<CardTitle>
						<h2 className="flex min-h-8 items-center gap-2 [overflow-wrap:anywhere]">
							<CalendarDays
								size={16}
								className="shrink-0 text-muted-foreground"
								aria-hidden="true"
							/>
							{labels.title}
						</h2>
					</CardTitle>
					<CardDescription>
						{selectedCaption}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div aria-busy="true">
						<Skeleton className="h-32 w-full" />
					</div>
				</CardContent>
			</Card>
		);

	return (
		<>
			<Card role="region" aria-label={labels.title}>
				<CardHeader>
					<CardTitle>
						<h2 className="flex min-h-8 items-center gap-2 [overflow-wrap:anywhere]">
							<CalendarDays
								size={16}
								className="shrink-0 text-muted-foreground"
								aria-hidden="true"
							/>
							{labels.title}
						</h2>
					</CardTitle>
					<CardDescription>
						{selectedCaption}
					</CardDescription>
					{trackedIds.length > 0 && (
						<CardAction>
							<Button variant="link" onClick={() => onDetail("configure")}>
								Configure
							</Button>
						</CardAction>
					)}
				</CardHeader>
				{trackedIds.length > 0 ? (
					<>
						<CardContent className="grid content-start gap-4">
							<ToggleGroup
								aria-label="Safe spending cycle view"
								value={[cycleViewTab]}
								onValueChange={(next) => {
									const nextValue = next.find(
										(candidate) => candidate !== cycleViewTab,
									);
									if (nextValue !== undefined)
										setCycleViewTab(nextValue as SafeSpendingCycleTab);
								}}
							>
								{SAFE_SPENDING_DETAIL_TABS.filter(
									(
										item,
									): item is Extract<
										(typeof SAFE_SPENDING_DETAIL_TABS)[number],
										{ view: "charges" }
									> => isSafeSpendingCycleTab(item.id),
								).map((item) => (
									<ToggleGroupItem key={item.id} value={item.id}>
										{item.label}
									</ToggleGroupItem>
								))}
							</ToggleGroup>
							<SafeSpendingBillsPanel
								heroes={inlineView.view.heroes}
								cashEvidence={
									<SafeSpendingCashEvidence
										summary={cashSummary.data}
										pending={cashSummary.isPending}
										error={cashSummary.isError}
										historical={cycleViewTab === "last-cycle"}
										onRetry={() => {
											void cashSummary.refetch();
										}}
									/>
								}
								allocation={inlineView.view.allocation}
								trend={inlineView.trend}
								section={lastView.section}
								closed={cycleViewTab === "last-cycle"}
							/>
						</CardContent>
						<CardFooter className="flex-wrap gap-4">
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
						</CardFooter>
					</>
				) : (
					<CardContent className="grid content-start gap-3">
						<p className="m-0 text-sm leading-relaxed text-muted-foreground">
							Its statement cycle, spending, and balance settle here.
						</p>
						<Button variant="link" onClick={() => onDetail("configure")}>
							Choose a card
						</Button>
					</CardContent>
				)}
			</Card>
			{detail && (
				<SafeSpendingDetailShell
					tab={detail}
					onTabChange={onTabChange}
					cycleCounts={Object.fromEntries(
						Object.entries(tabChargeCycles).map(([id, entry]) => [
							id,
							entry.transactions.length +
								(id === "last-cycle"
									? lastView.section.transactions.length
									: 0),
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
							cashPayments={
								detail === "last-cycle"
									? lastView.section
									: cashPayments.transactions.length > 0
										? cashPayments
										: undefined
							}
							accounts={accounts ?? []}
							transactions={savedState}
							readOnly={readOnly}
							transactionOrder={transactionOrder}
							onTransactionOrderChange={setTransactionOrder}
						/>
					)}
					{detail === "configure" && (
						<SafeSpendingConfigurePanel
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
							}}
							billCandidates={billCandidates}
							trackedBillIds={trackedBillIds}
							accounts={accounts ?? []}
							incomeCandidates={incomeCandidates}
							incomeScheduleIds={settings.incomeScheduleIds}
							onToggleIncomeSource={toggleIncomeSource}
							onToggleBill={toggleBill}
							onToggleAccount={toggleAccount}
							onToggleSpendingAccount={toggleSpendingAccount}
							onUpdateConfig={updateSettings}
						/>
					)}
				</SafeSpendingDetailShell>
			)}
		</>
	);
}
