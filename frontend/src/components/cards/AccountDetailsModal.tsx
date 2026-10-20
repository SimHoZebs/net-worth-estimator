import { Repeat2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { accountTransactions } from "../../domain/accountActivity.ts";
import { dateLabel, exactMoney } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import type { Projection } from "../../domain/result.ts";
import { AccountIcon } from "../AccountIcon.tsx";
import { TransactionDetail } from "../activity/TransactionDetail.tsx";
import { TransactionRow } from "../activity/TransactionRow.tsx";
import { TransactionTable } from "../activity/TransactionTable.tsx";
import { Badge, EmptyState, Modal, Progress } from "../ui.tsx";
import type { AccountCardModel } from "../../domain/accountCards.ts";
import "./account-cards.css";

type StatusFilter = "all" | "pending" | "posted";

/**
 * Account detail dialog in the host Modal. Reuses TransactionRow and
 * TransactionDetail instead of a second transaction modal. Credit
 * utilization uses the shared Progress bar; role badges use Badge.
 */
export function AccountDetailsModal({
	card,
	plan,
	projection,
	onClose,
}: {
	card: AccountCardModel;
	plan: Plan;
	projection: Projection | null;
	onClose: () => void;
}) {
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<StatusFilter>("all");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const transactions = useMemo(
		() =>
			projection
				? accountTransactions({ accountId: card.id, plan, projection })
				: [],
		[card.id, plan, projection],
	);
	const movements = useMemo(
		() => new Map(plan.movements.map((movement) => [movement.id, movement])),
		[plan.movements],
	);
	const shown = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return transactions.filter((transaction) => {
			if (filter === "pending" && !transaction.pending) return false;
			if (
				filter === "posted" &&
				(transaction.pending || transaction.source !== "historical")
			) {
				// Posted in this dialog means recorded facts; projected
				// occurrences stay visible under All.
				if (transaction.source !== "historical") return false;
			}
			if (!needle) return true;
			return `${transaction.name} ${transaction.counterparty} ${transaction.category} ${transaction.date}`
				.toLowerCase()
				.includes(needle);
		});
	}, [transactions, query, filter]);
	const selected = selectedId
		? (transactions.find((transaction) => transaction.id === selectedId) ??
			null)
		: null;
	const selectedMovement = selected
		? (movements.get(selected.movementId) ?? null)
		: null;
	return (
		<Modal
			title={card.name}
			eyebrow={`Account details · ${card.institution}`}
			wide
			onClose={onClose}
		>
			<div className="section-top">
				<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
					<AccountIcon account={card.account} />
					<div>
						<strong style={{ fontSize: 20 }}>{exactMoney(card.balance)}</strong>
						<div className="section-note" style={{ padding: 0 }}>
							{card.balanceLabel} · {card.summary}
						</div>
					</div>
				</div>
				<span className="account-card-badges">
					{card.roles.map((role) => (
						<Badge key={role} tone="neutral">
							{role}
						</Badge>
					))}
				</span>
			</div>
			{card.creditUtilization !== undefined && (
				<div style={{ marginTop: 14 }}>
					<div className="progress-label">
						<span>Credit utilization</span>
						<strong>{card.creditUtilization.toFixed(1)}%</strong>
					</div>
					<Progress
						value={card.creditUtilization}
						label="Credit utilization"
						tone={card.creditUtilization > 80 ? "amber" : "green"}
					/>
					<p className="section-note" style={{ padding: "6px 0" }}>
						Based on posted balance against the limit. Pending charges excluded.
					</p>
				</div>
			)}
			<dl className="detail-list">
				{card.metrics.map((metric) => (
					<div key={metric.label}>
						<dt>{metric.label}</dt>
						<dd>{metric.value}</dd>
					</div>
				))}
			</dl>
			<div className="section-top" style={{ marginTop: 8 }}>
				<h2 style={{ fontSize: 13 }}>Transactions</h2>
				<span className="section-note" style={{ padding: 0 }}>
					{transactions.length} loaded
				</span>
			</div>
			<div className="account-search-row">
				<label className="search-field" style={{ flex: 1 }}>
					<Search size={15} aria-hidden="true" />
					<input
						aria-label="Search account transactions"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search transactions…"
					/>
				</label>
				<div
					className="segmented"
					role="group"
					aria-label="Filter by posting status"
				>
					{(["all", "pending", "posted"] as const).map((key) => (
						<button
							key={key}
							type="button"
							aria-pressed={filter === key}
							onClick={() => setFilter(key)}
							style={{ textTransform: "capitalize" }}
						>
							{key}
						</button>
					))}
				</div>
			</div>
			{shown.length ? (
				<TransactionTable
					caption={`${card.name} transactions filtered by ${filter}.`}
				>
					{shown.slice(0, 60).map((transaction) => (
						<TransactionRow
							key={transaction.id}
							transaction={transaction}
							movement={movements.get(transaction.movementId) ?? null}
							onEdit={() => setSelectedId(transaction.id)}
						/>
					))}
				</TransactionTable>
			) : (
				<EmptyState
					icon={Search}
					title="No matching transactions"
					description="Try a different search or status filter."
				/>
			)}
			{shown.length > 60 && (
				<p className="section-note">Showing 60 of {shown.length} matches.</p>
			)}
			<p className="section-note" style={{ padding: "8px 0" }}>
				{card.transactions.length > 0 && selected == null ? (
					<span>
						<Repeat2
							size={12}
							aria-hidden="true"
							style={{ verticalAlign: -2 }}
						/>{" "}
						Recurring movements show in the plan with their schedule. Dates
						shown {dateLabel(plan.startDate, true)} onward.
					</span>
				) : (
					<span>
						Sample balances are never shown; every figure comes from the plan.
					</span>
				)}
			</p>
			{selected && selectedMovement && (
				<TransactionDetail
					transaction={selected}
					movement={selectedMovement}
					accounts={plan.accounts}
					plan={plan}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</Modal>
	);
}
