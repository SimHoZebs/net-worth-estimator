import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
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
import { inWindow } from "@/domain/safeSpendingMath.ts";
import { billsInCycle } from "@/domain/safeSpendingBills.ts";
import { spendingLedger, spendingAmount } from "@/domain/safeSpendingTrend.ts";
import {
	currentCashActivity,
	currentSpendingActivity,
} from "./currentCashActivity.ts";
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
import { useSafeSpendingSettings } from "@/state/useSafeSpendingSettings.ts";
import { useCardCycleActivity } from "@/pages/outlook/safe-spending/useCardCycleActivity.ts";
import { useOutlookProjection } from "@/pages/outlook/useOutlookProjection.ts";
import { SAFE_SPENDING_LABELS as labels } from "@/pages/outlook/safe-spending/safeSpendingLabels.ts";
import { useSafeSpendingSummary } from "@/state/useSafeSpendingSummary.ts";
import { SafeSpendingCashEvidence } from "./SafeSpendingCashEvidence.tsx";
import { expectedMonthlyIncome } from "@/domain/safeSpendingIncome.ts";
import {
	recurringBillIncreases,
	recurringBillMarkers,
	unclaimedBills,
} from "@/domain/recurringBillIncreases.ts";
import { cashPaymentSection } from "./cashPayments.ts";
import { useSafeSpendingSelections } from "./useSafeSpendingSelections.ts";

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
	// window to earlier or later cycles. Every offset reconstructs the same
	// budget rows from the selected window's cash evidence.
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

	const { selected, perAccount } = useCardCycleActivity({
		accounts: accounts ?? [],
		transactions: transactions ?? [],
		projection,
		cards: candidateAccounts,
		trackedIds,
		statementDay: settings.statementDay,
		displayToday,
		cycleOffset,
	});
	// The selected window's reference day stops at the selected end when it
	// lies in the past; future cycles read through today.
	const referenceDay =
		selected.cycleEnd <= displayToday ? selected.cycleEnd : displayToday;
	// Current cash stays mounted even while the inline view shows another
	// cycle. Past windows read their own single-day close range. Future
	// windows read nothing: the summary endpoint rejects starts after today,
	// so they render the explicit unavailable state instead of an error.
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
	// Recorded cash uses the selected cycle window directly: no
	// earlier-month padding and no second, looser definition of the lower bound.
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
						today: referenceDay,
					}),
					transactions ?? [],
				),
				getDate: (transaction) => transaction.date,
				getId: (transaction) => transaction.id,
				order: transactionOrder,
			}),
		[
			referenceDay,
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
	const selectedDirectSpending = useMemo(
		() =>
			selectedDirectTransactions.filter(
				(row) =>
					row.flow !== "transfer" &&
					row.source === "historical" &&
					inWindow(row.date, selected.cycleStart, selected.cycleEnd),
			),
		[selectedDirectTransactions, selected.cycleStart, selected.cycleEnd],
	);
	// The selected cycle's cash-payment section lists every recorded cash
	// transfer in the window. It is not the Bills list, which stays the
	// selected recurring bills inside the cycle.
	const selectedCashPayments = useMemo(
		() =>
			cashPaymentSection({
				rows: selectedDirectTransactions,
				start: selected.cycleStart,
				end: selected.cycleEnd,
				title: labels.cashPaymentsThisCycle,
				subtitle: `Recorded amounts · ${monthDay(selected.cycleStart)} – ${monthDay(selected.cycleEnd)}`,
			}),
		[selectedDirectTransactions, selected.cycleStart, selected.cycleEnd],
	);

	// Card and direct cash share one list; only the rows merge.
	const selectedCardTransactions = useMemo(
		() => perAccount.flatMap((item) => item.selected),
		[perAccount],
	);
	const selectedCardByCard = useMemo(
		() =>
			perAccount.map((item) => ({
				id: item.accountId,
				name: item.name,
				amount: sum(
					spendingLedger({
						transactions: currentSpendingActivity(
							item.selected,
							transactions ?? [],
						),
						cycleStart: selected.cycleStart,
						cycleEnd: selected.cycleEnd,
						todayIso: referenceDay,
					}).map(spendingAmount),
				),
			})),
		[
			perAccount,
			selected.cycleStart,
			selected.cycleEnd,
			referenceDay,
			transactions,
		],
	);
	const selectedSpendingTransactions = useMemo(
		() =>
			currentSpendingActivity(
				[...selectedCardTransactions, ...selectedDirectSpending],
				transactions ?? [],
			),
		[transactions, selectedCardTransactions, selectedDirectSpending],
	);
	const billIncreases = useMemo(
		() =>
			recurringBillIncreases({
				bills: selectedBills,
				transactions: transactions ?? [],
			}),
		[selectedBills, transactions],
	);
	const billMarkers = useMemo(
		() => recurringBillMarkers(selectedBills),
		[selectedBills],
	);
	// The Bills list hides scheduled occurrences a recorded movement already
	// claims; the chart dots keep every scheduled occurrence, claimed or not.
	const displayBills = useMemo(
		() => unclaimedBills(selectedBills, transactions ?? []),
		[selectedBills, transactions],
	);
	const selectedView = useMemo(
		() =>
			cycleView({
				cycle: { start: selected.cycleStart, end: selected.cycleEnd },
				referenceDay,
				transactions: selectedSpendingTransactions,
				monthlyIncome: expectedMonthlyIncome({
					schedules: savedRules ?? [],
					incomeScheduleIds: settings.incomeScheduleIds,
					monthStart: `${referenceDay.slice(0, 7)}-01`,
					monthEnd: monthEndIso(referenceDay),
				}),
				cashSummary: cashSummary.data,
				cardSpentByCard: selectedCardByCard,
				reserve: settings.reserve,
				fullDaysLeft: Math.max(1, selected.daysLeft - 1),
				scheduledOutflows: billIncreases,
				billMarkers,
				remainingOverride:
					cycleOffset === 0
						? undefined
						: cashSummary.data?.status === "available" &&
							  cashSummary.data.cashAfterBills !== null &&
							  Number.isFinite(cashSummary.data.cashAfterBills)
							? cashSummary.data.cashAfterBills
							: null,
			}),
		[
			selected.cycleStart,
			selected.cycleEnd,
			selected.daysLeft,
			referenceDay,
			selectedSpendingTransactions,
			savedRules,
			settings.incomeScheduleIds,
			cashSummary.data,
			selectedCardByCard,
			settings.reserve,
			billIncreases,
			billMarkers,
			cycleOffset,
		],
	);

	const drawerChargeCycle = useMemo<SafeSpendingChargeCycle>(() => {
		const spending = sortTransactionsByDate({
			items: selectedView.ledger,
			getDate: (transaction) => transaction.sortDate ?? transaction.date,
			getId: (transaction) => transaction.id,
			order: transactionOrder,
		});
		return {
			start: selected.cycleStart,
			end: selected.cycleEnd,
			title: labels.cycleSpending,
			emptyMessage: "No spending this cycle yet.",
			transactions: spending,
			summary: {
				total: selectedView.view.heroes.committedTotal,
				byCard: selectedView.view.heroes.committedByCard,
			},
			thresholds: {
				incomeTransactionId:
					selectedView.trend.monthlyIncome?.hit?.transactionId ?? null,
				safetyNetTransactionId:
					selectedView.trend.safetyNetHit &&
					!selectedView.trend.safetyNetHit.projected
						? (selectedView.trend.safetyNetHit.transactionId ?? null)
						: null,
				limitTransactionId:
					selectedView.trend.limitHit && !selectedView.trend.limitHit.projected
						? (selectedView.trend.limitHit.transactionId ?? null)
						: null,
			},
		};
	}, [selectedView, transactionOrder, selected.cycleStart, selected.cycleEnd]);
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

	const selectedCaption = cycleCaption({
		start: selected.cycleStart,
		end: selected.cycleEnd,
		closed: cycleOffset < 0,
		upcoming: cycleOffset > 0,
		daysLeft: selectedView.view.heroes.fullDaysLeft,
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
								cashEvidence={
									<SafeSpendingCashEvidence
										summary={cashSummary.data}
										pending={cashSummary.isPending}
										error={cashSummary.isError}
										bills={displayBills}
										unavailable={cycleOffset > 0}
										onRetry={() => {
											void cashSummary.refetch();
										}}
									/>
								}
								allocation={selectedView.view.allocation}
								trend={selectedView.trend}
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
