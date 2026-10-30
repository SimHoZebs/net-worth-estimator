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
import type { Account, Transaction } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import { moveRule } from "@/api/generated/endpoints.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	refreshTransactions,
	useServerStatus,
} from "../../state/workspaceResources.ts";
import { ruleTransaction } from "../../domain/accountActivity.ts";
import { Badge } from "../Badge.tsx";
import { EmptyState } from "../EmptyState.tsx";
import { Button, IconButton, TextButton } from "../Button.tsx";
import {
	transactionIconStyles,
	transactionBadgeStyles,
} from "./activityStyles.ts";
import { TransactionDetail } from "./TransactionDetail.tsx";

type Direction = "in" | "out" | "transfer";

function directionFor(transaction: Transaction, accountId: string): Direction {
	if (transaction.fromId && transaction.toId) return "transfer";
	if (transaction.fromId === accountId) return "out";
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
			className="flex items-center gap-3 border-b border-line bg-transparent p-3 max-sm:gap-2 max-sm:px-2 max-sm:py-3"
			aria-label={label}
		>
			<span
				className="flex touch-none cursor-grab text-muted"
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
	accounts,
	transactions,
	startDate,
	readOnly,
	onEdit,
}: {
	account: Account;
	accounts: Account[];
	transactions: Transaction[];
	startDate: string;
	readOnly: boolean;
	onEdit: (target: EditorTarget) => void;
}) {
	const status = useServerStatus().data;
	const [editing, setEditing] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const rules = useMemo(
		() =>
			transactions.filter(
				(transaction) =>
					transaction.frequency !== "once" &&
					(transaction.fromId === account.id ||
						transaction.toId === account.id),
			),
		[transactions, account.id],
	);
	if (selectedId !== null && !rules.some((rule) => rule.id === selectedId))
		setSelectedId(null);

	const persistOrder = async (orderedIds: string[]): Promise<boolean> => {
		// Rebuild the account order with row moves, anchoring from the end
		// so each move lands before an already-placed successor.
		for (let index = orderedIds.length - 1; index >= 0; index -= 1) {
			const id = orderedIds[index];
			if (id === undefined) continue;
			const ok = await performSave({
				call: () => moveRule({ id, beforeId: orderedIds[index + 1] ?? "" }),
				refresh: refreshTransactions,
				failureMessage: "The order could not be saved.",
			});
			if (!ok) return false;
		}
		return true;
	};

	// Local drag order. Reorder fires onReorder continuously mid-drag, so
	// writing straight to the store re-renders and resets motion's internal
	// order before siblings can displace. Instead the drag plays out in
	// local state (siblings push/pull freely) and persists once on drop.
	const [localIds, setLocalIds] = useState<string[]>([]);
	const localIdsRef = useRef<string[]>([]);
	const draggingRef = useRef(false);
	const ids = rules.map((transaction) => transaction.id);
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
		const byId = new Map(
			rules.map((transaction) => [transaction.id, transaction]),
		);
		const ordered = localIds
			.map((id) => byId.get(id))
			.filter((item): item is Transaction => item !== undefined);
		for (const transaction of rules) {
			if (!ordered.includes(transaction)) ordered.push(transaction);
		}
		return ordered;
	}, [rules, localIds]);

	const handleDrop = () => {
		draggingRef.current = false;
		const current = rules.map((transaction) => transaction.id);
		const next = localIdsRef.current;
		if (
			current.length !== next.length ||
			current.some((id, index) => id !== next[index])
		) {
			void persistOrder(next).then((ok) => {
				if (!ok) {
					localIdsRef.current = current;
					setLocalIds(current);
				}
			});
		}
	};

	const moveBy = (id: string, delta: -1 | 1) => {
		const ids = rules.map((transaction) => transaction.id);
		const index = ids.indexOf(id);
		const target = index + delta;
		if (index < 0 || target < 0 || target >= ids.length) return;
		const next = [...ids];
		const [removed] = next.splice(index, 1);
		if (removed === undefined) return;
		next.splice(target, 0, removed);
		localIdsRef.current = next;
		setLocalIds(next);
		void persistOrder(next).then((ok) => {
			if (!ok) {
				const current = rules.map((transaction) => transaction.id);
				localIdsRef.current = current;
				setLocalIds(current);
			}
		});
	};

	const canEdit = !readOnly && !status?.readOnly;

	if (!rules.length)
		return (
			<EmptyState
				icon={Repeat}
				title="No recurring transactions for this account yet"
				action="Add a planned transaction"
				onAction={() => onEdit({ kind: "transaction", item: null })}
			/>
		);

	const rowContent = (
		transaction: Transaction,
		order: number,
		compact: boolean,
	) => {
		const direction = directionFor(transaction, account.id);
		const DirectionIcon =
			direction === "transfer"
				? ArrowRightLeft
				: direction === "in"
					? ArrowDownLeft
					: ArrowUpRight;
		return (
			<>
				<span
					className="min-w-[2ch] text-right text-xs whitespace-nowrap text-muted tabular-nums"
					aria-hidden={compact ? undefined : true}
				>
					{order}
				</span>
				<span
					className={transactionIconStyles({
						tone:
							direction === "transfer"
								? "transfer"
								: direction === "in"
									? "inflow"
									: "outflow",
					})}
				>
					<DirectionIcon size={16} aria-hidden="true" />
				</span>
				<span className="flex min-w-0 flex-col gap-1">
					<strong className="m-0 text-xs font-semibold [overflow-wrap:anywhere]">
						{transaction.name}
					</strong>
					<span className="m-0 text-xs text-muted">
						{directionLabel(direction)} ·{" "}
						{frequencyLabel(transaction.frequency)} ·{" "}
						{transaction.amountKnown ? money(transaction.amount) : "Varies"}
					</span>
					{!transaction.enabled && (
						<span className="m-0 flex flex-wrap gap-1">
							<Badge tone="warning" className={transactionBadgeStyles()}>
								Excluded from account
							</Badge>
						</span>
					)}
				</span>
			</>
		);
	};

	return (
		<>
			<div className="flex items-center justify-between gap-4">
				<p className="p-0 text-xs leading-[1.8] text-muted">
					Execution order for this account. Same-day transactions apply in this
					order.
				</p>
				{canEdit && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-pressed={editing}
						aria-label={
							editing
								? "Finish reordering recurring transactions"
								: "Reorder recurring transactions"
						}
						onClick={() => setEditing((previous) => !previous)}
					>
						{editing ? "Done" : "Edit"}
					</Button>
				)}
			</div>
			{editing ? (
				<Reorder.Group
					axis="y"
					values={localIds}
					onReorder={handleReorder}
					className="m-0 flex list-none flex-col border-t border-line p-0"
					aria-label={`Reorder recurring transactions for ${account.name}`}
				>
					{orderedRules.map((transaction, index) => (
						<SortableRow
							key={transaction.id}
							id={transaction.id}
							label={`${index + 1} of ${orderedRules.length}: ${transaction.name}`}
							onDragStart={() => {
								draggingRef.current = true;
							}}
							onDrop={handleDrop}
							controls={
								<span className="ml-auto flex items-center gap-1 max-sm:gap-0.5">
									<IconButton
										icon={ChevronUp}
										label={`Move ${transaction.name} up`}
										disabled={index === 0}
										onClick={() => moveBy(transaction.id, -1)}
									/>
									<IconButton
										icon={ChevronDown}
										label={`Move ${transaction.name} down`}
										disabled={index === orderedRules.length - 1}
										onClick={() => moveBy(transaction.id, 1)}
									/>
									<TextButton
										type="button"
										aria-label={`Edit ${transaction.name}`}
										onClick={() => {
											setEditing(false);
											setSelectedId(transaction.id);
										}}
									>
										Edit
									</TextButton>
								</span>
							}
						>
							{rowContent(transaction, index + 1, true)}
						</SortableRow>
					))}
				</Reorder.Group>
			) : (
				<ul
					className="m-0 flex list-none flex-col border-t border-line p-0"
					aria-label={`Recurring transactions for ${account.name}`}
				>
					{rules.map((transaction, index) => (
						<li
							key={transaction.id}
							className="flex items-center gap-3 border-b border-line bg-transparent p-3 max-sm:gap-2 max-sm:px-2 max-sm:py-3"
						>
							<button
								type="button"
								className="flex min-w-0 flex-1 items-center gap-3 rounded-control border-0 bg-transparent px-2 py-0.5 text-left"
								aria-label={`View ${transaction.name}, ${directionLabel(directionFor(transaction, account.id)).toLowerCase()} ${frequencyLabel(transaction.frequency).toLowerCase()}, position ${index + 1} of ${rules.length}`}
								onClick={() => setSelectedId(transaction.id)}
							>
								{rowContent(transaction, index + 1, false)}
							</button>
						</li>
					))}
				</ul>
			)}
			{selectedId &&
				(() => {
					const transaction = rules.find((item) => item.id === selectedId);
					if (!transaction) return null;
					return (
						<TransactionDetail
							transaction={ruleTransaction({
								transaction,
								accounts,
								startDate,
							})}
							planTransaction={transaction}
							accounts={accounts}
							transactions={transactions}
							readOnly={readOnly}
							onClose={() => setSelectedId(null)}
						/>
					);
				})()}
		</>
	);
}
