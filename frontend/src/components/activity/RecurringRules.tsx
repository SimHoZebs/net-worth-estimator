import {
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	ChevronDown,
	ChevronUp,
	GripVertical,
	Plus,
	Repeat,
} from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { money } from "../../domain/format.ts";
import { toDisplayTransaction } from "../../domain/accountDisplay.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import { scheduleToDisplay } from "../../domain/transactionRows.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import { moveSchedule } from "@/api/generated/endpoints.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	refreshTransactions,
	useServerStatus,
} from "../../state/workspaceResources.ts";
import { scheduleTransaction } from "../../domain/accountActivity.ts";
import { frequencyLabel } from "../../domain/recurringPatterns.ts";
import { Badge } from "@/components/ui/badge.tsx";
import {
	Empty,
	EmptyContent,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@/components/ui/item.tsx";
import { transactionIconStyles } from "./activityStyles.ts";
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
			className="border-b border-border last:border-b-0"
			aria-label={label}
			as="div"
		>
			<Item variant="default" size="sm" className="gap-3 px-2">
				<span
					className="flex touch-none cursor-grab text-muted-foreground"
					aria-hidden="true"
					onPointerDown={(event) => dragControls.start(event)}
				>
					<GripVertical size={16} />
				</span>
				{children}
				{controls}
			</Item>
		</Reorder.Item>
	);
}

