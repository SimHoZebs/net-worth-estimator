import { CalendarDays, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card.tsx";
import {
	useSavedAccounts,
	useSavedSchedules,
	useSavedTransactions,
} from "@/state/savedState.ts";
import { scheduleToDisplay } from "@/domain/transactionRows.ts";
import {
	DEFAULT_TRANSACTION_ORDER,
	type TransactionOrder,
} from "@/domain/transactionSort.ts";
import { useTransferLinks } from "@/state/analyses.ts";
import { useUserReadOnly } from "@/state/useUserScope.ts";
import { SafeSpendingConfigurePanel } from "./SafeSpendingConfigurePanel.tsx";
import { SafeSpendingDetailShell } from "./SafeSpendingDetailShell.tsx";
import {
	isSafeSpendingTransactionsTab,
	paymentPeriodCaption,
	type SafeSpendingDetailTab,
} from "./safeSpendingDetailModel.ts";
import { useSafeSpendingSettings } from "@/state/useSafeSpendingSettings.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
import { useSafeSpendingSummary } from "@/state/useSafeSpendingSummary.ts";
import { SafeSpendingBudget } from "./SafeSpendingBudget.tsx";
import { SafeSpendingCyclePanel } from "./SafeSpendingCyclePanel.tsx";
import { buildAllowanceLedger } from "./allowanceLedger.ts";
import { amountText } from "./amountText.ts";
import { buildSafeSpendingActivity } from "./safeSpendingActivity.ts";
import { useSafeSpendingSelections } from "./useSafeSpendingSelections.ts";

function SafeSpendingCardHeader({ action }: { action?: React.ReactNode }) {
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
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const savedRules = useSavedSchedules();
	const settingsState = useSafeSpendingSettings();
	const { updateSettings, ...settings } = settingsState;
	const summary = useSafeSpendingSummary();
	const readOnly = useUserReadOnly();
	const transferLinks = useTransferLinks();
	const [transactionOrder, setTransactionOrder] = useState<TransactionOrder>(
		DEFAULT_TRANSACTION_ORDER,
	);

	const rules = useMemo(
		() => (savedRules ?? []).map(scheduleToDisplay),
		[savedRules],
	);
	const savedRows = useMemo(
		() => [...(transactions ?? []), ...rules],
		[transactions, rules],
	);
	const selections = useSafeSpendingSelections({
		accounts: accounts ?? [],
		rules,
		savedRules: savedRules ?? [],
		settings,
		displayToday: summary.data?.cashAsOf ?? "",
		updateSettings,
	});
	const activity = useMemo(
		() =>
			summary.data &&
			accounts !== null &&
			transactions !== null &&
			transferLinks.data !== undefined &&
			!transferLinks.isError
				? buildSafeSpendingActivity({
						accounts,
						transactions,
						trackedIds: selections.trackedIds,
						spendingIds: selections.spendingIds,
						summary: summary.data,
						transferLinks: transferLinks.data.links ?? [],
						order: transactionOrder,
					})
				: undefined,
		[
			summary.data,
			accounts,
			transactions,
			selections.trackedIds,
			selections.spendingIds,
			transferLinks.data,
			transferLinks.isError,
			transactionOrder,
		],
	);
	const cardLedger = useMemo(
		() => (summary.data ? buildAllowanceLedger(summary.data) : undefined),
		[summary.data],
	);
	const caption = summary.data
		? paymentPeriodCaption({
				start: summary.data.paymentPeriodStart,
				end: summary.data.payoffDate,
			})
		: undefined;

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

	return (
		<>
			<Card role="region" aria-label={labels.title}>
				<SafeSpendingCardHeader
					action={
						<CardAction>
							<Button
								variant="link"
								disabled={settingsState.pending}
								onClick={() => onDetail("configure")}
							>
								Configure
							</Button>
						</CardAction>
					}
				/>
				<CardContent className="grid content-start gap-4">
					{summary.isError && !cardLedger ? (
						<Alert variant="destructive" aria-label="Safe spending evidence">
							<AlertDescription>
								Safe spending evidence could not be loaded.
							</AlertDescription>
							<Button variant="link" onClick={() => void summary.refetch()}>
								Retry evidence
							</Button>
						</Alert>
					) : !cardLedger ||
					  !summary.data ||
					  summary.isPending ||
					  settingsState.pending ? (
						<div aria-busy="true">
							<Skeleton className="h-32 w-full" />
						</div>
					) : (
						<>
							<SafeSpendingBudget
								summary={summary.data}
								savingsTarget={settings.savingsTarget}
							/>
							<Button
								variant="link"
								className="justify-start gap-1 p-0 text-sm"
								onClick={() => onDetail("transactions")}
							>
								{labels.protectedSummary} ·{" "}
								{amountText(cardLedger.protectedTotal, labels.unavailable)} ·{" "}
								{cardLedger.obligationCount}{" "}
								{cardLedger.obligationCount === 1 ? "item" : "items"}
								<ChevronRight size={14} aria-hidden="true" />
							</Button>
						</>
					)}
				</CardContent>
			</Card>
			{detail && (
				<SafeSpendingDetailShell
					tab={detail}
					onTabChange={onTabChange}
					counts={{ transactions: activity?.count }}
					caption={caption}
					onClose={() => onDetail(null)}
				>
					{isSafeSpendingTransactionsTab(detail) &&
						(transferLinks.isError ? (
							<Alert
								variant="destructive"
								aria-label="Safe spending transactions"
							>
								<AlertTitle>Transactions unavailable</AlertTitle>
								<AlertDescription>
									Transactions could not be loaded. The Safe Spending budget is
									still available.
								</AlertDescription>
								<Button
									variant="link"
									disabled={transferLinks.isFetching}
									onClick={() => void transferLinks.refetch()}
								>
									Retry transactions
								</Button>
							</Alert>
						) : !activity || !summary.data ? (
							<div className="grid content-start gap-3" aria-busy="true">
								<Skeleton className="h-32 w-full" />
								<p role="status" className="m-0 text-sm text-muted-foreground">
									Loading transactions…
								</p>
							</div>
						) : (
							<SafeSpendingCyclePanel
								key={detail}
								activity={activity}
								summary={summary.data}
								accounts={accounts ?? []}
								transactions={savedRows}
								readOnly={readOnly}
								transactionOrder={transactionOrder}
								onTransactionOrderChange={setTransactionOrder}
							/>
						))}
					{detail === "configure" && (
						<SafeSpendingConfigurePanel
							config={{
								cycleStartDay: settings.cycleStartDay,
								paydayDay: settings.paydayDay,
								savingsTarget: settings.savingsTarget,
								cards: selections.cards.map((account) => ({
									id: account.id,
									name: account.name,
								})),
								trackedIds: selections.trackedIds,
								spendingAccounts: selections.spendableAccounts.map(
									(account) => ({ id: account.id, name: account.name }),
								),
								trackedSpendingIds: selections.spendingIds,
							}}
							billCandidates={selections.billCandidates}
							trackedBillIds={selections.trackedBillIds}
							accounts={accounts ?? []}
							incomeCandidates={selections.incomeCandidates}
							incomeScheduleIds={settings.incomeScheduleIds}
							onToggleIncomeSource={selections.toggleIncomeSource}
							onToggleBill={selections.toggleBill}
							onToggleAccount={selections.toggleAccount}
							onToggleSpendingAccount={selections.toggleSpendingAccount}
							onUpdateConfig={updateSettings}
						/>
					)}
				</SafeSpendingDetailShell>
			)}
		</>
	);
}
