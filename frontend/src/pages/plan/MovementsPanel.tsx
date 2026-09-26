import {
	ArrowDownLeft,
	ArrowRight,
	ArrowUpRight,
	Check,
	CirclePause,
	Pencil,
	Trash2,
} from "lucide-react";
import { Badge, EmptyState, IconButton } from "../../components/ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import type { Account, Movement } from "../../domain/model.ts";

export function MovementsPanel({
	movements,
	accounts,
	onEdit,
	onRemove,
	onToggle,
}: {
	movements: Movement[];
	accounts: Account[];
	onEdit: (movement: Movement) => void;
	onRemove: (movement: Movement) => void;
	onToggle: (id: string) => void;
}) {
	if (!movements.length)
		return (
			<EmptyState
				icon={ArrowRight}
				title="No matching movements"
				description="Add income, expenses, or transfers to see their effect on your plan."
			/>
		);
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
							{movement.fromId ? names.get(movement.fromId) : "External income"}
							{movement.toId && <> → {names.get(movement.toId)}</>}
						</span>
					</div>
					<div className="movement-amount">
						<strong>
							{movement.amountKnown ? money(movement.amount) : "Unavailable"}
						</strong>
						<Badge
							tone={
								!movement.amountKnown || !movement.enabled ? "amber" : "neutral"
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
							onClick={() => onToggle(movement.id)}
						/>
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
