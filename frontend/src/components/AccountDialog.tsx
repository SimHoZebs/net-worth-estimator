import {
	ArrowDownLeft,
	ArrowDownUp,
	ArrowRightLeft,
	ArrowUpRight,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Info,
	ListFilter,
	Pencil,
	Search,
	TriangleAlert,
} from "lucide-react";
import { Fragment, type KeyboardEvent, useId, useMemo, useState } from "react";
import {
	type AccountTransaction,
	type ActivityFilters,
	accountTransactions,
	defaultActivityFilters,
	filterTransactions,
} from "../domain/accountActivity.ts";
import { dateLabel, exactMoney, money } from "../domain/format.ts";
import type { Account, Plan } from "../domain/model.ts";
import type { Projection } from "../domain/projection.ts";
import { AccountIcon } from "./AccountList.tsx";
import type { EditorTarget } from "./PlanEditor.tsx";
import { Badge, EmptyState, IconButton, Modal } from "./ui.tsx";

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
	const id = useId();
	const transactions = useMemo(
		() => accountTransactions({ accountId: account.id, plan, projection }),
		[account.id, plan, projection],
	);
	const starting =
		projection.points.find((point) => point.date === plan.startDate) ??
		projection.points[0];
	const last = projection.points.at(-1);
	const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const next =
			event.key === "Home"
				? "transactions"
				: event.key === "End"
					? "details"
					: view === "transactions"
						? "details"
						: "transactions";
		setView(next);
		document.getElementById(`${id}-${next}`)?.focus();
	};

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
			<div
				className="page-tabs account-view-tabs"
				role="tablist"
				aria-label="Account view"
			>
				{(["transactions", "details"] as const).map((tab) => (
					<button
						type="button"
						key={tab}
						id={`${id}-${tab}`}
						role="tab"
						aria-selected={view === tab}
						aria-controls={`${id}-panel`}
						tabIndex={view === tab ? 0 : -1}
						onClick={() => setView(tab)}
						onKeyDown={onTabKey}
					>
						{tab === "transactions" ? "Transactions" : "Account details"}
						{tab === "transactions" && <span>{transactions.length}</span>}
					</button>
				))}
			</div>
			<div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${view}`}>
				{view === "transactions" ? (
					<Transactions
						transactions={transactions}
						plan={plan}
						horizon={last?.date ?? plan.startDate}
						onEdit={onEdit}
					/>
				) : (
					<>
						<dl className="detail-list">
							<div>
								<dt>Source</dt>
								<dd>{account.source}</dd>
							</div>
							<div>
								<dt>Balance date</dt>
								<dd>{dateLabel(account.observedOn, true)}</dd>
							</div>
							<div>
								<dt>Annual rate assumption</dt>
								<dd>{account.annualReturn}%</dd>
							</div>
							<div>
								<dt>Protected from spending</dt>
								<dd>{money(account.floor)}</dd>
							</div>
							<div>
								<dt>Incoming balance ceiling</dt>
								<dd>
									{account.ceiling === null
										? "No ceiling"
										: money(account.ceiling)}
								</dd>
							</div>
							<div>
								<dt>Base case at horizon</dt>
								<dd>{money(last?.balances[account.id] ?? 0)}</dd>
							</div>
							<div>
								<dt>Record access</dt>
								<dd>
									{!account.enabled
										? "Excluded from net worth and projections"
										: account.readOnly
											? "Read-only source record"
											: "Editable in a temporary version"}
								</dd>
							</div>
						</dl>
						<div className="modal-actions">
							<button
								type="button"
								className="button primary"
								onClick={() => onEdit({ kind: "account", item: account })}
							>
								<Pencil size={16} />
								{account.readOnly ? "Inspect source record" : "Edit account"}
							</button>
						</div>
					</>
				)}
			</div>
		</Modal>
	);
}

const PAGE_SIZE = 10;

function Transactions({
	transactions,
	plan,
	horizon,
	onEdit,
}: {
	transactions: AccountTransaction[];
	plan: Plan;
	horizon: string;
	onEdit: (target: EditorTarget) => void;
}) {
	const [filters, setFilters] = useState<ActivityFilters>(
		defaultActivityFilters,
	);
	const [page, setPage] = useState(0);
	const [expanded, setExpanded] = useState<string | null>(null);
	const id = useId();
	const filtered = useMemo(
		() =>
			filterTransactions({ transactions, filters, startDate: plan.startDate }),
		[transactions, filters, plan.startDate],
	);
	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount - 1);
	const rows = filtered.slice(
		currentPage * PAGE_SIZE,
		(currentPage + 1) * PAGE_SIZE,
	);
	const recordedCount = transactions.filter(
		(transaction) => transaction.source === "recorded",
	).length;
	const update = <K extends keyof ActivityFilters>(
		key: K,
		value: ActivityFilters[K],
	) => {
		setFilters((previous) => ({ ...previous, [key]: value }));
		setPage(0);
		setExpanded(null);
	};
	const clear = () => {
		setFilters(defaultActivityFilters);
		setPage(0);
		setExpanded(null);
	};
	const turnPage = (next: number) => {
		setPage(next);
		setExpanded(null);
		document
			.getElementById(`${id}-table`)
			?.scrollIntoView({ block: "nearest" });
	};

	if (!transactions.length)
		return (
			<EmptyState
				icon={ArrowRightLeft}
				title="No transactions for this account yet"
				description="Recorded movements and scheduled transactions will appear here. Growth and interest are reflected in the balance projection separately."
				action="Add a planned movement"
				onAction={() => onEdit({ kind: "movement", item: null })}
			/>
		);

	return (
		<>
			<div className="account-activity-toolbar">
				<label className="search-field account-activity-search">
					<Search size={17} aria-hidden="true" />
					<input
						type="search"
						aria-label="Search account transactions"
						placeholder="Search transactions or accounts…"
						value={filters.query}
						onChange={(event) => update("query", event.target.value)}
					/>
				</label>
				<button
					type="button"
					className="text-button transaction-order"
					onClick={() =>
						update("order", filters.order === "oldest" ? "newest" : "oldest")
					}
				>
					<ArrowDownUp size={14} />
					{filters.order === "oldest" ? "Oldest first" : "Newest first"}
				</button>
			</div>
			<div className="account-activity-filters">
				<label>
					<span>Activity</span>
					<select
						aria-label="Transaction source"
						value={filters.source}
						onChange={(event) =>
							update("source", event.target.value as ActivityFilters["source"])
						}
					>
						<option value="all">All transactions</option>
						<option value="recorded">Recorded ({recordedCount})</option>
						<option value="projected">
							Projected ({transactions.length - recordedCount})
						</option>
					</select>
				</label>
				<label>
					<span>Direction</span>
					<select
						aria-label="Transaction direction"
						value={filters.direction}
						onChange={(event) =>
							update(
								"direction",
								event.target.value as ActivityFilters["direction"],
							)
						}
					>
						<option value="all">All types</option>
						<option value="in">Money in</option>
						<option value="out">Money out</option>
						<option value="transfer">Transfers</option>
					</select>
				</label>
				<label>
					<span>Dates</span>
					<select
						aria-label="Transaction dates"
						value={filters.period}
						onChange={(event) =>
							update("period", event.target.value as ActivityFilters["period"])
						}
					>
						<option value="all">All dates</option>
						<option value="30-days">Next 30 days</option>
						<option value="12-months">Next 12 months</option>
					</select>
				</label>
			</div>
			<p className="transaction-context">
				Recorded history + the current base case through {dateLabel(horizon)}.
				Upcoming dates are relative to {dateLabel(plan.startDate, true)}.
			</p>
			{filtered.length ? (
				<>
					<div className="table-scroll" id={`${id}-table`}>
						<table className="account-activity-table">
							<caption className="sr-only">
								Transactions involving this account, separated into recorded
								facts and projected movements.
							</caption>
							<thead>
								<tr>
									<th scope="col" className="transaction-date-column">
										Date
									</th>
									<th scope="col">Transaction</th>
									<th scope="col" className="transaction-amount-column">
										Amount
									</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((transaction, index) => {
									const open = expanded === transaction.id;
									const detailId = `${id}-row-${index}`;
									const DirectionIcon =
										transaction.category === "transfer"
											? ArrowRightLeft
											: transaction.direction === "in"
												? ArrowDownLeft
												: ArrowUpRight;
									return (
										<Fragment key={transaction.id}>
											<tr
												className={
													open
														? "transaction-row transaction-row-open"
														: "transaction-row"
												}
											>
												<td className="transaction-date-column">
													<time dateTime={transaction.date}>
														{dateLabel(transaction.date, true)}
													</time>
												</td>
												<th scope="row">
													<button
														type="button"
														className="transaction-row-button"
														aria-label={`Inspect ${transaction.name} on ${dateLabel(transaction.date, true)}; ${transaction.source}; ${transaction.direction === "in" ? "money in from" : "money out to"} ${transaction.counterparty}${transaction.shortfall > 0.01 ? "; shortfall" : ""}${transaction.excluded ? "; excluded from plan" : ""}`}
														aria-expanded={open}
														aria-controls={open ? detailId : undefined}
														onClick={() =>
															setExpanded(open ? null : transaction.id)
														}
													>
														<span
															className={`movement-icon ${transaction.category === "transfer" ? "transfer" : transaction.direction === "in" ? "inflow" : "outflow"}`}
														>
															<DirectionIcon size={16} aria-hidden="true" />
														</span>
														<span className="transaction-name">
															<strong>{transaction.name}</strong>
															<span>
																{transaction.direction === "in" ? "From" : "To"}{" "}
																{transaction.counterparty}
															</span>
															<time
																className="transaction-mobile-date"
																dateTime={transaction.date}
															>
																{dateLabel(transaction.date, true)}
															</time>
															<span className="transaction-badges">
																<Badge
																	tone={
																		transaction.source === "recorded"
																			? "green"
																			: "outline"
																	}
																>
																	{transaction.source === "recorded"
																		? "Recorded"
																		: "Projected"}
																</Badge>
																{transaction.excluded && (
																	<Badge tone="amber">Excluded from plan</Badge>
																)}
																{transaction.shortfall > 0.01 && (
																	<Badge tone="amber">
																		<TriangleAlert size={10} />
																		Shortfall
																	</Badge>
																)}
															</span>
														</span>
														<ChevronDown
															size={14}
															className="transaction-chevron"
															aria-hidden="true"
														/>
													</button>
												</th>
												<td className="transaction-amount-column">
													<strong
														className={
															transaction.direction === "in" ? "positive" : ""
														}
													>
														{transaction.amount === 0
															? exactMoney(0)
															: `${transaction.direction === "in" ? "+" : "−"}${exactMoney(transaction.amount)}`}
													</strong>
													{transaction.shortfall > 0.01 && (
														<small>
															{exactMoney(transaction.requested)} planned
														</small>
													)}
												</td>
											</tr>
											{open && (
												<tr className="transaction-detail-row">
													<td colSpan={3}>
														<div id={detailId}>
															<TransactionDetails
																transaction={transaction}
																plan={plan}
																onEdit={onEdit}
															/>
														</div>
													</td>
												</tr>
											)}
										</Fragment>
									);
								})}
							</tbody>
						</table>
					</div>
					<div className="transaction-pagination">
						<span role="status">
							Showing {currentPage * PAGE_SIZE + 1}–
							{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of{" "}
							{filtered.length} transactions
						</span>
						<div>
							<IconButton
								icon={ChevronLeft}
								label="Previous transaction page"
								disabled={currentPage === 0}
								onClick={() => turnPage(currentPage - 1)}
							/>
							<span>
								{currentPage + 1} / {pageCount}
							</span>
							<IconButton
								icon={ChevronRight}
								label="Next transaction page"
								disabled={currentPage === pageCount - 1}
								onClick={() => turnPage(currentPage + 1)}
							/>
						</div>
					</div>
				</>
			) : (
				<EmptyState
					icon={ListFilter}
					title="No matching transactions"
					description="Try another name, date window, or activity type. Your account data is unchanged."
					action="Clear transaction filters"
					onAction={clear}
				/>
			)}
			<div className="transaction-note">
				<Info size={14} aria-hidden="true" />
				<p>
					Recorded history may be incomplete and is already included in the
					starting balance. Projected amounts show the funded portion; growth
					and interest are included in the balance projection separately.
				</p>
			</div>
		</>
	);
}

function TransactionDetails({
	transaction,
	plan,
	onEdit,
}: {
	transaction: AccountTransaction;
	plan: Plan;
	onEdit: (target: EditorTarget) => void;
}) {
	const movement = plan.movements.find(
		(item) => item.id === transaction.movementId,
	);
	return (
		<div className="transaction-details">
			<dl>
				<div>
					<dt>From</dt>
					<dd>{transaction.from}</dd>
				</div>
				<div>
					<dt>To</dt>
					<dd>{transaction.to}</dd>
				</div>
				<div>
					<dt>
						{transaction.source === "recorded"
							? "Recorded amount"
							: "Requested"}
					</dt>
					<dd>{exactMoney(transaction.requested)}</dd>
				</div>
				{transaction.source === "projected" && (
					<div>
						<dt>Funded in the base case</dt>
						<dd>{exactMoney(transaction.amount)}</dd>
					</div>
				)}
				{transaction.shortfall > 0.01 && (
					<>
						<div>
							<dt>Unfunded amount</dt>
							<dd>{exactMoney(transaction.shortfall)}</dd>
						</div>
						<div>
							<dt>Limiting constraint</dt>
							<dd>{transaction.constraint}</dd>
						</div>
					</>
				)}
			</dl>
			{transaction.excluded && (
				<p>
					This recorded movement is excluded from plan evidence. It remains
					visible as a source record.
				</p>
			)}
			{transaction.source === "projected" && (
				<p>
					{transaction.shortfall > 0.01
						? "The unfunded amount is not automatically borrowed or rescheduled. "
						: ""}
					This is a dated occurrence of a planned movement, not a bank-confirmed
					transaction.
					{movement && movement.frequency !== "once"
						? " Editing this movement changes every occurrence in its schedule."
						: ""}
				</p>
			)}
			{movement && (
				<button
					type="button"
					className="text-button"
					onClick={() => onEdit({ kind: "movement", item: movement })}
				>
					<Pencil size={14} />
					{movement.readOnly
						? "Inspect source record"
						: transaction.source === "recorded"
							? "Edit recorded movement"
							: "Edit planned movement"}
				</button>
			)}
		</div>
	);
}
