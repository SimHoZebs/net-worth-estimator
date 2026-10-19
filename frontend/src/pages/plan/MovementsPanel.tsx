import { ArrowDownLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { Badge, EmptyState } from "../../components/ui.tsx";
import { TransactionTable } from "../../components/activity/TransactionTable.tsx";
import "../../components/activity/account-activity.css";
import { dateLabel, money } from "../../domain/format.ts";
import {
	isPendingMovement,
	type Account,
	type Movement,
} from "../../domain/model.ts";
import type { ResolvedMovementAmount } from "../../domain/resolvedMovementAmounts.ts";
import "./plan.css";

export function MovementsPanel({
	movements,
	accounts,
	resolvedAmounts,
	showHeaders = false,
	onEdit,
}: {
	movements: Movement[];
	accounts: Account[];
	resolvedAmounts?: Map<string, ResolvedMovementAmount>;
	showHeaders?: boolean;
	onEdit: (movement: Movement) => void;
}) {
	if (!movements.length)
		return <EmptyState icon={ArrowRight} title="No matching transactions" />;
	const names = new Map(accounts.map((account) => [account.id, account.name]));
	return (
		<TransactionTable
			caption="Planned transactions with dates and amounts."
			showHeaders={showHeaders}
		>
			{movements.map((movement) => {
				const pending = isPendingMovement(movement);
				// External endpoints only restate the direction, so the route
				// names real accounts only. The date lives in its own column.
				const route = [movement.fromId, movement.toId]
					.map((id) => (id ? names.get(id) : null))
					.filter((name): name is string => Boolean(name))
					.join(" → ");
				return (
					<tr
						key={movement.id}
						className={`transaction-row ${movement.enabled || pending ? "" : "is-excluded"}`}
					>
						<td className="transaction-date-column">
							{movement.frequency === "once" ? (
								<time dateTime={movement.startDate}>
									{dateLabel(movement.startDate, true)}
								</time>
							) : movement.frequency === "monthly" ? (
								"Monthly"
							) : (
								"Yearly"
							)}
						</td>
						<th scope="row">
							<button
								type="button"
								className="transaction-row-button"
								aria-label={`${movement.name} on ${movement.frequency === "once" ? dateLabel(movement.startDate, true) : movement.frequency}`}
								onClick={() => onEdit(movement)}
							>
								<span
									className={`movement-icon ${movement.fromId ? (movement.toId ? "transfer" : "outflow") : "inflow"}`}
								>
									{movement.fromId ? (
										movement.toId ? (
											<ArrowRight size={16} aria-hidden="true" />
										) : (
											<ArrowUpRight size={16} aria-hidden="true" />
										)
									) : (
										<ArrowDownLeft size={16} aria-hidden="true" />
									)}
								</span>
								<span className="transaction-name">
									<strong>{movement.name}</strong>
									{route && <span>{route}</span>}
									<span className="transaction-mobile-date">
										{movement.frequency === "once"
											? dateLabel(movement.startDate, true)
											: movement.frequency === "monthly"
												? "Monthly"
												: "Yearly"}
									</span>
									{(pending || !movement.enabled) && (
										<span className="transaction-badges">
											{pending ? (
												<Badge tone="neutral">Pending</Badge>
											) : (
												!movement.enabled && (
													<Badge tone="amber">Excluded</Badge>
												)
											)}
										</span>
									)}
								</span>
							</button>
						</th>
						<td className="transaction-amount-column">
							<span className="transaction-amount">
								<MovementAmount
									movement={movement}
									resolved={resolvedAmounts?.get(movement.id)}
								/>
								{movement.claimRuleId && (
									<Badge tone="neutral">
										Records {movement.claimOccurrenceDate}
									</Badge>
								)}
							</span>
						</td>
					</tr>
				);
			})}
		</TransactionTable>
	);
}

function MovementAmount({
	movement,
	resolved,
}: {
	movement: Movement;
	resolved: ResolvedMovementAmount | undefined;
}) {
	if (movement.amountKnown) return <strong>{money(movement.amount)}</strong>;
	if (resolved) {
		const label =
			movement.frequency === "once"
				? `Calculated for ${dateLabel(resolved.date, true)}`
				: `Next calculated amount ${dateLabel(resolved.date, true)} · varies each occurrence`;
		return (
			<>
				<strong title={label}>{money(resolved.amount)}</strong>
				<Badge tone="neutral">Varies</Badge>
			</>
		);
	}
	return (
		<strong title="Calculated during projection · varies each occurrence">
			Varies
		</strong>
	);
}
