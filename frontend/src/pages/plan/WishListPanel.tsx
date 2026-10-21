import {
	ArrowDown,
	ArrowUp,
	Pencil,
	Plus,
	ShoppingBag,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EmptyState } from "../../components/ui.tsx";
import { money } from "../../domain/format.ts";
import {
	type Movement,
	type Plan,
	visibleMovements,
} from "../../domain/model.ts";
import { movePurchase, purchaseQueue } from "../../domain/purchases.ts";
import { horizonDate, type PurchaseSchedule } from "../../domain/result.ts";
import { useUiStore } from "../../state/uiStore.ts";
import { useWorkspaceStore } from "../../state/workspaceStore.ts";
import { PurchaseTimeline } from "./PurchaseTimeline.tsx";
import { WishListEditor } from "./WishListEditor.tsx";
import "./wish-list.css";

export function WishListPanel({
	plan,
	schedule,
}: {
	plan: Plan;
	schedule: PurchaseSchedule | null;
}) {
	const onUpdate = useWorkspaceStore((state) => state.updatePlan);
	const readOnly = useWorkspaceStore((state) =>
		Boolean(
			state.status?.readOnly ||
			state.writeBlocked ||
			state.workspace?.draftStale,
		),
	);
	const years = useUiStore((state) => state.years);
	const [editor, setEditor] = useState<{ item: Movement | null } | null>(null);
	const [remove, setRemove] = useState<Movement | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const queue = purchaseQueue(
		visibleMovements({ movements: plan.movements, accounts: plan.accounts }),
	);
	const locked = readOnly || plan.readOnly;
	const end = horizonDate({ start: plan.startDate, years });
	const total = queue
		.filter((item) => item.enabled)
		.reduce((sum, item) => sum + item.amount, 0);
	const move = (item: Movement, direction: -1 | 1) => {
		const next = movePurchase(plan, item.id, direction);
		if (onUpdate(next))
			setAnnouncement(
				`${item.name} is now priority ${purchaseQueue(next.movements).findIndex((entry) => entry.id === item.id) + 1}.`,
			);
	};
	return (
		<div className="wish-list">
			<div className="wish-list-heading">
				<div>
					<span className="eyebrow">After your commitments</span>
					<h2>Planned purchases</h2>
					<p>
						Buy in order. If an item cannot fit, it and the items below it wait.
						This evaluation does not change your main projection or FI results.
					</p>
				</div>
				<button
					type="button"
					className="button primary small"
					disabled={locked}
					onClick={() => setEditor({ item: null })}
				>
					<Plus size={16} aria-hidden="true" /> Add purchase
				</button>
			</div>
			{queue.length === 0 ? (
				<EmptyState
					icon={ShoppingBag}
					title="What would you like to make room for?"
					description="Add a purchase and see when it fits without a future funding gap."
				/>
			) : (
				<>
					<div className="wish-list-total">
						<span>
							{queue.filter((item) => item.enabled).length} items in queue
						</span>
						<strong className="type-value">{money(total)}</strong>
					</div>
					{/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list semantics for list-style:none. */}
					<ol className="wish-list-items" role="list">
						{queue.map((item, index) => (
							<li
								key={item.id}
								className="wish-list-item"
								data-excluded={!item.enabled}
							>
								<span className="wish-list-rank" aria-hidden="true">
									{String(index + 1).padStart(2, "0")}
								</span>
								<div className="wish-list-item-name">
									<strong>{item.name}</strong>
									<span>
										{
											plan.accounts.find(
												(account) => account.id === item.fromId,
											)?.name
										}
										{!item.enabled && " · Excluded"}
									</span>
								</div>
								<strong className="wish-list-cost">{money(item.amount)}</strong>
								<div className="wish-list-actions">
									<button
										type="button"
										className="icon-button"
										aria-label={`Move ${item.name} up`}
										disabled={locked || item.readOnly || index === 0}
										onClick={() => move(item, -1)}
									>
										<ArrowUp size={16} aria-hidden="true" />
									</button>
									<button
										type="button"
										className="icon-button"
										aria-label={`Move ${item.name} down`}
										disabled={
											locked || item.readOnly || index === queue.length - 1
										}
										onClick={() => move(item, 1)}
									>
										<ArrowDown size={16} aria-hidden="true" />
									</button>
									<button
										type="button"
										className="icon-button"
										aria-label={`Edit ${item.name}`}
										disabled={locked || item.readOnly}
										onClick={() => setEditor({ item })}
									>
										<Pencil size={15} aria-hidden="true" />
									</button>
									<button
										type="button"
										className="icon-button"
										aria-label={`Remove ${item.name}`}
										disabled={locked || item.readOnly}
										onClick={() => setRemove(item)}
									>
										<Trash2 size={15} aria-hidden="true" />
									</button>
								</div>
							</li>
						))}
					</ol>
					<PurchaseTimeline
						queue={queue}
						schedule={schedule}
						start={plan.startDate}
						end={end}
					/>
				</>
			)}
			<p className="sr-only" role="status">
				{announcement}
			</p>
			{editor && (
				<WishListEditor
					plan={plan}
					item={editor.item}
					readOnly={locked || Boolean(editor.item?.readOnly)}
					onApply={onUpdate}
					onClose={() => setEditor(null)}
				/>
			)}
			{remove && (
				<ConfirmDialog
					title={`Remove ${remove.name}?`}
					eyebrow="Planned purchases"
					cancelLabel="Keep item"
					confirmLabel="Remove from unsaved changes"
					onCancel={() => setRemove(null)}
					onConfirm={() => {
						if (
							onUpdate({
								...plan,
								movements: plan.movements.filter(
									(item) => item.id !== remove.id,
								),
							})
						)
							setRemove(null);
					}}
				>
					<p>Your saved plan stays intact until you save these changes.</p>
				</ConfirmDialog>
			)}
		</div>
	);
}
