import { useMemo, useState } from "react";
import { accountTransactions } from "../domain/accountActivity.ts";
import { dateLabel, money } from "../domain/format.ts";
import type { Account, Plan } from "../domain/model.ts";
import type { EditorTarget } from "../domain/planEdits.ts";
import type { Projection } from "../domain/result.ts";
import { AccountIcon } from "./AccountIcon.tsx";
import { AccountDetails } from "./activity/AccountDetails.tsx";
import { RecurringRules } from "./activity/RecurringRules.tsx";
import { Transactions } from "./activity/Transactions.tsx";
import { Drawer } from "./Drawer.tsx";
import { Tabs } from "./Tabs.tsx";

export function AccountDialog({
	account,
	plan,
	projection,
	temporary,
	onClose,
	onEdit,
	onApply,
}: {
	account: Account;
	plan: Plan;
	projection: Projection;
	temporary: boolean;
	onClose: () => void;
	onEdit: (target: EditorTarget) => void;
	onApply: (plan: Plan) => boolean;
}) {
	const [view, setView] = useState<"transactions" | "details" | "recurring">(
		"transactions",
	);
	const transactions = useMemo(
		() => accountTransactions({ accountId: account.id, plan, projection }),
		[account.id, plan, projection],
	);
	const recurring = useMemo(
		() =>
			plan.transactions.filter(
				(transaction) =>
					transaction.frequency !== "once" &&
					(transaction.fromId === account.id ||
						transaction.toId === account.id),
			),
		[plan.transactions, account.id],
	);
	const starting =
		projection.points.find((point) => point.date === plan.startDate) ??
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
				eyebrow: `Account activity · ${temporary ? "Changes" : "Saved plan"}`,
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
						count: transactions.length,
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
						transactions={transactions}
						plan={plan}
						horizon={last?.date ?? plan.startDate}
						onEdit={onEdit}
					/>
				) : view === "recurring" ? (
					<RecurringRules account={account} plan={plan} onEdit={onEdit} />
				) : (
					<AccountDetails
						key={account.id}
						account={account}
						plan={plan}
						endingBalance={last?.balances[account.id] ?? 0}
						onApply={onApply}
					/>
				)}
			</Tabs>
		</Drawer>
	);
}
