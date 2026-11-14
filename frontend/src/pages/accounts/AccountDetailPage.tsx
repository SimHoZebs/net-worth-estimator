import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "@tanstack/react-router";
import { useAccountAdjustments } from "../../state/accountAdjustments.ts";
import { useAccountEdit } from "../../components/activity/useAccountEdit.ts";
import { AccountBalanceValue } from "../../components/activity/AccountBalanceValue.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { accountTransactions } from "../../domain/accountActivity.ts";
import {
	isHistoricalTransaction,
	type Account,
	type Transaction,
} from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import { useRemoteProjection } from "../../state/useRemoteProjection.ts";
import { useSchedules } from "../../state/workspaceResources.ts";
import { scheduleToDisplay } from "../../domain/transactionRows.ts";
import { AccountIcon } from "../../components/AccountIcon.tsx";
import { AccountDetails } from "../../components/activity/AccountDetails.tsx";
import { LoanDetails } from "../../components/activity/LoanDetails.tsx";
import {
	componentIds,
	isGroupedDisplay,
	toDisplayTransaction,
} from "../../domain/accountDisplay.ts";
import { RecurringRules } from "../../components/activity/RecurringRules.tsx";
import { Transactions } from "../../components/activity/Transactions.tsx";
import { BalanceHistory } from "./BalanceHistory.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs.tsx";
import {
	useSavedAccounts,
	useSavedStartDate,
	useSavedTransactions,
} from "../../state/savedState.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";
import { useWorkspaceOverlays } from "../../workspace/useWorkspaceOverlays.ts";
import { useBreadcrumbSlot } from "../../workspace/breadcrumbSlot.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ArrowLeft } from "lucide-react";

/**
 * Presentational account detail. Renders the transaction, recurring,
 * and settings tabs in the main window. The topbar renders the
 * breadcrumb trail.
 */
