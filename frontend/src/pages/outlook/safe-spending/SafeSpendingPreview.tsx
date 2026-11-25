import { CalendarDays, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
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
import type { SafeSpendingSettings } from "@/api/contracts.ts";
import type { SafeSpendingDetailTab } from "./safeSpendingDetailModel.ts";
import { useSafeSpendingSettings } from "@/state/useSafeSpendingSettings.ts";
import {
	SAFE_SPENDING_LABELS as labels,
	transactionCycleLabel,
} from "./safeSpendingLabels.ts";
import { useSafeSpendingSummary } from "@/state/useSafeSpendingSummary.ts";
import { SafeSpendingBudget } from "./SafeSpendingBudget.tsx";
import { buildSafeSpendingActivity } from "./safeSpendingActivity.ts";
import { useSafeSpendingSelections } from "./useSafeSpendingSelections.ts";
import { SafeSpendingDetail } from "./SafeSpendingDetail.tsx";

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
	const updateSettings = settingsState.updateSettings;
	const settings = useMemo<SafeSpendingSettings>(
		() => ({
			cycleStartDay: settingsState.cycleStartDay,
			paydayDay: settingsState.paydayDay,
			savingsTarget: settingsState.savingsTarget,
			accountIds: settingsState.accountIds,
			spendingAccountIds: settingsState.spendingAccountIds,
			incomeScheduleIds: settingsState.incomeScheduleIds,
			transactionIds: settingsState.transactionIds,
		}),
		[
			settingsState.cycleStartDay,
			settingsState.paydayDay,
			settingsState.savingsTarget,
			settingsState.accountIds,
			settingsState.spendingAccountIds,
			settingsState.incomeScheduleIds,
			settingsState.transactionIds,
		],
	);
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
					{summary.isError && !summary.data ? (
						<Alert variant="destructive" aria-label="Safe spending evidence">
							<AlertDescription>
								Safe spending evidence could not be loaded.
							</AlertDescription>
							<Button variant="link" onClick={() => void summary.refetch()}>
								Retry evidence
							</Button>
						</Alert>
					) : !summary.data || summary.isPending || settingsState.pending ? (
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
								{transactionCycleLabel(activity?.count)}
								<ChevronRight size={14} aria-hidden="true" />
							</Button>
						</>
					)}
				</CardContent>
			</Card>
			{detail && (
				<SafeSpendingDetail
					tab={detail}
					onTabChange={onTabChange}
					onClose={() => onDetail(null)}
					settings={settings}
					settingsReady={!settingsState.pending && !settingsState.error}
					settingsMutating={settingsState.mutating}
					settingsRevision={settingsState.revision}
					updateSettings={updateSettings}
					accounts={accounts ?? []}
					rules={rules}
					savedRules={savedRules ?? []}
					transactions={savedRows}
					summary={summary.data}
					activity={activity}
					transferLinksError={transferLinks.isError}
					transferLinksFetching={transferLinks.isFetching}
					onRetryTransferLinks={() => void transferLinks.refetch()}
					readOnly={readOnly}
					transactionOrder={transactionOrder}
					onTransactionOrderChange={setTransactionOrder}
				/>
			)}
		</>
	);
}
