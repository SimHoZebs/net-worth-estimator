import {
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	ChevronDown,
	ChevronUp,
	GripVertical,
	Repeat,
} from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { money } from "../../domain/format.ts";
import type { Account, Movement, Plan } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";
import { useWorkspaceStore } from "../../state/workspaceStore.ts";
import { Badge, EmptyState, IconButton } from "../ui.tsx";
import "./account-activity.css";
import { MovementDetail } from "./TransactionDetail.tsx";

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

// One draggable row. The drag starts only from the grip handle
// (dragListener={false} + drag controls) so the up/down buttons and the
// Edit button inside the row keep working, and touch drags get
// touch-action: none on the handle instead of scrolling the list.
function SortableRow({
	id,
	label,
	onDragStart,
	onDrop,
	controls,
	children,
}: {
	id: string;
	label: string;
	onDragStart: () => void;
	onDrop: () => void;
	controls: ReactNode;
	children: ReactNode;
}) {
	const dragControls = useDragControls();
	return (
		<Reorder.Item
			value={id}
			dragListener={false}
			dragControls={dragControls}
			onDragStart={onDragStart}
			onDragEnd={onDrop}
			className="recurring-row"
			aria-label={label}
		>
			<span
				className="recurring-drag"
				aria-hidden="true"
				onPointerDown={(event) => dragControls.start(event)}
			>
				<GripVertical size={16} />
			</span>
			{children}
			{controls}
		</Reorder.Item>
	);
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
	const [selectedId, setSelectedId] = useState<string | null>(null);

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
		return { backendFrequency };
	};

	const persistOrder = (orderedIds: string[]) => {
		const byId = new Map(
			plan.movements.map((movement) => [movement.id, movement]),
		);
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

	// Local drag order. Reorder fires onReorder continuously mid-drag, so
	// writing straight to the store re-renders and resets motion's internal
	// order before siblings can displace. Instead the drag plays out in
	// local state (siblings push/pull freely) and persists once on drop.
	const [localIds, setLocalIds] = useState<string[]>([]);
	const localIdsRef = useRef<string[]>([]);
	const draggingRef = useRef(false);
	const ids = rules.map((movement) => movement.id);
	useEffect(() => {
		if (!draggingRef.current) {
			setLocalIds(ids);
			localIdsRef.current = ids;
		}
		// oxlint-disable-next-line react/exhaustive-deps
	}, [rules, editing]);
	const handleReorder = (orderedIds: string[]) => {
		localIdsRef.current = orderedIds;
		setLocalIds(orderedIds);
	};
	const orderedRules = useMemo(() => {
		const byId = new Map(rules.map((movement) => [movement.id, movement]));
		const ordered = localIds
			.map((id) => byId.get(id))
			.filter((item): item is Movement => item !== undefined);
		for (const movement of rules) {
			if (!ordered.includes(movement)) ordered.push(movement);
		}
		return ordered;
	}, [rules, localIds]);

	const handleDrop = () => {
		draggingRef.current = false;
		const current = rules.map((movement) => movement.id);
		const next = localIdsRef.current;
		if (
			current.length !== next.length ||
			current.some((id, index) => id !== next[index])
		) {
			persistOrder(next);
		}
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

	const rowContent = (movement: Movement, order: number, compact: boolean) => {
		const direction = directionFor(movement, account.id);
		const { backendFrequency } = detailFor(movement);
		const DirectionIcon =
			direction === "transfer"
				? ArrowRightLeft
				: direction === "in"
					? ArrowDownLeft
					: ArrowUpRight;
		return (
			<>
				<span
					className="recurring-order"
					aria-hidden={compact ? undefined : true}
				>
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
						{movement.amountKnown ? money(movement.amount) : "Varies"}
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
					values={localIds}
					onReorder={handleReorder}
					className="recurring-list"
					aria-label={`Reorder recurring transactions for ${account.name}`}
				>
					{orderedRules.map((movement, index) => (
						<SortableRow
							key={movement.id}
							id={movement.id}
							label={`${index + 1} of ${orderedRules.length}: ${movement.name}`}
							onDragStart={() => {
								draggingRef.current = true;
							}}
							onDrop={handleDrop}
							controls={
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
										disabled={index === orderedRules.length - 1}
										onClick={() => moveBy(movement.id, 1)}
									/>
									<button
										type="button"
										className="text-button"
										aria-label={`Edit ${movement.name}`}
										onClick={() => {
											setEditing(false);
											setSelectedId(movement.id);
										}}
									>
										Edit
									</button>
								</span>
							}
						>
							{rowContent(movement, index + 1, true)}
						</SortableRow>
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
								aria-label={`View ${movement.name}, ${directionLabel(directionFor(movement, account.id)).toLowerCase()} ${frequencyLabel(detailFor(movement).backendFrequency).toLowerCase()}, position ${index + 1} of ${rules.length}`}
								onClick={() => setSelectedId(movement.id)}
							>
								{rowContent(movement, index + 1, false)}
							</button>
						</li>
					))}
				</ul>
			)}
			{selectedId &&
				(() => {
					const movement = rules.find((item) => item.id === selectedId);
					if (!movement) return null;
					return (
						<MovementDetail
							movement={movement}
							accounts={plan.accounts}
							plan={plan}
							onClose={() => setSelectedId(null)}
						/>
					);
				})()}
		</>
	);
}
