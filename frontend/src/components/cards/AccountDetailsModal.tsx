import { cva } from "class-variance-authority";
import { Repeat2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { accountTransactions } from "../../domain/accountActivity.ts";
import { dateLabel, exactMoney } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import type { Projection } from "../../domain/result.ts";
import { AccountIcon } from "../AccountIcon.tsx";
import { DetailList, DetailRow } from "../DetailRow.tsx";
import { SearchField } from "../Field.tsx";
import { TransactionDetail } from "../activity/TransactionDetail.tsx";
import { TransactionRow } from "../activity/TransactionRow.tsx";
import { TransactionTable } from "../activity/TransactionTable.tsx";
import { Badge } from "../Badge.tsx";
import { EmptyState } from "../EmptyState.tsx";
import { Modal } from "../Modal.tsx";
import { Progress } from "../Progress.tsx";
import type { AccountCardModel } from "../../domain/accountCards.ts";
import { useSelectedId } from "../entrySelection.ts";

type StatusFilter = "all" | "pending" | "posted";

const postingFilter = cva(
	"rounded-control border-0 px-2 py-1 text-xs whitespace-nowrap capitalize",
	{
		variants: {
			selected: {
				true: "bg-surface font-bold text-ink shadow-xs",
				false: "bg-transparent text-muted",
			},
		},
		defaultVariants: { selected: false },
	},
);

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
	const [selectedId, setSelectedId] = useSelectedId(plan);
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
			<div className="flex items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<AccountIcon account={card.account} />
					<div>
						<strong className="type-value text-xl">
							{exactMoney(card.balance)}
						</strong>
						<div className="text-sm leading-relaxed text-muted">
							{card.balanceLabel} · {card.summary}
						</div>
					</div>
				</div>
				<span className="flex flex-wrap gap-2">
					{card.roles.map((role) => (
						<Badge key={role} tone="neutral">
							{role}
						</Badge>
					))}
				</span>
			</div>
			{card.creditUtilization !== undefined && (
				<div className="mt-4">
					<div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted">
						<span>Credit utilization</span>
						<strong>{card.creditUtilization.toFixed(1)}%</strong>
					</div>
					<Progress
						value={card.creditUtilization}
						label="Credit utilization"
						tone={card.creditUtilization > 80 ? "warning" : "success"}
					/>
					<p className="py-2 text-sm leading-relaxed text-muted">
						Based on posted balance against the limit. Pending charges excluded.
					</p>
				</div>
			)}
			<DetailList>
				{card.metrics.map((metric) => (
					<DetailRow key={metric.label} label={metric.label}>
						{metric.value}
					</DetailRow>
				))}
			</DetailList>
			<div className="mt-2 flex items-center justify-between gap-4">
				<h2 className="text-sm">Transactions</h2>
				<span className="text-sm leading-relaxed text-muted">
					{transactions.length} loaded
				</span>
			</div>
			<div className="mb-3 flex flex-wrap items-center gap-3">
				<SearchField
					label="Search account transactions"
					containerClassName="flex-1"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search transactions…"
				/>
				<div
					className="inline-flex gap-0.5 rounded-control border border-line bg-surface-2 p-1"
					role="group"
					aria-label="Filter by posting status"
				>
					{(["all", "pending", "posted"] as const).map((key) => (
						<button
							key={key}
							type="button"
							className={postingFilter({ selected: filter === key })}
							aria-pressed={filter === key}
							onClick={() => setFilter(key)}
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
				<p className="py-2 text-sm leading-relaxed text-muted">
					Showing 60 of {shown.length} matches.
				</p>
			)}
			<p className="py-2 text-sm leading-relaxed text-muted">
				{card.transactions.length > 0 && selected == null ? (
					<span>
						<Repeat2 size={12} aria-hidden="true" className="align-middle" />{" "}
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