export function AccountDetailView({
	account,
	accounts,
	transactions,
	startDate,
	readOnly,
	onClose,
	onEdit,
}: {
	account: Account;
	accounts: Account[];
	transactions: Transaction[];
	startDate: string;
	readOnly: boolean;
	onClose: () => void;
	onEdit: (target: EditorTarget) => void;
}) {
	const [view, setView] = useTransactionView();
	// Display accounts keep their atomic loan editor and component balances.
	const locked = readOnly || account.readOnly || isGroupedDisplay(account);
	const adjustments = useAccountAdjustments(
		account.id,
		!isGroupedDisplay(account),
	);
	const edit = useAccountEdit(account, locked, adjustments.data ?? []);
	const [pendingEdit, setPendingEdit] = useState<EditorTarget | null>(null);
	const requestEdit = (target: EditorTarget) => {
		if (edit.saving) return;
		if (edit.activeField !== null) {
			setPendingEdit(target);
			edit.setConfirmCancel(true);
			return;
		}
		onEdit(target);
	};
	const requestClose = () => {
		if (edit.saving) return;
		setPendingEdit(null);
		if (edit.activeField !== null) {
			edit.setConfirmCancel(true);
			return;
		}
		onClose();
	};
	const breadcrumbSlot = useBreadcrumbSlot();
	const breadcrumb = (
		<nav aria-label="Breadcrumb">
			<ol className="m-0 flex min-w-0 list-none flex-nowrap items-center gap-2 p-0 text-xs">
				<li className="flex-none">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={requestClose}
					>
						<ArrowLeft size={16} aria-hidden="true" />
						Accounts
					</Button>
				</li>
				<li aria-hidden="true" className="flex-none text-muted-foreground">
					/
				</li>
				<li
					aria-current="page"
					title={account.name}
					className="min-w-0 max-w-[32ch] truncate font-medium"
				>
					{account.name}
				</li>
			</ol>
		</nav>
	);
	// Recorded facts render from saved rows alone. The forecast loads only
	// after the viewer asks for projected activity.
	const [forecastRequested, setForecastRequested] = useState(false);
	const forecast = useRemoteProjection({
		ranges: false,
		enabled: forecastRequested,
	});
	const projection =
		forecast.base instanceof Error || forecast.base === null
			? null
			: forecast.base;
	// Balance adjustments are checkpoint reconciliation, not transactions,
	// so they stay out of the transaction list and render in balance
	// history instead.
	const occurrences = useMemo(
		() =>
			accountTransactions({
				accountId: account.id,
				accounts,
				transactions,
				startDate,
				projection,
			}),
		[account.id, accounts, transactions, startDate, projection],
	);
	const rulesQuery = useSchedules();
	const rules = rulesQuery.data?.schedules ?? null;
	const accountRules = useMemo(
		() =>
			(rules ?? []).filter((rule) =>
				componentIds(account).some(
					(id) =>
						rule.sourceAccountId === id ||
						(rule.destinations ?? []).includes(id),
				),
			),
		[rules, account],
	);
	const recurring = useMemo(
		() =>
			accountRules.map((rule) =>
				toDisplayTransaction(scheduleToDisplay(rule), accounts),
			),
		[accountRules, accounts],
	);
	// The activity tab maps projected occurrences back to their saved
	// definition, and both transactions and rules own occurrences.
	const savedState = useMemo(
		() => [...transactions, ...recurring],
		[transactions, recurring],
	);
	// Saved rows alone decide whether projected activity can exist: a
	// recurring rule or future-dated record for this account. No forecast
	// is involved, so the source select stays available even with zero
	// recorded facts.
	const canRequestForecast = useMemo(
		() =>
			accountRules.length > 0 ||
			transactions.some(
				(transaction) =>
					!isHistoricalTransaction(transaction, startDate) &&
					componentIds(account).some(
						(id) => transaction.fromId === id || transaction.toId === id,
					),
			),
		[accountRules, transactions, account, startDate],
	);
	return (
		<section
			aria-label="Account details"
			className="grid min-w-0 gap-6 [&>*]:min-w-0"
		>
			{breadcrumbSlot ? createPortal(breadcrumb, breadcrumbSlot) : null}
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex min-w-0 items-center gap-3">
					<AccountIcon account={account} size="lg" />
					<Input
						id={`${edit.formId}-name`}
						aria-label="Account name"
						name="name"
						required
						maxLength={100}
						value={edit.draft.name}
						onChange={(event) =>
							edit.update({ name: event.target.value }, "name")
						}
						readOnly={locked || edit.saving}
						form={edit.formId}
						className="min-w-0 flex-1 text-lg font-semibold"
					/>
				</div>
				<form
					id={edit.formId}
					className="min-w-0"
					onSubmit={(event) => void edit.submit(event)}
				>
					<AccountBalanceValue edit={edit} readOnly={locked} />
				</form>
			</div>
			<Tabs
				value={view}
				onValueChange={(next) => {
					if (next) setView(next as "transactions" | "details" | "recurring");
				}}
				className="gap-0"
			>
				<TabsList
					variant="line"
					aria-label="Account view"
					className="mb-0 flex w-full gap-6 overflow-x-auto p-0 max-sm:gap-5"
				>
					<TabsTrigger value="transactions" className="flex-none">
						Transactions
						<Badge variant="secondary">{occurrences.length}</Badge>
					</TabsTrigger>
					<TabsTrigger value="recurring" className="flex-none">
						Recurring
						<Badge variant="secondary">{recurring.length}</Badge>
					</TabsTrigger>
					<TabsTrigger value="details" className="flex-none">
						Account details
					</TabsTrigger>
				</TabsList>
				<TabsContent value={view} className="flex min-w-0 flex-col gap-4">
					{view === "transactions" ? (
						<>
							<Transactions
								occurrences={occurrences}
								rows={savedState}
								accounts={accounts}
								startDate={startDate}
								readOnly={readOnly}
								onEdit={requestEdit}
								onSourceChange={(source) => {
									if (source !== "historical") setForecastRequested(true);
								}}
								canRequestForecast={canRequestForecast}
								projected={{
									loading: forecastRequested && forecast.loading,
									error: forecastRequested
										? (forecast.baseError ?? null)
										: null,
									requested: forecastRequested,
									retry: forecast.retryProjection,
								}}
							/>
							{!isGroupedDisplay(account) && (
								<BalanceHistory
									adjustments={adjustments.data ?? []}
									isPending={adjustments.isPending}
									isError={adjustments.isError}
									onRetry={() => void adjustments.refetch()}
								/>
							)}
						</>
					) : view === "recurring" ? (
						rulesQuery.isPending ? (
							<p role="status">Loading recurring transactions…</p>
						) : rulesQuery.isError ? (
							<p role="alert">
								Recurring transactions could not be loaded.{" "}
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => void rulesQuery.refetch()}
								>
									Retry
								</Button>
							</p>
						) : (
							<RecurringRules
								account={account}
								accounts={accounts}
								rules={accountRules}
								startDate={startDate}
								readOnly={readOnly}
								onEdit={requestEdit}
							/>
						)
					) : isGroupedDisplay(account) ? (
						<LoanDetails
							account={account}
							readOnly={readOnly}
							onEdit={requestEdit}
						/>
					) : (
						<AccountDetails
							key={account.id}
							account={account}
							edit={edit}
							readOnly={locked}
						/>
					)}
				</TabsContent>
			</Tabs>
			{edit.error && (
				<Alert variant="destructive">
					<AlertDescription>{edit.error}</AlertDescription>
				</Alert>
			)}
			{edit.saving && (
				<p role="status" className="text-xs text-muted-foreground">
					Saving…
				</p>
			)}
			<div className="sticky bottom-0 z-(--z-local) mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card py-3">
				<Button type="button" variant="secondary" onClick={requestClose}>
					Cancel
				</Button>
				<Button
					type="submit"
					form={edit.formId}
					disabled={edit.saveBlocked || !edit.dirty}
				>
					{edit.saving ? "Saving…" : "Save changes"}
				</Button>
			</div>
			{edit.confirmCancel && (
				<AlertDialog
					open
					onOpenChange={(open) => {
						if (!open) {
							setPendingEdit(null);
							edit.setConfirmCancel(false);
						}
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
							<AlertDialogDescription>
								Closing now loses the edits in this form. Continue editing to
								keep them, or discard them.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Continue editing</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={() => {
									edit.reset();
									setPendingEdit(null);
									if (pendingEdit) onEdit(pendingEdit);
									else onClose();
								}}
							>
								Discard changes
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
		</section>
	);
}

function useTransactionView() {
	return useState<"transactions" | "details" | "recurring">("transactions");
}

/**
 * Route-level account page. Resolves the account from saved rows and
 * renders the detail in the main window. The topbar renders the
 * breadcrumb back to the accounts list. Editors open as overlays
 * above this page.
 */
export function AccountDetailPage({ accountId }: { accountId: string }) {
	const router = useRouter();
	const overlays = useWorkspaceOverlays();
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const startDate = useSavedStartDate();
	const readOnly = useUserReadOnly();
	if (!accounts || !transactions || !startDate) {
		return <p role="status">Loading accounts…</p>;
	}
	const account = accounts.find(
		(item) => item.id === accountId && !item.archived,
	);
	if (!account) {
		return (
			<section aria-label="Account details" className="grid gap-4 p-6">
				<h2 className="text-2xl">Account not found</h2>
				<p>
					This account does not exist or is not available in this workspace.
				</p>
				<div>
					<Button
						variant="secondary"
						onClick={() => void router.navigate({ to: "/accounts" })}
					>
						<ArrowLeft size={16} aria-hidden="true" />
						Back to accounts
					</Button>
				</div>
			</section>
		);
	}
	return (
		<AccountDetailView
			key={account.id}
			account={account}
			accounts={accounts}
			transactions={transactions}
			startDate={startDate}
			readOnly={readOnly}
			onClose={() => void router.navigate({ to: "/accounts" })}
			onEdit={overlays.openEditor}
		/>
	);
}
