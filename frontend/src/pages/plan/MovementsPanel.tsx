import {
	ArrowDownLeft,
	ArrowRight,
	ArrowUpRight,
	Pencil,
	Trash2,
} from "lucide-react";
import { Badge, EmptyState, IconButton } from "../../components/ui.tsx";
import { externalCounterpartyName } from "../../domain/accountActivity.ts";
import { dateLabel, money } from "../../domain/format.ts";
import type { Account, Movement } from "../../domain/model.ts";
import type { ResolvedMovementAmount } from "../../domain/resolvedMovementAmounts.ts";
import "./plan.css";

export function MovementsPanel({
	movements,
	accounts,
	resolvedAmounts,
	onEdit,
	onRemove,
}: {
	movements: Movement[];
	accounts: Account[];
	resolvedAmounts?: Map<string, ResolvedMovementAmount>;
	onEdit: (movement: Movement) => void;
	onRemove: (movement: Movement) => void;
}) {
	if (!movements.length)
		return <EmptyState icon={ArrowRight} title="No matching transactions" />;
	const names = new Map(accounts.map((account) => [account.id, account.name]));
	return (
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
								? names.get(movement.fromId)
								: externalCounterpartyName("in")}
							{movement.toId
								? ` → ${names.get(movement.toId) ?? ""}`
								: movement.fromId
									? ` → ${externalCounterpartyName("out")}`
									: null}
						</span>
					</div>
					<div className="movement-amount">
						<MovementAmount
							movement={movement}
							resolved={resolvedAmounts?.get(movement.id)}
						/>
						{movement.claimRuleId && (
							<Badge tone="neutral">
								Records {movement.claimOccurrenceDate}
							</Badge>
						)}
						{!movement.enabled && <Badge tone="amber">Excluded</Badge>}
					</div>
					<div className="table-actions">
						<IconButton
							icon={Pencil}
							label={`Edit ${movement.name}`}
							disabled={movement.readOnly}
							onClick={() => onEdit(movement)}
						/>
						<IconButton
							icon={Trash2}
							label={`Remove ${movement.name}`}
							disabled={movement.readOnly}
							onClick={() => onRemove(movement)}
						/>
					</div>
				</div>
			))}
		</div>
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
