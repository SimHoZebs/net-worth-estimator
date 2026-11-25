import { LoaderCircle, Save, X } from "lucide-react";
import { useId } from "react";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import type { SafeSpendingSettings } from "@/api/contracts.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import type { TransactionOrder } from "@/domain/transactionSort.ts";
import type { SafeSpendingSettingsUpdate } from "@/state/useSafeSpendingSettings.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { SheetClose } from "@/components/ui/sheet.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
	DiscardConfirm,
	useDiscardGuard,
} from "../../../components/editors/EditorDialog.tsx";
import { SafeSpendingConfigurePanel } from "./SafeSpendingConfigurePanel.tsx";
import { SafeSpendingCyclePanel } from "./SafeSpendingCyclePanel.tsx";
import { SafeSpendingDetailShell } from "./SafeSpendingDetailShell.tsx";
import {
	activeCycleCaption,
	isSafeSpendingTransactionsTab,
	type SafeSpendingDetailTab,
} from "./safeSpendingDetailModel.ts";
import type { SafeSpendingActivity } from "./safeSpendingActivity.ts";
import { useSafeSpendingDraft } from "./useSafeSpendingDraft.ts";

export function SafeSpendingDetail({
	tab,
	onTabChange,
	onClose,
	settings,
	settingsReady,
	settingsMutating,
	settingsRevision,
	updateSettings,
	accounts,
	rules,
	savedRules,
	transactions,
	summary,
	activity,
	transferLinksError,
	transferLinksFetching,
	onRetryTransferLinks,
	readOnly,
	transactionOrder,
	onTransactionOrderChange,
}: {
	tab: SafeSpendingDetailTab;
	onTabChange: (tab: SafeSpendingDetailTab) => void;
	onClose: () => void;
	settings: SafeSpendingSettings;
	settingsReady: boolean;
	settingsMutating: boolean;
	settingsRevision: number;
	updateSettings: SafeSpendingSettingsUpdate;
	accounts: Account[];
	rules: Transaction[];
	savedRules: Schedule[];
	transactions: Transaction[];
	summary: SafeSpendingSummary | undefined;
	activity: SafeSpendingActivity | undefined;
	transferLinksError: boolean;
	transferLinksFetching: boolean;
	onRetryTransferLinks: () => void;
	readOnly: boolean;
	transactionOrder: TransactionOrder;
	onTransactionOrderChange: (order: TransactionOrder) => void;
}) {
	const formId = useId();
	const draft = useSafeSpendingDraft({
		settings,
		settingsMutating,
		settingsRevision,
		updateSettings,
		accounts,
		rules,
		savedRules,
		displayToday: summary?.cashAsOf ?? "",
	});
	const guard = useDiscardGuard({ dirty: draft.dirty, busy: draft.saving });
	const caption = summary
		? activeCycleCaption({
				start: summary.cycleStart,
				end: summary.cycleEnd,
			})
		: undefined;

	return (
		<>
			<SafeSpendingDetailShell
				tab={tab}
				onTabChange={onTabChange}
				counts={{ transactions: activity?.count }}
				caption={caption}
				onClose={() => guard.requestClose(onClose)}
				showCloseButton={false}
				headerStatus={
					draft.saving ? (
						<span role="status" aria-live="polite">
							Saving changes…
						</span>
					) : undefined
				}
				headerActions={
					<>
						{tab === "configure" && (
							<Button
								type="submit"
								form={formId}
								size="icon-sm"
								disabled={!settingsReady || !draft.dirty || draft.saving}
								aria-busy={draft.saving}
							>
								{draft.saving ? (
									<LoaderCircle className="animate-spin" aria-hidden="true" />
								) : (
									<Save aria-hidden="true" />
								)}
								<span className="sr-only">Save</span>
							</Button>
						)}
						<SheetClose
							disabled={draft.saving}
							render={<Button type="button" variant="ghost" size="icon-sm" />}
						>
							<X aria-hidden="true" />
							<span className="sr-only">Close</span>
						</SheetClose>
					</>
				}
			>
				{isSafeSpendingTransactionsTab(tab) &&
					(transferLinksError ? (
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
								disabled={transferLinksFetching}
								onClick={onRetryTransferLinks}
							>
								Retry transactions
							</Button>
						</Alert>
					) : !activity || !summary ? (
						<div className="grid content-start gap-3" aria-busy="true">
							<Skeleton className="h-32 w-full" />
							<p role="status" className="m-0 text-sm text-muted-foreground">
								Loading transactions…
							</p>
						</div>
					) : (
						<SafeSpendingCyclePanel
							key={tab}
							activity={activity}
							summary={summary}
							accounts={accounts}
							transactions={transactions}
							readOnly={readOnly}
							transactionOrder={transactionOrder}
							onTransactionOrderChange={onTransactionOrderChange}
						/>
					))}
				{tab === "configure" && (
					<SafeSpendingConfigurePanel
						formId={formId}
						config={{
							cycleStartDay: draft.draft.cycleStartDay,
							paydayDay: draft.draft.paydayDay,
							savingsTarget: draft.draft.savingsTarget,
							cards: draft.selections.cards.map((account) => ({
								id: account.id,
								name: account.name,
							})),
							trackedIds: draft.selections.trackedIds,
							spendingAccounts: draft.selections.spendableAccounts.map(
								(account) => ({ id: account.id, name: account.name }),
							),
							trackedSpendingIds: draft.selections.spendingIds,
						}}
						numericInputs={draft.numericInputs}
						dirtyNumericFields={draft.dirtyNumericFields}
						dirtyTrackedIds={draft.dirtyTrackedIds}
						dirtySpendingIds={draft.dirtySpendingIds}
						dirtyIncomeIds={draft.dirtyIncomeIds}
						dirtyBillIds={draft.dirtyBillIds}
						billCandidates={draft.selections.billCandidates}
						trackedBillIds={draft.selections.trackedBillIds}
						accounts={accounts}
						incomeCandidates={draft.selections.incomeCandidates}
						incomeScheduleIds={draft.draft.incomeScheduleIds}
						disabled={!settingsReady || draft.saving}
						saveFailed={draft.saveFailed}
						onNumericChange={draft.setNumericValue}
						onToggleIncomeSource={draft.selections.toggleIncomeSource}
						onToggleBill={draft.selections.toggleBill}
						onToggleAccount={draft.selections.toggleAccount}
						onToggleSpendingAccount={draft.selections.toggleSpendingAccount}
						onSave={draft.save}
					/>
				)}
			</SafeSpendingDetailShell>
			<DiscardConfirm
				open={guard.confirming}
				onContinue={guard.dismissConfirm}
				onDiscard={onClose}
				busy={draft.saving}
			/>
		</>
	);
}
