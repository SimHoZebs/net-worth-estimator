import { Plus, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
	Tabs,
	TabsList,
	TabsTrigger,
	TabsContent,
} from "@/components/ui/tabs.tsx";
import { money } from "../../domain/format.ts";
import type {
	PurchasePlannerActions,
	PurchaseViewItem,
} from "./purchase.types.ts";
import { PurchaseInspector } from "./PurchaseInspector.tsx";
import { PurchasePriorityList } from "./PurchasePriorityList.tsx";
import { PurchaseScheduleView } from "./PurchaseScheduleView.tsx";

export function PurchasePlanner({
	items,
	forecastEnd,
	locked = false,
	loading = false,
	...actions
}: {
	items: PurchaseViewItem[];
	forecastEnd: string;
	locked?: boolean;
	loading?: boolean;
} & PurchasePlannerActions) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected =
		items.find((item) => item.purchase.id === selectedId) ?? null;
	const included = items.filter((item) => item.purchase.enabled);
	const dated = included.filter((item) => item.outcome.kind === "scheduled");
	const pending = included.some((item) => item.outcome.kind === "pending");
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
			<div className="mb-5 flex justify-end">
				{actions.onAdd && (
					<Button
						type="button"
						variant="default"
						size="sm"
						disabled={locked}
						onClick={actions.onAdd}
					>
						<Plus size={16} aria-hidden="true" /> Add purchase
					</Button>
				)}
			</div>
			{loading ? (
				<div
					className="space-y-5"
					aria-label="Loading planned purchases"
					aria-busy="true"
				>
					<Skeleton
						className="h-16"
						role="status"
						aria-label="Loading purchase totals"
					/>
					<Skeleton
						className="h-10 w-48"
						role="status"
						aria-label="Loading purchase views"
					/>
					<Skeleton
						className="h-24"
						role="status"
						aria-label="Loading purchases"
					/>
				</div>
			) : items.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<ShoppingBag aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>What would you like to make room for?</EmptyTitle>
						<EmptyDescription>
							Add a purchase to discover its earliest financially safe date.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<>
					<div className="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-2 border-y border-input py-4 text-sm">
						<strong className="text-2xl tabular-nums text-foreground">
							{money(total)}
						</strong>
						<span className="text-muted-foreground">
							{included.length} included
						</span>
						<span className="text-success-text">
							{pending ? "Calculating dates…" : `${dated.length} dated`}
						</span>
						{!pending && (
							<span className="text-muted-foreground">
								{included.length - dated.length} not yet dated
							</span>
						)}
					</div>
					<Tabs defaultValue="priority">
						<TabsList
							variant="line"
							scrollable
							aria-label="Planned purchase views"
							className="mb-4 gap-6 max-sm:gap-5"
						>
							<TabsTrigger value="priority" className="flex-none">
								Priority
							</TabsTrigger>
							<TabsTrigger value="schedule" className="flex-none">
								Schedule
							</TabsTrigger>
						</TabsList>
						<TabsContent value="priority">
							<PurchasePriorityList
								items={items}
								onInspect={inspect}
								onMove={actions.onMove}
								locked={locked}
							/>
						</TabsContent>
						<TabsContent value="schedule">
							<PurchaseScheduleView
								items={items}
								onInspect={inspect}
								forecastEnd={forecastEnd}
							/>
						</TabsContent>
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
