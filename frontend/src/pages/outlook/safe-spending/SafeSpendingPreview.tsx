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
	filterTransactionsById,
	mandatoryTransactions,
	monthEndIso,
	nextMonthObligations,
	realizedCheckingOutflows,
	remainingMonthlyObligations,
	spendingBalance,
} from "@/domain/safeSpending.ts";

import { safeSpendingIncome } from "@/domain/safeSpendingIncome.ts";
import { visibleAccounts } from "@/domain/model.ts";
import type { Projection } from "@/domain/result.ts";
import { useCheckpoints } from "@/state/workspaceResources.ts";
import {
	useSavedAccounts,
	useSavedStartDate,
	useSavedTransactions,
} from "@/state/savedRows.ts";
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
import {
	resolveEffectiveIds,
	useSafeSpendingSettings,
} from "@/state/useSafeSpendingSettings.ts";
import { useCardCycleActivity } from "@/pages/outlook/safe-spending/useCardCycleActivity.ts";
import { useOutlookProjection } from "@/pages/outlook/useOutlookProjection.ts";
import { HouseholdBudgetSummary } from "@/pages/outlook/safe-spending/HouseholdBudgetSummary.tsx";
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
	const startDate = useSavedStartDate();
	const readOnly = useUserReadOnly();
	const checkpoints = useCheckpoints().data?.checkpoints ?? EMPTY_CHECKPOINTS;
	const { base: projection, pending } = useOutlookProjection();
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
	const obligationTransactions = useMemo(
		() =>
			filterTransactionsById(projectionTransactions, settings.transactionIds),
		[projectionTransactions, settings.transactionIds],
	);
	const remainingDerived = useMemo(() => {
		if (!spendingIds.length)
			return { total: 0, monthEnd: monthEndIso(displayToday) };
		return remainingMonthlyObligations({
			transactions: obligationTransactions,
			checkingIds: spendingIds,
			todayIso: displayToday,
		});
	}, [obligationTransactions, spendingIds, displayToday]);
	const fixedDerived = useMemo(() => {
		if (!spendingIds.length)
			return { total: 0, start: displayToday, end: displayToday };
		return nextMonthObligations({
			transactions: obligationTransactions,
			checkingIds: spendingIds,
			todayIso: displayToday,
		});
	}, [obligationTransactions, spendingIds, displayToday]);
	const income = useMemo(
		() =>
			safeSpendingIncome({
				accounts: accounts ?? [],
				rules: transactions ?? [],
				transactions: projectionTransactions,
				incomeAccountIds: incomeIds,
				incomeRuleIds: settings.incomeRuleIds,
				todayIso: displayToday,
			}),
		[
			accounts,
			transactions,
			projectionTransactions,
			incomeIds,
			settings.incomeRuleIds,
			displayToday,
		],
	);
	const paycheckDerived = income.paycheck;
	// Past cash outflow stays filter-proof: bill toggles shape the bills
	// list only, never the cushion. Direct checking spend always counts here.
	const spentSinceStart = useMemo(
		() =>
			spendingIds.length
				? realizedCheckingOutflows({
						transactions: projectionTransactions,
						checkingIds: spendingIds,
						after: startDate ?? displayToday,
						through: displayToday,
					})
				: 0,
		[projectionTransactions, spendingIds, startDate, displayToday],
	);
	const shortWindow = useMemo(
		() =>
			spendingIds.length
				? checkingShortfall({
						transactions: obligationTransactions,
						checkingIds: spendingIds,
						after: displayToday,
						through: remainingDerived.monthEnd,
					})
				: { total: 0, firstDate: null as string | null },
		[
			obligationTransactions,
			spendingIds,
			displayToday,
			remainingDerived.monthEnd,
		],
	);

	const billCandidates = useMemo(() => {
		if (!spendingIds.length) return [];
		return (transactions ?? [])
			.filter(
				(transaction) =>
					transaction.fromId !== null &&
					spendingIds.includes(transaction.fromId) &&
					transaction.frequency !== "once",
			)
			.map((transaction) => ({
				id: transaction.id,
				name: transaction.name,
				amount: transaction.amount,
				frequency: transaction.frequency,
			}));
	}, [transactions, spendingIds]);

	const trackedBillIds = useMemo(() => {
		const knownIds = billCandidates.map((bill) => bill.id);
		return resolveEffectiveIds(settings.transactionIds, knownIds);
	}, [settings.transactionIds, billCandidates]);

	const billsStart = shiftDate({ date: displayToday, days: 1 });

	// Bills list shows tracked bills only; one-time purchases live under
	// direct cash spending so the two sections partition upcoming checking
	// outflows with no duplication. Cushion math (remaining/fixed) stays on
	// obligationTransactions and is unchanged.
	const billBaseTransactions = useMemo(() => {
		const bills = new Set(trackedBillIds);
		return projectionTransactions.filter((transaction) =>
			bills.has(transaction.transactionId),
		);
	}, [projectionTransactions, trackedBillIds]);
	const billTransactions = useMemo(() => {
		if (!spendingIds.length) return [];
		return sortTransactionsByDate({
			items: mandatoryTransactions({
				transactions: billBaseTransactions,
				checkingIds: spendingIds,
				start: billsStart,
				end: cycle.cycleEnd,
				accounts: accounts ?? [],
				savedTransactions: transactions ?? [],
			}),
			getDate: (transaction) => transaction.date,
			getId: (transaction) => transaction.id,
			order: transactionOrder,
		});
	}, [
		billBaseTransactions,
		spendingIds,
		accounts,
		transactions,
		billsStart,
		cycle.cycleEnd,
		transactionOrder,
	]);

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
		const ruleIds = new Set(
			(transactions ?? [])
				.filter((transaction) => transaction.frequency !== "once")
				.map((transaction) => transaction.id),
		);
		const sources = new Set(spendingIds);
		return projectionTransactions.filter(
			(transaction) =>
				transaction.fromId !== null &&
				sources.has(transaction.fromId) &&
				!bills.has(transaction.transactionId) &&
				!ruleIds.has(transaction.transactionId),
		);
	}, [projectionTransactions, spendingIds, trackedBillIds, transactions]);

	const directSpentSinceStart = useMemo(
		() =>
			spendingIds.length
				? realizedCheckingOutflows({
						transactions: directBaseTransactions,
						checkingIds: spendingIds,
						after: startDate ?? displayToday,
						through: displayToday,
					})
				: 0,
		[directBaseTransactions, spendingIds, startDate, displayToday],
	);

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
			},
		};
	}, [chargeCycles, directTransactions, transactionOrder]);
	// Saved rows gate rendering, not hooks: every subscription above stays
	// mounted while rows load.
	if (!accounts || !transactions || !startDate) return null;
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
		.map((id) => accounts.find((account) => account.id === id))
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

	const billsSection = {
		title: labels.scheduledBills,
		subtitle: `Scheduled amounts · ${monthDay(billsStart)} – ${monthDay(cycle.cycleEnd)}`,
		total: sum(billTransactions.map((transaction) => transaction.requested)),
		transactions: billTransactions,
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
							{detail === "cycle" ? (
								<SafeSpendingBillsPanel
									heroes={heroes}
									cashNow={{
										checking,
										spentSinceStart,
										directSpentSinceStart,
										bills: remainingObligations,
										cushion,
										since: startDate.slice(0, 10),
										monthEnd: remainingDerived.monthEnd,
										short: shortWindow.total,
										firstShort: shortWindow.firstDate,
									}}
									paycheck={paycheckDetails}
									section={billsSection}
									accounts={accounts}
									transactions={transactions}
									readOnly={readOnly}
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
								cycle={tabChargeCycles[detail]}
								accounts={accounts}
								transactions={transactions}
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
