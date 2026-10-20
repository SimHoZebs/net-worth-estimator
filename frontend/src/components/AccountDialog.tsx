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
import "./activity/account-activity.css";

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
			plan.movements.filter(
				(movement) =>
					movement.frequency !== "once" &&
					(movement.fromId === account.id || movement.toId === account.id),
			),
		[plan.movements, account.id],
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
			<div className="account-dialog-summary">
				<AccountIcon account={account} />
				<div>
					<span>Starting balance</span>
					<strong>
						{money(
							!account.enabled
								? 0
								: (starting?.balances[account.id] ?? account.balance),
						)}
					</strong>
				</div>
				<div className="account-dialog-basis">
					<span>As of {dateLabel(account.observedOn, true)}</span>
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
				className="account-view-tabs"
				panelClassName="account-activity-panel"
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
