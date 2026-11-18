import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { BackendCheckpoint } from "@/api/contracts.ts";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import {
	DEFAULT_TRANSACTION_ORDER,
	sortTransactionsByDate,
	type TransactionOrder,
} from "@/domain/transactionSort.ts";
import { monthDay, sum, todayIso } from "@/domain/format.ts";
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
import { monthEndIso } from "@/domain/safeSpending.ts";
import { closedCardBalances } from "@/domain/closedCardBalances.ts";
import { inWindow } from "@/domain/safeSpendingMath.ts";
import { billsInCycle } from "@/domain/safeSpendingBills.ts";
import { postedTransactionResults } from "@/domain/safeSpendingHistory.ts";
import { spendingLedger, spendingAmount } from "@/domain/safeSpendingTrend.ts";
import {
	currentCashActivity,
	currentSpendingActivity,
} from "./currentCashActivity.ts";
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
	cycleCaption,
	isSafeSpendingCycleTab,
	type SafeSpendingChargeCycle,
	type SafeSpendingDetailTab,
} from "@/pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import { cycleView } from "@/pages/outlook/safe-spending/cycleView.ts";
import { historicalCycleView } from "@/pages/outlook/safe-spending/historicalCycleView.ts";
import { useSafeSpendingSettings } from "@/state/useSafeSpendingSettings.ts";
import { useCardCycleActivity } from "@/pages/outlook/safe-spending/useCardCycleActivity.ts";
import { useOutlookProjection } from "@/pages/outlook/useOutlookProjection.ts";
import { SAFE_SPENDING_LABELS as labels } from "@/pages/outlook/safe-spending/safeSpendingLabels.ts";
import { useSafeSpendingSummary } from "@/state/useSafeSpendingSummary.ts";
import { SafeSpendingCashEvidence } from "./SafeSpendingCashEvidence.tsx";
import { expectedMonthlyIncome } from "@/domain/safeSpendingIncome.ts";
import { recurringBillIncreases } from "@/domain/recurringBillIncreases.ts";
import { cashPaymentSection } from "./cashPayments.ts";
import { useSafeSpendingSelections } from "./useSafeSpendingSelections.ts";

// Stable empty input so pending derivations stay null-safe without
// re-running memos on identity churn.
const EMPTY_CHECKPOINTS: BackendCheckpoint[] = [];

