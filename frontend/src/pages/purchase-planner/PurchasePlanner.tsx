import { Plus, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { money } from "../../domain/format.ts";
import type {
	PurchasePlannerActions,
	PurchaseViewItem,
} from "./purchase.types.ts";
import { PurchaseInspector } from "./PurchaseInspector.tsx";
import { PurchasePriorityList } from "./PurchasePriorityList.tsx";
import { PurchaseScheduleView } from "./PurchaseScheduleView.tsx";

type View = "priority" | "schedule";
export function PurchasePlanner({
	items,
	forecastEnd,
	locked = false,
	...actions
}: {
	items: PurchaseViewItem[];
	forecastEnd: string;
	locked?: boolean;
} & PurchasePlannerActions) {
	const [view, setView] = useState<View>("priority");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected =
		items.find((item) => item.purchase.id === selectedId) ?? null;
	const included = items.filter((item) => item.purchase.enabled);
	const dated = included.filter((item) => item.outcome.kind === "scheduled");
	const total = included.reduce((sum, item) => sum + item.purchase.amount, 0);
	const inspect = (purchase: PurchaseViewItem["purchase"]) =>
		setSelectedId(purchase.id);
	const edit = () => {
		if (!selected) return;
		setSelectedId(null);
		actions.onEdit?.(selected.purchase);
	};
	const remove = () => {
		if (!selected) return;
		setSelectedId(null);
		actions.onRemove?.(selected.purchase);
	};

	return (
		<section
			aria-label="Planned purchases"
			className="@container/wish-list w-full max-w-3xl"
		>
			<div className="mb-5 flex flex-wrap items-start justify-between gap-4">
				<div>
					<p className="text-xs font-bold tracking-widest text-muted">
						After your commitments
					</p>
					<h2 className="my-2 text-2xl tracking-tight text-ink">
						Planned purchases
					</h2>
					<p className="max-w-[55ch] text-sm text-muted">
						Flexible dates move automatically when your projected finances
						change.
					</p>
				</div>
				{actions.onAdd && (
					<Button
						variant="primary"
						size="sm"
						disabled={locked}
						onClick={actions.onAdd}
					>
						<Plus size={16} aria-hidden="true" /> Add purchase
					</Button>
				)}
			</div>
			{items.length === 0 ? (
				<EmptyState
					icon={ShoppingBag}
					title="What would you like to make room for?"
					description="Add a purchase to discover its earliest financially safe date."
				/>
			) : (
				<>
					<div className="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-2 border-y border-line-strong py-4 text-sm">
						<strong className="text-2xl tabular-nums text-ink">
							{money(total)}
						</strong>
						<span className="text-muted">{included.length} included</span>
						<span className="text-success-text">{dated.length} dated</span>
						<span className="text-muted">
							{included.length - dated.length} not yet dated
						</span>
					</div>
					<Tabs<View>
						items={[
							{ id: "priority", label: "Priority" },
							{ id: "schedule", label: "Schedule" },
						]}
						value={view}
						onChange={setView}
						label="Planned purchase views"
						className="mb-4"
					>
						{view === "priority" ? (
							<PurchasePriorityList
								items={items}
								onInspect={inspect}
								onMove={actions.onMove}
								locked={locked}
							/>
						) : (
							<PurchaseScheduleView
								items={items}
								onInspect={inspect}
								forecastEnd={forecastEnd}
							/>
						)}
					</Tabs>
				</>
			)}
			{selected && (
				<PurchaseInspector
					item={selected}
					locked={locked}
					onClose={() => setSelectedId(null)}
					onEdit={actions.onEdit ? edit : undefined}
					onRemove={actions.onRemove ? remove : undefined}
				/>
			)}
		</section>
	);
}
