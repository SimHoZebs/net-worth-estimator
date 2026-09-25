import {
	ArrowDownLeft,
	ArrowRight,
	ArrowUpRight,
	Check,
	CirclePause,
	FileCheck2,
	LockKeyhole,
	Pencil,
	Plus,
	Search,
	SlidersHorizontal,
	Trash2,
	Wallet,
} from "lucide-react";
import { useState } from "react";
import { AccountIcon } from "../components/AccountList.tsx";
import type { EditorTarget } from "../components/PlanEditor.tsx";
import {
	Badge,
	EmptyState,
	ErrorNotice,
	IconButton,
	Modal,
} from "../components/ui.tsx";
import { dateLabel, money } from "../domain/format.ts";
import type { Plan } from "../domain/model.ts";

export function PlanPage({
	plan,
	onEdit,
	onUpdate,
	onAccount,
}: {
	plan: Plan;
	onEdit: (target: EditorTarget) => void;
	onUpdate: (plan: Plan) => boolean;
	onAccount: (id: string) => void;
}) {
	const [tab, setTab] = useState("accounts");
	const [query, setQuery] = useState("");
	const [remove, setRemove] = useState<{
		kind: "accounts" | "movements";
		id: string;
		name: string;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const tabs = [
		{ id: "accounts", label: "Accounts", count: plan.accounts.length },
		{ id: "movements", label: "Movements", count: plan.movements.length },
		{
			id: "checks",
			label: "Balance checks",
			count: plan.accounts.filter((a) => a.provenance === "recorded").length,
		},
		{ id: "assumptions", label: "Assumptions", count: null },
	];
	const accounts = plan.accounts.filter((a) =>
		a.name.toLowerCase().includes(query.toLowerCase()),
	);
	const movements = plan.movements.filter((m) =>
		m.name.toLowerCase().includes(query.toLowerCase()),
	);
	const deleteItem = () => {
		if (!remove) return;
		if (remove.kind === "accounts" && plan.accounts.length === 1) {
			setError(
				"Keep at least one account in the plan. Add a replacement before removing this one.",
			);
			return;
		}
		if (
			remove.kind === "accounts" &&
			(plan.movements.some(
				(m) => m.fromId === remove.id || m.toId === remove.id,
			) ||
				plan.goals.some((g) => g.accountId === remove.id))
		) {
			setError(
				"This account is used by a movement or goal. Update those references before removing it.",
			);
			return;
		}
		const next = {
			...plan,
			[remove.kind]: plan[remove.kind].filter((item) => item.id !== remove.id),
		};
		if (onUpdate(next)) {
			setRemove(null);
			setError(null);
		}
	};
	return (
		<>
			<div className="page-tabs" role="tablist" aria-label="Plan sections">
				{tabs.map((item, index) => (
					<button
						type="button"
						id={`tab-${item.id}`}
						role="tab"
						aria-selected={tab === item.id}
						aria-controls="plan-panel"
						key={item.id}
						onClick={() => {
							setTab(item.id);
							setQuery("");
						}}
						tabIndex={tab === item.id ? 0 : -1}
						onKeyDown={(event) => {
							const target =
								event.key === "ArrowRight"
									? (index + 1) % tabs.length
									: event.key === "ArrowLeft"
										? (index + tabs.length - 1) % tabs.length
										: event.key === "Home"
											? 0
											: event.key === "End"
												? tabs.length - 1
												: null;
							if (target === null) return;
							event.preventDefault();
							const next = tabs[target];
							if (!next) return;
							setTab(next.id);
							setQuery("");
							document.getElementById(`tab-${next.id}`)?.focus();
						}}
					>
						{item.label}
						{item.count !== null && <span>{item.count}</span>}
					</button>
				))}
			</div>
			<section
				className="panel plan-panel"
				id="plan-panel"
				role="tabpanel"
				aria-labelledby={`tab-${tab}`}
			>
				{tab !== "assumptions" && (
					<div className="plan-toolbar">
						<label className="search-field">
							<Search size={17} />
							<input
								aria-label="Search plan"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder={`Find ${tab === "movements" ? "a movement" : "an account"}…`}
							/>
						</label>
						<button
							type="button"
							className="button primary small"
							onClick={() =>
								onEdit({
									kind: tab === "movements" ? "movement" : "account",
									item: null,
								})
							}
						>
							<Plus size={16} />
							Add {tab === "movements" ? "movement" : "account"}
						</button>
					</div>
				)}
				{tab === "accounts" &&
					(accounts.length ? (
						<div className="table-scroll">
							<table className="plan-table">
								<thead>
									<tr>
										<th scope="col">Account</th>
										<th scope="col">Balance</th>
										<th scope="col">Annual rate</th>
										<th scope="col">Protected balance</th>
										<th scope="col">
											<span className="sr-only">Actions</span>
										</th>
									</tr>
								</thead>
								<tbody>
									{accounts.map((account) => (
										<tr key={account.id}>
											<th scope="row">
												<button
													type="button"
													className="table-name account-name-button"
													aria-label={`Open ${account.name} transactions`}
													onClick={() => onAccount(account.id)}
												>
													<AccountIcon account={account} />
													<span>
														<strong>{account.name}</strong>
														<small>
															{account.kind} · {account.provenance}
															{!account.enabled && " · excluded"}
														</small>
													</span>
													{account.readOnly && (
														<LockKeyhole
															size={14}
															aria-label="Read-only record"
														/>
													)}
												</button>
											</th>
											<td className="numeric">{money(account.balance)}</td>
											<td>{account.annualReturn}%</td>
											<td>{money(account.floor)}</td>
											<td>
												<div className="table-actions">
													<IconButton
														icon={Pencil}
														label={`Edit ${account.name}`}
														onClick={() =>
															onEdit({ kind: "account", item: account })
														}
													/>
													<IconButton
														icon={Trash2}
														label={`Remove ${account.name}`}
														disabled={account.readOnly}
														onClick={() => {
															setRemove({
																kind: "accounts",
																id: account.id,
																name: account.name,
															});
															setError(null);
														}}
													/>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<EmptyState
							icon={Wallet}
							title="No matching accounts"
							description="Try another name or add an account to the plan."
						/>
					))}
				{tab === "movements" &&
					(movements.length ? (
						<div className="movement-list">
							{movements.map((movement) => (
								<div
									className={`movement-row ${movement.enabled ? "" : "is-excluded"}`}
									key={movement.id}
								>
									<span
										className={`movement-icon ${movement.fromId ? (movement.toId ? "transfer" : "outflow") : "inflow"}`}
									>
										{movement.fromId ? (
											movement.toId ? (
												<ArrowRight size={19} />
											) : (
												<ArrowUpRight size={19} />
											)
										) : (
											<ArrowDownLeft size={19} />
										)}
									</span>
									<div className="movement-name">
										<strong>{movement.name}</strong>
										<span>
											{movement.frequency === "once"
												? dateLabel(movement.startDate, true)
												: movement.frequency === "monthly"
													? "Monthly"
													: "Yearly"}{" "}
											·{" "}
											{movement.fromId
												? plan.accounts.find((a) => a.id === movement.fromId)
														?.name
												: "External income"}
											{movement.toId && (
												<>
													{" "}
													→{" "}
													{
														plan.accounts.find((a) => a.id === movement.toId)
															?.name
													}
												</>
											)}
										</span>
									</div>
									<div className="movement-amount">
										<strong>
											{movement.amountKnown
												? money(movement.amount)
												: "Unavailable"}
										</strong>
										<Badge
											tone={
												!movement.amountKnown
													? "amber"
													: movement.enabled
														? "neutral"
														: "amber"
											}
										>
											{!movement.amountKnown
												? "Provisional amount"
												: movement.enabled
													? movement.provenance
													: "Excluded"}
										</Badge>
									</div>
									<div className="table-actions">
										<IconButton
											icon={movement.enabled ? CirclePause : Check}
											label={`${movement.enabled ? "Exclude" : "Include"} ${movement.name}`}
											disabled={movement.readOnly}
											onClick={() =>
												onUpdate({
													...plan,
													movements: plan.movements.map((m) =>
														m.id === movement.id
															? { ...m, enabled: !m.enabled }
															: m,
													),
												})
											}
										/>
										<IconButton
											icon={Pencil}
											label={`Edit ${movement.name}`}
											disabled={movement.readOnly}
											onClick={() =>
												onEdit({ kind: "movement", item: movement })
											}
										/>
										<IconButton
											icon={Trash2}
											label={`Remove ${movement.name}`}
											disabled={movement.readOnly}
											onClick={() => {
												setRemove({
													kind: "movements",
													id: movement.id,
													name: movement.name,
												});
												setError(null);
											}}
										/>
									</div>
								</div>
							))}
						</div>
					) : (
						<EmptyState
							icon={ArrowRight}
							title="No matching movements"
							description="Add income, expenses, or transfers to see their effect on your plan."
						/>
					))}
				{tab === "checks" && (
					<>
						<p className="section-note">
							Recorded end-of-day balances establish the starting position.
							Older balances are carried forward unchanged and remain visibly
							dated.
						</p>
						<div className="movement-list">
							{accounts
								.filter((a) => a.provenance === "recorded")
								.map((account) => (
									<div className="movement-row" key={account.id}>
										<span className="movement-icon inflow">
											<FileCheck2 size={19} />
										</span>
										<div className="movement-name">
											<strong>{account.name}</strong>
											<span>
												{dateLabel(account.observedOn, true)} · {account.source}
											</span>
										</div>
										<strong>{money(account.balance)}</strong>
										<IconButton
											icon={Pencil}
											label={`Edit balance check for ${account.name}`}
											onClick={() => onEdit({ kind: "account", item: account })}
										/>
									</div>
								))}
						</div>
					</>
				)}
				{tab === "assumptions" && (
					<div className="assumptions-page">
						<div className="section-top">
							<div>
								<h2>The inputs behind the outlook</h2>
								<p>Visible assumptions. Deliberate changes.</p>
							</div>
							<button
								type="button"
								className="button secondary"
								onClick={() => onEdit({ kind: "assumptions" })}
							>
								<SlidersHorizontal size={16} />
								Edit assumptions
							</button>
						</div>
						<div className="assumption-metrics">
							<div>
								<span>Annual inflation</span>
								<strong>{plan.assumptions.inflation}%</strong>
								<p>For the “today’s dollars” view.</p>
							</div>
							<div>
								<span>Investment variability</span>
								<strong>{plan.assumptions.volatility}%</strong>
								<p>Yearly standard deviation in percentage points.</p>
							</div>
							<div>
								<span>Modeled scenarios</span>
								<strong>400</strong>
								<p>A repeatable set of possible return paths.</p>
							</div>
						</div>
						<div className="method-note">
							<h3>How the projection works</h3>
							<p>
								Balances accrue growth between dated movements. Recurring
								movements run on their scheduled day, clamped to month end when
								necessary. Source accounts retain their protected balance;
								incoming movements respect account ceilings. Debt payments stop
								when the debt reaches zero.
							</p>
							<p>
								Rates and movement increases are nominal. Taxes, investment
								fees, withdrawal eligibility and lending rules need explicit
								movements or constraints. Historical records are evidence; they
								are already reflected in starting balances.
							</p>
							<p>
								The range varies investment returns only. It does not model job
								loss, unplanned spending, or every source of financial risk.
							</p>
						</div>
					</div>
				)}
			</section>
			{remove && (
				<Modal
					title={`Remove ${remove.name}?`}
					eyebrow="Temporary version"
					onClose={() => setRemove(null)}
				>
					<p>
						The item will be marked as removed in your changes. Your saved plan
						stays intact until you explicitly save.
					</p>
					{error && <ErrorNotice message={error} />}
					<div className="modal-actions">
						<button
							type="button"
							className="button secondary"
							onClick={() => setRemove(null)}
						>
							Keep item
						</button>
						<button
							type="button"
							className="button danger"
							onClick={deleteItem}
						>
							Remove from temporary version
						</button>
					</div>
				</Modal>
			)}
		</>
	);
}
