import { useMemo, useState } from "react";
import { accountTransactions } from "../domain/accountActivity.ts";
import { dateLabel, money } from "../domain/format.ts";
import {
	isHistoricalTransaction,
	type Account,
	type Transaction,
} from "../domain/model.ts";
import type { EditorTarget } from "../domain/accountEdits.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { AccountIcon } from "./AccountIcon.tsx";
import { AccountDetails } from "./activity/AccountDetails.tsx";
import { RecurringRules } from "./activity/RecurringRules.tsx";
import { Transactions } from "./activity/Transactions.tsx";
import { Drawer } from "./Drawer.tsx";
import { Tabs } from "./Tabs.tsx";

export function AccountDialog({
	account,
	accounts,
	transactions,
	startDate,
	readOnly,
	temporary,
	onClose,
	onEdit,
}: {
	account: Account;
	accounts: Account[];
	transactions: Transaction[];
	startDate: string;
	readOnly: boolean;
	temporary: boolean;
	onClose: () => void;
	onEdit: (target: EditorTarget) => void;
}) {
	const [view, setView] = useTransactionView();
	// Recorded facts render from saved rows alone. The forecast loads only
	// after the viewer asks for projected activity or the projected metric.
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
	const recurring = useMemo(
		() =>
			transactions.filter(
				(transaction) =>
					transaction.frequency !== "once" &&
					(transaction.fromId === account.id ||
						transaction.toId === account.id),
			),
		[transactions, account.id],
	);
	// Saved rows alone decide whether projected activity can exist: a
	// recurring rule or future-dated record for this account. No forecast
	// is involved, so the source select stays available even with zero
	// recorded facts.
	const canRequestForecast = useMemo(
		() =>
			transactions.some(
				(transaction) =>
					!isHistoricalTransaction(transaction, startDate) &&
					(transaction.fromId === account.id ||
						transaction.toId === account.id),
			),
		[transactions, account.id, startDate],
	);
	const last = projection?.points.at(-1);
	// Finance-first: null means not requested. Once a forecast resolves,
	// a missing account falls back to 0 (the pre-split `?? 0` behavior)
	// instead of a no-op Load button.
	const projectedEnding = !forecastRequested
		? null
		: projection == null
			? null
			: (last?.balances[account.id] ?? 0);
	return (
		<Drawer
			side="right"
			open
			onClose={onClose}
			label={account.name}
			appearance={{
				title: account.name,
				eyebrow: `Account activity · ${temporary ? "Changes" : "Saved"}`,
				coverage: "full",
			}}
		>
			<div className="flex items-center gap-4 pb-2 max-sm:flex-wrap max-sm:gap-3">
				<AccountIcon account={account} size="lg" className="max-sm:size-10" />
				<div className="flex flex-col gap-1">
					{/* Starting balance owns the saved adjusted balance from /balances (same chronological replay as the projection baseline, so it coincides with the projection start when the model is unchanged). It never waits for a forecast. */}
					<span className="text-xs text-muted">Starting balance</span>
					<strong className="type-value text-3xl leading-[1.3] font-medium tracking-tight">
						{money(!account.enabled ? 0 : account.balance)}
					</strong>
				</div>
				<div className="ml-auto flex flex-col items-end gap-2 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:gap-2 max-sm:pt-1">
					<span className="text-xs text-muted">
						As of {dateLabel(account.observedOn, true)}
					</span>
				</div>
			</div>
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
				className="my-4"
				panelClassName="flex flex-col gap-4"
			>
				{view === "transactions" ? (
					<Transactions
						occurrences={occurrences}
						rows={transactions}
						accounts={accounts}
						startDate={startDate}
						readOnly={readOnly}
						onEdit={onEdit}
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
				) : view === "recurring" ? (
					<RecurringRules
						account={account}
						accounts={accounts}
						transactions={transactions}
						startDate={startDate}
						readOnly={readOnly}
						onEdit={onEdit}
					/>
				) : (
					<AccountDetails
						key={account.id}
						account={account}
						endingBalance={projectedEnding}
						projected={{
							loading: forecastRequested && forecast.loading,
							error: forecastRequested ? (forecast.baseError ?? null) : null,
							requested: forecastRequested,
							request: () => setForecastRequested(true),
							retry: forecast.retryProjection,
						}}
						readOnly={readOnly}
					/>
				)}
			</Tabs>
		</Drawer>
	);
}

function useTransactionView() {
	return useState<"transactions" | "details" | "recurring">("transactions");
}
