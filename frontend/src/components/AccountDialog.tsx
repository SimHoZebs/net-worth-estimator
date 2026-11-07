import { useMemo, useState } from "react";
import { useAccountAdjustments } from "../state/accountAdjustments.ts";
import { balanceAdjustmentActivity } from "../domain/balanceAdjustmentActivity.ts";
import { useAccountEdit } from "./activity/useAccountEdit.ts";
import { AccountBalanceValue } from "./activity/AccountBalanceValue.tsx";
import {
	DetailEditActions,
	DiscardConfirm,
} from "./activity/DetailEditActions.tsx";
import {
	transactionControlStyles,
	detailModalClassName,
	detailFooterClassName,
} from "./activity/transactionDetailStyles.ts";
import { ErrorNotice } from "./ErrorNotice.tsx";
import { accountTransactions } from "../domain/accountActivity.ts";
import { dateLabel } from "../domain/format.ts";
import {
	isHistoricalTransaction,
	type Account,
	type Transaction,
} from "../domain/model.ts";
import type { EditorTarget } from "../domain/accountEdits.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useSchedules } from "../state/workspaceResources.ts";
import { scheduleToDisplay } from "../domain/transactionRows.ts";
import { AccountIcon } from "./AccountIcon.tsx";
import { AccountDetails } from "./activity/AccountDetails.tsx";
import { LoanDetails } from "./activity/LoanDetails.tsx";
import {
	componentIds,
	toDisplayTransaction,
} from "../domain/accountDisplay.ts";
import { RecurringRules } from "./activity/RecurringRules.tsx";
import { Transactions } from "./activity/Transactions.tsx";
import { Modal } from "./Modal.tsx";
import { Tabs } from "./Tabs.tsx";

export function AccountDialog({
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
	const locked = readOnly || account.readOnly || Boolean(account.display);
	const adjustments = useAccountAdjustments(account.id, !account.display);
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
	const occurrences = useMemo(
		() => [
			...accountTransactions({
				accountId: account.id,
				accounts,
				transactions,
				startDate,
				projection,
			}),
			...balanceAdjustmentActivity(adjustments.data ?? []),
		],
		[
			account.id,
			accounts,
			transactions,
			startDate,
			projection,
			adjustments.data,
		],
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
		<Modal
			label={account.name}
			wide
			titleSize="plain"
			headerClassName="border-b-0 pb-0"
			className={detailModalClassName}
			focusPanelOnOpen
			onClose={onClose}
			onCloseRequest={() => {
				if (edit.saving) return false;
				setPendingEdit(null);
				if (edit.activeField !== null) {
					edit.setConfirmCancel(true);
					return false;
				}
				return true;
			}}
			title={
				<span className="flex min-w-0 items-center gap-3">
					<AccountIcon account={account} size="lg" />
					<input
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
						className={transactionControlStyles({ shape: "name" })}
					/>
				</span>
			}
			actions={
				edit.activeField !== null ? (
					<DetailEditActions
						formId={edit.formId}
						onDiscard={edit.reset}
						disabled={edit.saveBlocked}
						discardDisabled={edit.saving}
					/>
				) : undefined
			}
		>
			<form id={edit.formId} onSubmit={(event) => void edit.submit(event)}>
				<AccountBalanceValue edit={edit} readOnly={locked} />
				<div className="mt-2 text-sm text-muted">
					<span className="text-xs text-muted">
						{account.balanceCheck
							? `Last balance report ${dateLabel(account.observedOn, true)}`
							: "No balance reported"}
					</span>
				</div>
			</form>
			<Tabs
				items={[
					{
						id: "transactions",
						label: "Transactions",
						count: occurrences.length,
					},
					{ id: "recurring", label: "Recurring", count: recurring.length },
					{ id: "details", label: "Account details" },
				]}
				value={view}
				onChange={setView}
				label="Account view"
				className="my-4 max-sm:flex-wrap max-sm:gap-x-2 max-sm:gap-y-0"
				panelClassName="flex flex-col gap-4"
			>
				{view === "transactions" ? (
					<>
						{!account.display && adjustments.isPending && (
							<p role="status">Loading balance adjustments…</p>
						)}
						{adjustments.isError && (
							<p role="alert">
								Balance adjustments could not be loaded.{" "}
								<button
									type="button"
									onClick={() => void adjustments.refetch()}
								>
									Retry adjustments
								</button>
							</p>
						)}
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
					</>
				) : view === "recurring" ? (
					rulesQuery.isPending ? (
						<p role="status">Loading recurring transactions…</p>
					) : rulesQuery.isError ? (
						<p role="alert">Recurring transactions could not be loaded.</p>
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
				) : account.display ? (
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
			</Tabs>
			<ErrorNotice message={edit.error} />
			{edit.saving && (
				<p role="status" className="text-xs text-muted">
					Saving…
				</p>
			)}
			{edit.confirmCancel && (
				<div className={detailFooterClassName}>
					<DiscardConfirm
						onContinue={() => {
							setPendingEdit(null);
							edit.setConfirmCancel(false);
						}}
						onDiscard={() => {
							edit.reset();
							setPendingEdit(null);
							if (pendingEdit) onEdit(pendingEdit);
							else onClose();
						}}
					/>
				</div>
			)}
		</Modal>
	);
}

function useTransactionView() {
	return useState<"transactions" | "details" | "recurring">("transactions");
}
