import { useMemo, useState } from "react";
import { accountTransactions } from "../domain/accountActivity.ts";
import { dateLabel, money } from "../domain/format.ts";
import type { Account, Transaction } from "../domain/model.ts";
import type { EditorTarget } from "../domain/accountEdits.ts";
import type { Projection } from "../domain/result.ts";
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
	projection,
	readOnly,
	temporary,
	onClose,
	onEdit,
}: {
	account: Account;
	accounts: Account[];
	transactions: Transaction[];
	startDate: string;
	projection: Projection;
	readOnly: boolean;
	temporary: boolean;
	onClose: () => void;
	onEdit: (target: EditorTarget) => void;
}) {
	const [view, setView] = useTransactionView();
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
	const starting =
		projection.points.find((point) => point.date === startDate) ??
		projection.points[0];
	const last = projection.points.at(-1);
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
					<span className="text-xs text-muted">Starting balance</span>
					<strong className="type-value text-3xl leading-[1.3] font-medium tracking-tight">
						{money(
							!account.enabled
								? 0
								: (starting?.balances[account.id] ?? account.balance),
						)}
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
						endingBalance={last?.balances[account.id] ?? 0}
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
