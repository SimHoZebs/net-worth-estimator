import {
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	ChevronDown,
	ChevronUp,
	GripVertical,
	Repeat,
} from "lucide-react";
import { Reorder } from "motion/react";
import { useMemo, useState } from "react";
import { money } from "../../domain/format.ts";
import type { Account, Movement, Plan } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";
import { useWorkspaceStore } from "../../state/workspaceStore.ts";
import { Badge, EmptyState, IconButton } from "../ui.tsx";
import "./account-activity.css";

type Direction = "in" | "out" | "transfer";

function directionFor(movement: Movement, accountId: string): Direction {
	if (movement.fromId && movement.toId) return "transfer";
	if (movement.fromId === accountId) return "out";
	return "in";
}

function directionLabel(direction: Direction): string {
	switch (direction) {
		case "in":
			return "In";
		case "out":
			return "Out";
		case "transfer":
			return "Transfer";
	}
}

function frequencyLabel(frequency: string): string {
	switch (frequency) {
		case "daily":
			return "Daily";
		case "weekly":
			return "Weekly";
		case "monthly":
			return "Monthly";
		case "quarterly":
			return "Quarterly";
		case "annual":
		case "yearly":
			return "Yearly";
		default:
			return frequency;
	}
}

export function RecurringRules({
	account,
	plan,
	onEdit,
}: {
	account: Account;
	plan: Plan;
	onEdit: (target: EditorTarget) => void;
}) {
	const updatePlan = useWorkspaceStore((state) => state.updatePlan);
	const status = useWorkspaceStore((state) => state.status);
	const serverDocument = useWorkspaceStore((state) => state.serverDocument);
	const draftPresentation = useWorkspaceStore(
		(state) => state.draftPresentation,
	);
	const savedPresentation = useWorkspaceStore(
		(state) => state.savedPresentation,
	);
	const [editing, setEditing] = useState(false);

	const presentation = draftPresentation ?? savedPresentation;
	const serverRules = useMemo(
		() =>
			new Map(
				(serverDocument?.recurrenceRules ?? []).map((rule) => [rule.id, rule]),
			),
		[serverDocument],
	);
	const globalRecurring = useMemo(
		() => plan.movements.filter((movement) => movement.frequency !== "once"),
		[plan.movements],
	);
	const rules = useMemo(
		() =>
			globalRecurring.filter(
				(movement) =>
					movement.fromId === account.id || movement.toId === account.id,
			),
		[globalRecurring, account.id],
	);

	const detailFor = (movement: Movement) => {
		const stored = presentation?.movements[movement.id];
		const server = serverRules.get(movement.id);
		const backendFrequency =
			stored?.frequency ?? server?.frequency ?? movement.frequency;
		const priority =
			stored?.priority ??
			server?.priority ??
			globalRecurring.findIndex((item) => item.id === movement.id) + 1;
		return { backendFrequency, priority };
	};

	const persistOrder = (orderedIds: string[]) => {
		const byId = new Map(plan.movements.map((movement) => [movement.id, movement]));
		const queue = orderedIds
			.map((id) => byId.get(id))
			.filter((item): item is Movement => item !== undefined);
		let cursor = 0;
		const movements = plan.movements.map((movement) => {
			if (movement.frequency === "once") return movement;
			if (movement.fromId !== account.id && movement.toId !== account.id)
				return movement;
			const next = queue[cursor];
			cursor += 1;
			return next ?? movement;
		});
		updatePlan({ ...plan, movements });
	};

	const handleReorder = (orderedIds: string[]) => {
		persistOrder(orderedIds);
	};

	const moveBy = (id: string, delta: -1 | 1) => {
		const ids = rules.map((movement) => movement.id);
		const index = ids.indexOf(id);
		const target = index + delta;
		if (index < 0 || target < 0 || target >= ids.length) return;
		const next = [...ids];
		const [removed] = next.splice(index, 1);
		if (removed === undefined) return;
		next.splice(target, 0, removed);
		persistOrder(next);
	};

	const canEdit = !plan.readOnly && !status?.readOnly;

	if (!rules.length)
		return (
			<EmptyState
				icon={Repeat}
				title="No recurring transactions for this account yet"
				action="Add a planned transaction"
				onAction={() => onEdit({ kind: "movement", item: null })}
			/>
		);
	const ids = rules.map((movement) => movement.id);

	const rowContent = (
		movement: Movement,
		order: number,
		compact: boolean,
	) => {
		const direction = directionFor(movement, account.id);
		const { backendFrequency, priority } = detailFor(movement);
		const DirectionIcon =
			direction === "transfer"
				? ArrowRightLeft
				: direction === "in"
					? ArrowDownLeft
					: ArrowUpRight;
		return (
			<>
				<span className="recurring-order" aria-hidden={compact ? undefined : true}>
					{order}
				</span>
				<span
					className={`movement-icon ${direction === "transfer" ? "transfer" : direction === "in" ? "inflow" : "outflow"}`}
				>
					<DirectionIcon size={16} aria-hidden="true" />
				</span>
				<span className="transaction-name">
					<strong>{movement.name}</strong>
					<span>
						{directionLabel(direction)} · {frequencyLabel(backendFrequency)} ·{" "}
						{movement.amountKnown ? money(movement.amount) : "Varies"} ·
						Priority {priority}
					</span>
					{!movement.enabled && (
						<span className="transaction-badges">
							<Badge tone="amber">Excluded from plan</Badge>
						</span>
					)}
				</span>
			</>
		);
	};

	return (
		<>
			<div className="recurring-toolbar">
				<p className="transaction-context">
					Execution order for this account. Same-day movements apply in this
					order.
				</p>
				{canEdit && (
					<button
						type="button"
						className="button small"
						aria-pressed={editing}
						aria-label={
							editing
								? "Finish reordering recurring transactions"
								: "Reorder recurring transactions"
						}
						onClick={() => setEditing((previous) => !previous)}
					>
						{editing ? "Done" : "Edit"}
					</button>
				)}
			</div>
			{editing ? (
				<Reorder.Group
					axis="y"
					values={ids}
					onReorder={handleReorder}
					className="recurring-list"
					aria-label={`Reorder recurring transactions for ${account.name}`}
				>
					{rules.map((movement, index) => (
						<Reorder.Item
							key={movement.id}
							value={movement.id}
							className="recurring-row"
							aria-label={`${index + 1} of ${rules.length}: ${movement.name}`}
						>
							<span className="recurring-drag" aria-hidden="true">
								<GripVertical size={16} />
							</span>
							{rowContent(movement, index + 1, true)}
							<span className="recurring-edit-controls">
								<IconButton
									icon={ChevronUp}
									label={`Move ${movement.name} up`}
									disabled={index === 0}
									onClick={() => moveBy(movement.id, -1)}
								/>
								<IconButton
									icon={ChevronDown}
									label={`Move ${movement.name} down`}
									disabled={index === rules.length - 1}
									onClick={() => moveBy(movement.id, 1)}
								/>
								<button
									type="button"
									className="text-button"
									aria-label={`Edit ${movement.name}`}
									onClick={() => onEdit({ kind: "movement", item: movement })}
								>
									Edit
								</button>
							</span>
						</Reorder.Item>
					))}
				</Reorder.Group>
			) : (
				<ul
					className="recurring-list"
					aria-label={`Recurring transactions for ${account.name}`}
				>
					{rules.map((movement, index) => (
						<li key={movement.id} className="recurring-row">
							<button
								type="button"
								className="recurring-row-button"
								aria-label={`Edit ${movement.name}, ${directionLabel(directionFor(movement, account.id)).toLowerCase()} ${frequencyLabel(detailFor(movement).backendFrequency).toLowerCase()}, position ${index + 1} of ${rules.length}`}
								onClick={() => onEdit({ kind: "movement", item: movement })}
							>
								{rowContent(movement, index + 1, false)}
							</button>
						</li>
					))}
				</ul>
			)}
		</>
	);
}