export function RecurringRules({
	account,
	accounts,
	rules,
	startDate,
	readOnly,
	onEdit,
}: {
	account: Account;
	accounts: Account[];
	/** Rules touching this account, in execution order. */
	rules: Schedule[];
	startDate: string;
	readOnly: boolean;
	onEdit: (target: EditorTarget) => void;
}) {
	const status = useServerStatus().data;
	const cadenceById = useMemo(
		() =>
			new Map(rules.map((rule) => [rule.id, frequencyLabel(rule.frequency)])),
		[rules],
	);
	const cadenceOf = (id: string) => cadenceById.get(id) ?? "Recurring";
	const [editing, setEditing] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const rows = useMemo(
		() =>
			rules.map((rule) =>
				toDisplayTransaction(scheduleToDisplay(rule), accounts),
			),
		[rules, accounts],
	);
	// Local identity only: the rule is resolved from current rows each
	// render, so updates stay current while a removed rule renders as no
	// selection and closes the detail.
	const selected =
		selectedId === null
			? null
			: (rows.find((row) => row.id === selectedId) ?? null);

	const persistOrder = async (orderedIds: string[]): Promise<boolean> => {
		// Rebuild the account order with row moves, anchoring from the end
		// so each move lands before an already-placed successor.
		for (let index = orderedIds.length - 1; index >= 0; index -= 1) {
			const id = orderedIds[index];
			if (id === undefined) continue;
			const ok = await performSave({
				call: () => moveSchedule(id, { beforeId: orderedIds[index + 1] ?? "" }),
				refresh: refreshTransactions,
				failureMessage: "The order could not be saved.",
			});
			if (!ok) return false;
		}
		return true;
	};

	// Saved order derives straight from server rows, so refreshes, removals,
	// and reorders outside a gesture render directly. Reorder fires
	// onReorder continuously mid-drag, so writing straight to the store
	// re-renders and resets motion's internal order before siblings can
	// displace. Instead a gesture snapshots a temporary order at drag start,
	// plays out in that draft, and settles explicitly on drop.
	const savedIds = useMemo(() => rows.map((row) => row.id), [rows]);
	const [draftIds, setDraftIds] = useState<string[] | null>(null);
	const draftRef = useRef<string[] | null>(null);
	const setDraft = (next: string[] | null) => {
		draftRef.current = next;
		setDraftIds(next);
	};
	const sameOrder = (left: string[], right: string[]) =>
		left.length === right.length &&
		left.every((id, index) => id === right[index]);
	// A draft that matches saved rows renders as saved rows, so an
	// unchanged gesture never holds a stale copy.
	const displayedIds =
		draftIds && !sameOrder(draftIds, savedIds) ? draftIds : savedIds;
	const orderedRules = useMemo(() => {
		const byId = new Map(rows.map((row) => [row.id, row]));
		const ordered = displayedIds
			.map((id) => byId.get(id))
			.filter((item): item is Transaction => item !== undefined);
		const seen = new Set(ordered.map((transaction) => transaction.id));
		for (const transaction of rows) {
			if (!seen.has(transaction.id)) {
				seen.add(transaction.id);
				ordered.push(transaction);
			}
		}
		return ordered;
	}, [rows, displayedIds]);
	const beginGesture = () => {
		if (draftRef.current === null) {
			setDraft(rows.map((row) => row.id));
		}
	};
	const handleReorder = (orderedIds: string[]) => {
		setDraft(orderedIds);
	};

	const handleDrop = () => {
		const next = draftRef.current;
		if (next === null) return;
		const current = rows.map((row) => row.id);
		if (sameOrder(next, current)) {
			setDraft(null);
			return;
		}
		// The in-flight order settles explicitly on completion: a newer
		// gesture replaces the draft, so only this gesture's own preview is
		// discarded — on success the saved rows take over, on failure the
		// server order returns.
		const sent = next;
		void persistOrder(next).then(() => {
			if (draftRef.current === sent) setDraft(null);
		});
	};

	const moveBy = (id: string, delta: -1 | 1) => {
		const base = draftRef.current ?? rows.map((row) => row.id);
		const index = base.indexOf(id);
		const target = index + delta;
		if (index < 0 || target < 0 || target >= base.length) return;
		const next = [...base];
		const [removed] = next.splice(index, 1);
		if (removed === undefined) return;
		next.splice(target, 0, removed);
		const sent = next;
		setDraft(next);
		void persistOrder(next).then(() => {
			if (draftRef.current === sent) setDraft(null);
		});
	};

	const canEdit = !readOnly && !status?.readOnly;

	if (!rows.length)
		return (
			<Empty className="px-6 py-12">
				<EmptyHeader>
					<EmptyMedia>
						<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
							<Repeat size={28} aria-hidden="true" />
						</span>
					</EmptyMedia>
					<EmptyTitle className="text-lg">
						No recurring transactions for this account yet
					</EmptyTitle>
				</EmptyHeader>
				<EmptyContent>
					<Button
						type="button"
						onClick={() => onEdit({ kind: "schedule", item: null })}
					>
						Add a schedule
					</Button>
				</EmptyContent>
			</Empty>
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
					className="min-w-[2ch] text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums"
					aria-hidden={compact ? undefined : true}
				>
					{order}
				</span>
				<ItemMedia>
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
				</ItemMedia>
				<ItemContent>
					<ItemTitle className="text-xs [overflow-wrap:anywhere]">
						{transaction.name}
					</ItemTitle>
					<ItemDescription>
						{directionLabel(direction)} · {cadenceOf(transaction.id)} ·{" "}
						{transaction.amountKnown ? money(transaction.amount) : "Varies"}
					</ItemDescription>
					{!transaction.enabled && (
						<span className="m-0 flex flex-wrap gap-1">
							<Badge
								variant="secondary"
								className="bg-warning-bg text-warning-text"
							>
								Excluded from account
							</Badge>
						</span>
					)}
				</ItemContent>
			</>
		);
	};

	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<p className="p-0 text-xs leading-[1.8] text-muted-foreground">
					Execution order for this account. Same-day transactions apply in this
					order.
				</p>
				{canEdit && (
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => onEdit({ kind: "schedule", item: null })}
						>
							<Plus size={16} aria-hidden="true" />
							Add schedule
						</Button>
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
							onClick={() => {
								// Leaving edit mode settles like a drop: the draft
								// returns to saved rows instead of lingering.
								if (editing) setDraft(null);
								setEditing((previous) => !previous);
							}}
						>
							{editing ? "Done" : "Edit"}
						</Button>
					</div>
				)}
			</div>
			{editing ? (
				<Reorder.Group
					axis="y"
					values={displayedIds}
					onReorder={handleReorder}
					className="m-0 flex list-none flex-col border-t border-border p-0"
					aria-label={`Reorder recurring transactions for ${account.name}`}
				>
					{orderedRules.map((transaction, index) => (
						<SortableRow
							key={transaction.id}
							id={transaction.id}
							label={`${index + 1} of ${orderedRules.length}: ${transaction.name}`}
							onDragStart={beginGesture}
							onDrop={handleDrop}
							controls={
								<ItemActions className="ml-auto">
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label={`Move ${transaction.name} up`}
										title={`Move ${transaction.name} up`}
										disabled={index === 0}
										onClick={() => moveBy(transaction.id, -1)}
									>
										<ChevronUp aria-hidden="true" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label={`Move ${transaction.name} down`}
										title={`Move ${transaction.name} down`}
										disabled={index === orderedRules.length - 1}
										onClick={() => moveBy(transaction.id, 1)}
									>
										<ChevronDown aria-hidden="true" />
									</Button>
									<Button
										type="button"
										variant="link"
										aria-label={`Edit ${transaction.name}`}
										onClick={() => {
											setDraft(null);
											setEditing(false);
											setSelectedId(transaction.id);
										}}
									>
										Edit
									</Button>
								</ItemActions>
							}
						>
							{rowContent(transaction, index + 1, true)}
						</SortableRow>
					))}
				</Reorder.Group>
			) : (
				<ItemGroup aria-label={`Recurring transactions for ${account.name}`}>
					{rows.map((transaction, index) => (
						<Item
							key={transaction.id}
							variant="default"
							size="sm"
							render={
								<button
									type="button"
									aria-label={`View ${transaction.name}, ${directionLabel(directionFor(transaction, account.id)).toLowerCase()} ${cadenceOf(transaction.id).toLowerCase()}, position ${index + 1} of ${rows.length}`}
									onClick={() => setSelectedId(transaction.id)}
								/>
							}
						>
							{rowContent(transaction, index + 1, false)}
						</Item>
					))}
				</ItemGroup>
			)}
			{selected && (
				<TransactionDetail
					transaction={scheduleTransaction({
						transaction: selected,
						accounts,
						startDate,
					})}
					savedTransaction={selected}
					accounts={accounts}
					readOnly={readOnly}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</>
	);
}
