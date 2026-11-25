import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useRouter } from "@tanstack/react-router";
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
import {
	DEFAULT_PROJECTION_YEARS,
	useRemoteProjection,
} from "../../state/useRemoteProjection.ts";
import { useSchedules } from "../../state/workspaceResources.ts";
import { scheduleToDisplay } from "../../domain/transactionRows.ts";
import { AccountIcon } from "../../components/AccountIcon.tsx";
import { AccountDetails } from "../../components/activity/AccountDetails.tsx";
import { AccountStatements } from "../../components/activity/AccountStatements.tsx";
import { LoanDetails } from "../../components/activity/LoanDetails.tsx";
import {
	CardKindSuggestion,
	focusAccountKindPicker,
} from "../../components/activity/CardKindSuggestion.tsx";
import { useCardKindSuggestion } from "../../state/cardKindSuggestion.ts";
import {
	accountBalanceHeaderData,
	componentIds,
	isGroupedDisplay,
	toDisplayTransaction,
} from "../../domain/accountDisplay.ts";
import { RecurringRules } from "../../components/activity/RecurringRules.tsx";
import { Transactions } from "../../components/activity/Transactions.tsx";
import { AccountBalances } from "./AccountBalances.tsx";
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
import { cn } from "@/lib/utils.ts";

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
	const locked = readOnly || account.readOnly || isGroupedDisplay(account);
	// A synced account's name is owner config, so the owner may rename it.
	// Grouped loan displays stay locked, as does a shared workspace's view.
	const nameEditable =
		account.readOnly && !isGroupedDisplay(account) && !readOnly;
	const adjustments = useAccountAdjustments(
		account.id,
		!isGroupedDisplay(account),
	);
	const edit = useAccountEdit(
		account,
		locked,
		adjustments.data ?? [],
		nameEditable,
	);
	const kindSuggestion = useCardKindSuggestion(account.id, account.kind);
	const actionsVisible = edit.dirty || edit.saving;
	const accountNameRef = useRef<HTMLInputElement>(null);
	const saveButtonRef = useRef<HTMLButtonElement>(null);
	const sectionRef = useRef<HTMLElement>(null);
	const actionBarRef = useRef<HTMLDivElement>(null);
	const saveHadFocus = useRef(false);
	const savingStarted = useRef(false);
	useEffect(() => {
		if (edit.saving) {
			savingStarted.current = true;
			return;
		}
		if (savingStarted.current && !actionsVisible && saveHadFocus.current) {
			accountNameRef.current?.focus();
		}
		savingStarted.current = false;
		saveHadFocus.current = false;
	}, [actionsVisible, edit.saving]);
	useLayoutEffect(() => {
		const section = sectionRef.current;
		const bar = actionBarRef.current;
		if (!section || !bar) return;
		const updateClearance = () => {
			section.style.setProperty(
				"--account-action-bar-height",
				`${bar.getBoundingClientRect().height}px`,
			);
		};
		updateClearance();
		const observer = new ResizeObserver(updateClearance);
		observer.observe(bar);
		return () => {
			observer.disconnect();
			section.style.removeProperty("--account-action-bar-height");
		};
	}, [actionsVisible]);
	const [pendingEdit, setPendingEdit] = useState<EditorTarget | null>(null);
	const requestEdit = (target: EditorTarget) => {
		if (edit.saving) return;
		if (edit.dirty) {
			setPendingEdit(target);
			edit.setConfirmCancel(true);
			return;
		}
		onEdit(target);
	};
	const requestClose = () => {
		if (edit.saving) return;
		setPendingEdit(null);
		if (edit.dirty) {
			edit.setConfirmCancel(true);
			return;
		}
		onClose();
	};
	const reviewKindSuggestion = () => {
		if (edit.saving) return;
		// Review lands on the existing picker with the current kind intact.
		// Saving the chosen kind stays with the account form below.
		focusAccountKindPicker(edit.formId);
	};
	const breadcrumbSlot = useBreadcrumbSlot();
	const breadcrumb = (
		<nav aria-label="Breadcrumb">
			<ol className="m-0 flex min-w-0 list-none flex-nowrap items-center gap-2 p-0 text-xs">
				<li className="flex-none">
					<Link
						to="/accounts"
						className="text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-4"
					>
						Accounts
					</Link>
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
		years: DEFAULT_PROJECTION_YEARS,
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
	// Card statements own a dedicated tab for eligible cards. Grouped loan
	// displays and every other kind keep the original three-tab layout.
	const showStatementsTab =
		account.kind === "credit_card" && !isGroupedDisplay(account);
	return (
		<section
			ref={sectionRef}
			aria-label="Account details"
			className={cn(
				"grid min-w-0 gap-6 [&>*]:min-w-0",
				actionsVisible &&
					"max-sm:pb-[max(var(--account-action-bar-height,4rem),calc(4rem_+_env(safe-area-inset-bottom)))]",
			)}
		>
			{breadcrumbSlot ? createPortal(breadcrumb, breadcrumbSlot) : null}
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex min-w-0 items-center gap-3">
					<AccountIcon account={account} size="lg" />
					<Input
						ref={accountNameRef}
						id={`${edit.formId}-name`}
						aria-label="Account name"
						name="name"
						type="text"
						inputMode="text"
						enterKeyHint="done"
						autoComplete="off"
						required
						maxLength={100}
						value={edit.draft.name}
						onChange={(event) =>
							edit.update({ name: event.target.value }, "name")
						}
						readOnly={(locked && !nameEditable) || edit.saving}
						form={edit.formId}
						className="min-w-0 flex-1 text-lg font-semibold max-sm:min-h-11"
					/>
				</div>
				<form
					id={edit.formId}
					className="min-w-0"
					onSubmit={(event) => {
						saveHadFocus.current =
							document.activeElement === saveButtonRef.current;
						void edit.submit(event);
					}}
				>
					{(() => {
						// The header shows both recorded bases. Manual accounts keep
						// the balance editor; synced or grouped accounts get the
						// read-only figures. The form stays mounted so the name
						// field and the save controls keep working in every branch.
						if (!account.readOnly && !isGroupedDisplay(account)) {
							return <AccountBalanceValue edit={edit} readOnly={locked} />;
						}
						return (
							<div className="min-w-0 pt-1 pb-2 text-left md:text-right">
								<AccountBalances
									data={accountBalanceHeaderData(account)}
									columns={2}
								/>
							</div>
						);
					})()}
				</form>
			</div>
			<Tabs
				defaultValue="transactions"
				className="gap-0 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-4"
			>
				<TabsList
					variant="line"
					scrollable
					aria-label="Account view"
					className="mb-0 min-w-0 flex-1 gap-6 max-sm:gap-5 sm:col-start-1 sm:row-start-1"
				>
					<TabsTrigger value="transactions" className="flex-none">
						Transactions
						<Badge variant="secondary">{occurrences.length}</Badge>
					</TabsTrigger>
					<TabsTrigger value="recurring" className="flex-none">
						Recurring
						<Badge variant="secondary">{recurring.length}</Badge>
					</TabsTrigger>
					{showStatementsTab && (
						<TabsTrigger value="statements" className="flex-none">
							Statements
						</TabsTrigger>
					)}
					<TabsTrigger value="details" className="flex-none">
						Details
					</TabsTrigger>
				</TabsList>
				<TabsContent
					value="transactions"
					className="flex min-w-0 flex-col gap-4 sm:col-span-2 sm:row-start-2"
				>
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
							error: forecastRequested ? (forecast.baseError ?? null) : null,
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
				</TabsContent>
				<TabsContent
					value="recurring"
					className="flex min-w-0 flex-col gap-4 sm:col-span-2 sm:row-start-2"
				>
					{rulesQuery.isPending ? (
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
					)}
				</TabsContent>
				{showStatementsTab && (
					<TabsContent
						value="statements"
						className="flex min-w-0 flex-col gap-4 sm:col-span-2 sm:row-start-2"
					>
						<AccountStatements
							key={`statements-${account.id}`}
							accountId={account.id}
						/>
					</TabsContent>
				)}
				<TabsContent
					value="details"
					className="flex min-w-0 flex-col gap-4 sm:col-span-2 sm:row-start-2"
				>
					{kindSuggestion.finding && (
						<CardKindSuggestion
							finding={kindSuggestion.finding}
							readOnly={locked}
							busy={kindSuggestion.dismissing}
							onReview={reviewKindSuggestion}
							onDismiss={() => void kindSuggestion.dismiss()}
						/>
					)}
					{isGroupedDisplay(account) ? (
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
							readOnly={readOnly}
						/>
					)}
				</TabsContent>
				{actionsVisible && (
					<div
						ref={actionBarRef}
						data-account-action-bar
						className="ml-auto flex flex-wrap shrink-0 items-center justify-end gap-2 max-sm:fixed max-sm:inset-x-0 max-sm:w-full max-sm:bottom-0 max-sm:z-(--z-local) max-sm:min-h-[calc(4rem_+_env(safe-area-inset-bottom))] max-sm:border-t max-sm:border-border max-sm:bg-card max-sm:pl-[max(1.25rem,env(safe-area-inset-left))] max-sm:pr-[max(1.25rem,env(safe-area-inset-right))] max-sm:pt-2 max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:col-start-2 sm:row-start-1 sm:self-center"
					>
						<Button
							type="button"
							variant="secondary"
							className="max-sm:min-h-11"
							onClick={requestClose}
						>
							Cancel
						</Button>
						<Button
							ref={saveButtonRef}
							type="submit"
							form={edit.formId}
							className="max-sm:min-h-11"
							disabled={edit.saveBlocked || !edit.dirty}
						>
							{edit.saving ? "Saving…" : "Save changes"}
						</Button>
					</div>
				)}
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

/**
 * Route-level account page. Resolves the account from saved rows and
 * renders the detail in the main window. The topbar renders the
 * breadcrumb link to the accounts list. Editors open as overlays
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
				<p>Account missing or unavailable in this workspace.</p>
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
