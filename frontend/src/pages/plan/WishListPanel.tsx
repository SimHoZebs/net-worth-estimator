import {
	ArrowDown,
	ArrowUp,
	Pencil,
	Plus,
	ShoppingBag,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "../../components/Button.tsx";
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

export function WishListPanel({
	plan,
	schedule,
}: {
	plan: Plan;
	schedule: PurchaseSchedule | null;
}) {
	const onUpdate = useWorkspaceStore((state) => state.updatePlan);
	const applyError = useWorkspaceStore((state) => state.error);
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
		<section aria-label="Planned purchases" className="@container/wish-list">
			<div className="mb-8 flex flex-wrap items-center justify-between gap-4">
				<div>
					<span className="text-xs font-bold tracking-widest text-muted">
						After your commitments
					</span>
					<h2 className="my-2 text-2xl tracking-tight">Planned purchases</h2>
					<p className="max-w-[52ch] text-sm leading-relaxed text-muted">
						Buy in order. If an item cannot fit, it and the items below it wait.
						This evaluation does not change your main projection or FI results.
					</p>
				</div>
				<Button
					type="button"
					variant="primary"
					size="sm"
					disabled={locked}
					onClick={() => setEditor({ item: null })}
				>
					<Plus size={16} aria-hidden="true" /> Add purchase
				</Button>
			</div>
			{queue.length === 0 ? (
				<EmptyState
					icon={ShoppingBag}
					title="What would you like to make room for?"
					description="Add a purchase and see when it fits without a future funding gap."
				/>
			) : (
				<>
					<div className="flex flex-wrap items-baseline justify-between gap-4 border-y border-line-strong py-4">
						<span className="text-sm text-muted">
							{queue.filter((item) => item.enabled).length} items in queue
						</span>
						<strong className="type-value text-3xl">{money(total)}</strong>
					</div>
					<ol
						aria-label="Purchase priorities"
						className="m-0 list-none p-0"
						// oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list semantics for list-style:none.
						role="list"
					>
						{queue.map((item, index) => (
							<li
								key={item.id}
								className="group/purchase grid grid-cols-[--spacing(8)_minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-line py-5 @max-xl/wish-list:grid-cols-[--spacing(6)_minmax(0,1fr)_auto] @max-xl/wish-list:gap-3"
								data-excluded={!item.enabled}
							>
								<span
									className="text-sm text-muted tabular-nums"
									aria-hidden="true"
								>
									{String(index + 1).padStart(2, "0")}
								</span>
								<div className="flex min-w-0 flex-col gap-2 [overflow-wrap:anywhere]">
									<strong className="text-sm group-data-[excluded=true]/purchase:text-muted group-data-[excluded=true]/purchase:line-through">
										{item.name}
									</strong>
									<span className="text-xs text-muted">
										{
											plan.accounts.find(
												(account) => account.id === item.fromId,
											)?.name
										}
										{!item.enabled && " · Excluded"}
									</span>
								</div>
								<strong className="text-sm tabular-nums">
									{money(item.amount)}
								</strong>
								<div className="flex flex-wrap gap-1 @max-xl/wish-list:col-[2/-1]">
									<IconButton
										icon={ArrowUp}
										iconSize={16}
										className="min-h-8 min-w-8 max-sm:min-h-9 max-sm:min-w-9 [@media(pointer:coarse)]:min-h-12 [@media(pointer:coarse)]:min-w-12"
										label={`Move ${item.name} up`}
										disabled={locked || item.readOnly || index === 0}
										onClick={() => move(item, -1)}
									/>
									<IconButton
										icon={ArrowDown}
										iconSize={16}
										className="min-h-8 min-w-8 max-sm:min-h-9 max-sm:min-w-9 [@media(pointer:coarse)]:min-h-12 [@media(pointer:coarse)]:min-w-12"
										label={`Move ${item.name} down`}
										disabled={
											locked || item.readOnly || index === queue.length - 1
										}
										onClick={() => move(item, 1)}
									/>
									<IconButton
										icon={Pencil}
										iconSize={15}
										className="min-h-8 min-w-8 max-sm:min-h-9 max-sm:min-w-9 [@media(pointer:coarse)]:min-h-12 [@media(pointer:coarse)]:min-w-12"
										label={`Edit ${item.name}`}
										disabled={locked || item.readOnly}
										onClick={() => setEditor({ item })}
									/>
									<IconButton
										icon={Trash2}
										iconSize={15}
										className="min-h-8 min-w-8 max-sm:min-h-9 max-sm:min-w-9 [@media(pointer:coarse)]:min-h-12 [@media(pointer:coarse)]:min-w-12"
										label={`Remove ${item.name}`}
										disabled={locked || item.readOnly}
										onClick={() => setRemove(item)}
									/>
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
					applyError={applyError}
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
		</section>
	);
}
