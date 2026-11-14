import { Plus, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
	Empty,
	EmptyContent,
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
import { cn } from "@/lib/utils.ts";
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
	loading = false,
	...actions
}: {
	items: PurchaseViewItem[];
	forecastEnd: string;
	locked?: boolean;
	loading?: boolean;
} & PurchasePlannerActions) {
	const [view, setView] = useState<View>("priority");
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
				<Empty className="flex-initial gap-0 px-6 py-12">
					<EmptyHeader>
						<EmptyMedia>
							<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
								<ShoppingBag size={28} />
							</span>
						</EmptyMedia>
						<EmptyTitle>
							<h3 className="text-lg">What would you like to make room for?</h3>
						</EmptyTitle>
						<EmptyDescription className="mt-2 mb-5 max-w-sm text-muted">
							Add a purchase to discover its earliest financially safe date.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent />
				</Empty>
			) : (
				<>
					<div className="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-2 border-y border-line-strong py-4 text-sm">
						<strong className="text-2xl tabular-nums text-ink">
							{money(total)}
						</strong>
						<span className="text-muted">{included.length} included</span>
						<span className="text-success-text">
							{pending ? "Calculating dates…" : `${dated.length} dated`}
						</span>
						{!pending && (
							<span className="text-muted">
								{included.length - dated.length} not yet dated
							</span>
						)}
					</div>
					<Tabs value={view} onValueChange={(value) => setView(value as View)}>
						<TabsList
							variant="line"
							aria-label="Planned purchase views"
							className={cn(
								"mb-4 flex w-full gap-6 overflow-x-auto border-0 border-b border-solid border-line p-0 max-sm:gap-5",
							)}
						>
							<TabsTrigger
								value="priority"
								className={cn(
									"flex h-auto flex-none items-center gap-2 border-0 border-b-2 border-solid border-transparent bg-transparent px-0.5 pt-3 pb-4 text-sm font-normal whitespace-nowrap text-muted after:hidden hover:text-ink aria-selected:font-semibold aria-selected:text-ink",
									"focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-primary focus-visible:ring-0",
								)}
							>
								Priority
							</TabsTrigger>
							<TabsTrigger
								value="schedule"
								className={cn(
									"flex h-auto flex-none items-center gap-2 border-0 border-b-2 border-solid border-transparent bg-transparent px-0.5 pt-3 pb-4 text-sm font-normal whitespace-nowrap text-muted after:hidden hover:text-ink aria-selected:font-semibold aria-selected:text-ink",
									"focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-primary focus-visible:ring-0",
								)}
							>
								Schedule
							</TabsTrigger>
						</TabsList>
						{view === "priority" ? (
							<TabsContent value="priority">
								<PurchasePriorityList
									items={items}
									onInspect={inspect}
									onMove={actions.onMove}
									locked={locked}
								/>
							</TabsContent>
						) : (
							<TabsContent value="schedule">
								<PurchaseScheduleView
									items={items}
									onInspect={inspect}
									forecastEnd={forecastEnd}
								/>
							</TabsContent>
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