/** The saved-data frame renders immediately; only its body skeletonizes. */
function SafeSpendingCardHeader({
	caption,
	action,
}: {
	caption?: string;
	action?: React.ReactNode;
}) {
	return (
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
			{caption !== undefined && <CardDescription>{caption}</CardDescription>}
			{action}
		</CardHeader>
	);
}

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
	const settingsState = useSafeSpendingSettings();
	const { updateSettings, ...settings } = settingsState;
	const [transactionOrder, setTransactionOrder] = useState<TransactionOrder>(
		DEFAULT_TRANSACTION_ORDER,
	);
	// One selected statement cycle renders inline; arrows move the visible
	// window to earlier or later cycles. Only offset 0 carries the live
	// cash-backed budget.
	const [cycleOffset, setCycleOffset] = useState(0);

	// Safe spending display follows the real calendar day so due dates read
	// correctly, while the projection math stays on startDate (the
	// latest balance checkpoint). Never before the projection start.
	const [displayToday] = useState(() => {
		const today = todayIso();
		const start = (startDate ?? today).slice(0, 10);
		return today >= start ? today : start;
	});

	const {
		candidateAccounts,
		trackedIds,
		spendableAccounts,
		spendingIds,
		incomeCandidates,
		billCandidates,
		trackedBillIds,
		toggleAccount,
		toggleSpendingAccount,
		toggleBill,
		toggleIncomeSource,
	} = useSafeSpendingSelections({
		accounts: accounts ?? [],
		rules,
		savedRules: savedRules ?? [],
		settings,
		displayToday,
		updateSettings,
	});

	const {
		current,
		previous,
		selected,
		selectedBalances,
		perAccount,
		selectedChargeCycle,
	} = useCardCycleActivity({
		accounts: accounts ?? [],
		transactions: transactions ?? [],
		checkpoints,
		projection,
		cards: candidateAccounts,
		trackedIds,
		statementDay: settings.statementDay,
		displayToday,
		transactionOrder,
		cycleOffset,
	});
	// Recorded rows stop at the selected end when it lies in the past;
	// future cycles read through today.
	const todayParam =
		selected.cycleEnd <= displayToday ? selected.cycleEnd : displayToday;
	const trackedCards = useMemo(
		() =>
			trackedIds.map((id) => ({
				id,
				name: candidateAccounts.find((card) => card.id === id)?.name ?? id,
			})),
		[trackedIds, candidateAccounts],
	);
	const previousClosedCycle = useMemo(
		() => ({
			start: previous.cycleStart,
			end: previous.cycleEnd,
			...closedCardBalances({
				checkpoints,
				cards: trackedCards,
				cycleEnd: previous.cycleEnd,
			}),
		}),
		[previous, checkpoints, trackedCards],
	);
	const selectedClosedCycle = useMemo(
		() => ({
			start: selected.cycleStart,
			end: selected.cycleEnd,
			...selectedBalances,
		}),
		[selected, selectedBalances],
	);
	// Current cash stays mounted even while the inline view shows another
	// cycle. The independently opened Transactions drawer never borrows
	// close cash for the live budget.
	const currentCashSummary = useSafeSpendingSummary(
		displayToday,
		monthEndIso(displayToday),
	);
	const selectedCashSummary = useSafeSpendingSummary(
		selected.cycleEnd,
		selected.cycleEnd,
		cycleOffset < 0,
	);
	const cashSummary =
		cycleOffset === 0 ? currentCashSummary : selectedCashSummary;

	// Bills are the selected recurring schedules' occurrences in the visible
	// cycle. Nothing else is folded into this list.
	const selectedBillSchedules = useMemo(
		() => (savedRules ?? []).filter((rule) => trackedBillIds.includes(rule.id)),
		[savedRules, trackedBillIds],
	);
	const currentBills = useMemo(
		() =>
			billsInCycle(
				selectedBillSchedules,
				trackedBillIds,
				current.cycleStart,
				current.cycleEnd,
			),
		[
			selectedBillSchedules,
			trackedBillIds,
			current.cycleStart,
			current.cycleEnd,
		],
	);
	const selectedBills = useMemo(
		() =>
			billsInCycle(
				selectedBillSchedules,
				trackedBillIds,
				selected.cycleStart,
				selected.cycleEnd,
			),
		[
			selectedBillSchedules,
			trackedBillIds,
			selected.cycleStart,
			selected.cycleEnd,
		],
	);
	// Recorded rows still feed the cash payments view.
	const historyResults = useMemo(
		() => postedTransactionResults(transactions ?? []),
		[transactions],
	);
	// Recorded cash uses the cycle window directly: no earlier-month padding
	// and no second, looser definition of the current cycle's lower bound.
	const currentDirectTransactions = useMemo(
		() =>
			sortTransactionsByDate({
				items: currentSpendingActivity(
					currentCashActivity({
						accounts: accounts ?? [],
						transactions: transactions ?? [],
						spendingIds,
						cycleStart: current.cycleStart,
						cycleEnd: current.cycleEnd,
						today: displayToday,
					}),
					transactions ?? [],
				),
				getDate: (transaction) => transaction.date,
				getId: (transaction) => transaction.id,
				order: transactionOrder,
			}),
		[
			displayToday,
			spendingIds,
			accounts,
			transactions,
			current.cycleStart,
			current.cycleEnd,
			transactionOrder,
		],
	);
	const selectedDirectTransactions = useMemo(
		() =>
			sortTransactionsByDate({
				items: currentSpendingActivity(
					currentCashActivity({
						accounts: accounts ?? [],
						transactions: transactions ?? [],
						spendingIds,
						cycleStart: selected.cycleStart,
						cycleEnd: selected.cycleEnd,
						today: todayParam,
					}),
					transactions ?? [],
				),
				getDate: (transaction) => transaction.date,
				getId: (transaction) => transaction.id,
				order: transactionOrder,
			}),
		[
			todayParam,
			spendingIds,
			accounts,
			transactions,
			selected.cycleStart,
			selected.cycleEnd,
			transactionOrder,
		],
	);
	// Cash transfers and card settlements remain inspectable, but do not
	// consume the same purchase budget twice. Scheduled bills are server-owned.
	const currentDirectSpending = useMemo(
		() =>
			currentDirectTransactions.filter(
				(row) =>
					row.flow !== "transfer" &&
					row.source === "historical" &&
					inWindow(row.date, current.cycleStart, current.cycleEnd),
			),
		[currentDirectTransactions, current.cycleStart, current.cycleEnd],
	);
	const selectedCashPayments = useMemo(
		() =>
			cashPaymentSection({
				rows: selectedDirectTransactions,
				start: selected.cycleStart,
				end: selected.cycleEnd,
				title: labels.cashPaymentsThisCycle,
				subtitle:
					cycleOffset === 0
						? labels.cashPayments
						: `Recorded amounts · ${monthDay(selected.cycleStart)} – ${monthDay(selected.cycleEnd)}`,
			}),
		[
			selectedDirectTransactions,
			selected.cycleStart,
			selected.cycleEnd,
			cycleOffset,
		],
	);

	// Card and direct cash share one list; only the rows merge.
	const currentCardTransactions = useMemo(
		() => perAccount.flatMap((item) => item.recorded),
		[perAccount],
	);
	const selectedCardTransactions = useMemo(
		() => perAccount.flatMap((item) => item.selected),
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
						cycleStart: current.cycleStart,
						cycleEnd: current.cycleEnd,
						todayIso: displayToday,
					}).map(spendingAmount),
				),
			})),
		[
			perAccount,
			current.cycleStart,
			current.cycleEnd,
			displayToday,
			transactions,
		],
	);
	const currentSpendingTransactions = useMemo(
		() =>
			currentSpendingActivity(
				[...currentCardTransactions, ...currentDirectSpending],
				transactions ?? [],
			),
		[transactions, currentCardTransactions, currentDirectSpending],
	);
	const billIncreases = useMemo(
		() =>
			recurringBillIncreases({
				bills: currentBills,
				transactions: transactions ?? [],
			}),
		[currentBills, transactions],
	);
	const currentView = useMemo(
		() =>
			cycleView({
				cycle: { start: current.cycleStart, end: current.cycleEnd },
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
				closedCycle: previousClosedCycle,
				fullDaysLeft: Math.max(1, current.daysLeft - 1),
				scheduledOutflows: billIncreases,
			}),
		[
			current.cycleStart,
			current.cycleEnd,
			current.daysLeft,
			displayToday,
			currentSpendingTransactions,
			savedRules,
			settings.incomeScheduleIds,
			currentCashSummary.data,
			currentCardByCard,
			settings.reserve,
			previousClosedCycle,
			billIncreases,
		],
	);
	// The selected cycle's cash-payment section lists every posted cash row
	// in the window, including one-time settlements. It is not the Bills
	// list, which stays the selected recurring bills inside the cycle.
	const selectedCashPaymentRows = useMemo(
		() =>
			historyResults.filter(
				(row) =>
					row.posted === true &&
					row.date >= selected.cycleStart &&
					row.date <= selected.cycleEnd,
			),
		[historyResults, selected.cycleStart, selected.cycleEnd],
	);
	const selectedHistory = useMemo(
		() =>
			historicalCycleView({
				spendingIds,
				cashPaymentRows: selectedCashPaymentRows,
				cardTransactions: selectedCardTransactions,
				accounts: accounts ?? [],
				savedTransactions: transactions ?? [],
				transactionOrder,
				closedCycle: selectedClosedCycle,
			}),
		[
			selectedClosedCycle,
			spendingIds,
			selectedCashPaymentRows,
			selectedCardTransactions,
			accounts,
			transactions,
			transactionOrder,
		],
	);

	const drawerChargeCycle = useMemo<SafeSpendingChargeCycle>(() => {
		if (cycleOffset === 0) {
			const spending = sortTransactionsByDate({
				items: currentView.ledger,
				getDate: (transaction) => transaction.sortDate ?? transaction.date,
				getId: (transaction) => transaction.id,
				order: transactionOrder,
			});
			return {
				start: current.cycleStart,
				end: current.cycleEnd,
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
			};
		}
		return {
			start: selected.cycleStart,
			end: selected.cycleEnd,
			title: labels.recordedCharges,
			emptyMessage: selectedChargeCycle.emptyMessage,
			showTotal: true,
			transactions: selectedChargeCycle.transactions,
			summary: {
				total: selectedHistory.view.heroes.committedTotal,
				byCard: selectedHistory.view.heroes.committedByCard,
			},
		};
	}, [
		cycleOffset,
		currentView,
		transactionOrder,
		current.cycleStart,
		current.cycleEnd,
		selected.cycleStart,
		selected.cycleEnd,
		selectedChargeCycle,
		selectedHistory,
	]);
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

	const inlineView = cycleOffset === 0 ? currentView : selectedHistory;
	const selectedCaption = cycleCaption({
		start: selected.cycleStart,
		end: selected.cycleEnd,
		closed: cycleOffset < 0,
		upcoming: cycleOffset > 0,
		daysLeft: inlineView.view.heroes.fullDaysLeft,
	});

	// Saved-data frame (header, cycle dates) renders regardless; only the
	// computed safe spending body skeletonizes while rows, settings, or the
	// projection are absent.
	if (savedRowsPending || settingsState.pending || pending)
		return (
			<Card role="region" aria-label={labels.title}>
				<SafeSpendingCardHeader caption={selectedCaption} />
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
				<SafeSpendingCardHeader
					action={
						trackedIds.length > 0 ? (
							<CardAction>
								<Button variant="link" onClick={() => onDetail("configure")}>
									Configure
								</Button>
							</CardAction>
						) : undefined
					}
				/>
				{trackedIds.length > 0 ? (
					<>
						<CardContent className="grid content-start gap-4">
							<div
								className="flex items-center justify-between gap-2"
								aria-label="Safe spending cycle view"
							>
								<Button
									variant="outline"
									size="icon"
									aria-label="Previous cycle"
									onClick={() => setCycleOffset((offset) => offset - 1)}
								>
									<ChevronLeft aria-hidden="true" />
								</Button>
								<span className="min-w-0 flex-1 text-center text-sm text-muted-foreground">
									{selectedCaption}
								</span>
								<Button
									variant="outline"
									size="icon"
									aria-label="Next cycle"
									onClick={() => setCycleOffset((offset) => offset + 1)}
								>
									<ChevronRight aria-hidden="true" />
								</Button>
							</div>
							<SafeSpendingBillsPanel
								heroes={inlineView.view.heroes}
								cashEvidence={
									<SafeSpendingCashEvidence
										summary={cashSummary.data}
										pending={cashSummary.isPending}
										error={cashSummary.isError}
										closed={cycleOffset < 0}
										upcoming={cycleOffset > 0}
										bills={selectedBills}
										onRetry={() => {
											void cashSummary.refetch();
										}}
									/>
								}
								allocation={inlineView.view.allocation}
								trend={inlineView.trend}
								section={
									cycleOffset !== 0 ? selectedHistory.section : undefined
								}
								closed={cycleOffset < 0}
								upcoming={cycleOffset > 0}
							/>
						</CardContent>
						<CardFooter className="flex-wrap gap-4">
							<Button variant="link" onClick={() => onDetail("transactions")}>
								Transactions
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
					cycleCounts={{
						transactions:
							drawerChargeCycle.transactions.length +
							selectedCashPayments.transactions.length,
					}}
					range={isSafeSpendingCycleTab(detail) ? drawerChargeCycle : undefined}
					onClose={() => onDetail(null)}
				>
					{isSafeSpendingCycleTab(detail) && (
						<SafeSpendingCyclePanel
							key={detail}
							cycle={drawerChargeCycle}
							cashPayments={
								selectedCashPayments.transactions.length > 0
									? selectedCashPayments
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
