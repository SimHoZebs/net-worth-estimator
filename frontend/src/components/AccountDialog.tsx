import { useMemo, useState } from "react";
import { accountTransactions } from "../domain/accountActivity.ts";
import { dateLabel, money } from "../domain/format.ts";
import type { Account, Plan } from "../domain/model.ts";
import type { EditorTarget } from "../domain/planEdits.ts";
import type { Projection } from "../domain/result.ts";
import { AccountIcon } from "./AccountIcon.tsx";
import { AccountDetails } from "./activity/AccountDetails.tsx";
import { Transactions } from "./activity/Transactions.tsx";
import { Tabs } from "./Tabs.tsx";
import { Badge, Modal } from "./ui.tsx";

export function AccountDialog({
	account,
	plan,
	projection,
	temporary,
	onClose,
	onEdit,
}: {
	account: Account;
	plan: Plan;
	projection: Projection;
	temporary: boolean;
	onClose: () => void;
	onEdit: (target: EditorTarget) => void;
}) {
	const [view, setView] = useState<"transactions" | "details">("transactions");
	const transactions = useMemo(
		() => accountTransactions({ accountId: account.id, plan, projection }),
		[account.id, plan, projection],
	);
	const starting =
		projection.points.find((point) => point.date === plan.startDate) ??
		projection.points[0];
	const last = projection.points.at(-1);
	return (
		<Modal
			title={account.name}
			eyebrow={`Account activity · ${temporary ? "Temporary version" : "Saved plan"}`}
			onClose={onClose}
			wide
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
					<Badge tone={account.provenance === "recorded" ? "green" : "outline"}>
						{account.provenance === "recorded"
							? "Recorded balance"
							: "Modeled estimate"}
					</Badge>
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
					{ id: "details", label: "Account details" },
				]}
				value={view}
				onChange={setView}
				label="Account view"
				className="account-view-tabs"
			>
				{view === "transactions" ? (
					<Transactions
						transactions={transactions}
						plan={plan}
						horizon={last?.date ?? plan.startDate}
						onEdit={onEdit}
					/>
				) : (
					<AccountDetails
						account={account}
						endingBalance={last?.balances[account.id] ?? 0}
						onEdit={() => onEdit({ kind: "account", item: account })}
					/>
				)}
			</Tabs>
		</Modal>
	);
}
