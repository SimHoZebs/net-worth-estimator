import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { money } from "../../domain/format.ts";
import type { PlannedPurchase } from "../../domain/model.ts";
import type { PurchaseViewItem } from "./purchase.types.ts";
import { PurchaseStatus } from "./PurchaseStatus.tsx";

/**
 * Priority-queue row geometry for the planned-purchase list:
 * static grid row (index | text | amount | actions), name opens the
 * inspector, status reads as secondary text under the name.
 */
export function PurchaseRow({
	item,
	onInspect,
	onMove,
	canMoveUp = false,
	canMoveDown = false,
	locked = false,
}: {
	item: PurchaseViewItem;
	onInspect: (purchase: PlannedPurchase) => void;
	onMove?: (purchase: PlannedPurchase, direction: -1 | 1) => void;
	canMoveUp?: boolean;
	canMoveDown?: boolean;
	locked?: boolean;
}) {
	const disabledMove = locked || item.purchase.readOnly;
	return (
		<li
			className="group/purchase grid grid-cols-[--spacing(8)_minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-border py-5 @max-xl/wish-list:grid-cols-[--spacing(6)_minmax(0,1fr)_auto] @max-xl/wish-list:gap-3"
			data-excluded={!item.purchase.enabled}
		>
			<span
				className="text-sm text-muted-foreground tabular-nums"
				aria-hidden="true"
			>
				{String(item.priority).padStart(2, "0")}
			</span>
			<div className="flex min-w-0 flex-col gap-2 [overflow-wrap:anywhere]">
				<button
					type="button"
					onClick={() => onInspect(item.purchase)}
					className="rounded-md border-0 bg-transparent px-0 py-0.5 text-left text-inherit"
					aria-label={`Inspect ${item.purchase.name}, priority ${item.priority}`}
				>
					<strong className="text-sm group-data-[excluded=true]/purchase:text-muted-foreground group-data-[excluded=true]/purchase:line-through">
						{item.purchase.name}
					</strong>
				</button>
				<PurchaseStatus item={item} />
			</div>
			<div className="flex min-w-0 max-w-[52%] flex-col items-end gap-1 text-right max-sm:max-w-[48%]">
				<strong className="text-sm tabular-nums">
					{money(item.purchase.amount)}
				</strong>
				<span className="truncate text-xs text-muted-foreground">
					{item.accountName}
					{!item.purchase.enabled && " · Excluded"}
				</span>
			</div>
			{onMove ? (
				<div className="flex flex-wrap gap-1 @max-xl/wish-list:col-[2/-1]">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						title={`Move ${item.purchase.name} up`}
						aria-label={`Move ${item.purchase.name} up`}
						disabled={disabledMove || !canMoveUp}
						onClick={() => onMove(item.purchase, -1)}
						className={cn(
							"min-h-8 min-w-8 max-sm:min-h-9 max-sm:min-w-9 [@media(pointer:coarse)]:min-h-12 [@media(pointer:coarse)]:min-w-12",
						)}
					>
						<ArrowUp size={16} aria-hidden="true" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						title={`Move ${item.purchase.name} down`}
						aria-label={`Move ${item.purchase.name} down`}
						disabled={disabledMove || !canMoveDown}
						onClick={() => onMove(item.purchase, 1)}
						className={cn(
							"min-h-8 min-w-8 max-sm:min-h-9 max-sm:min-w-9 [@media(pointer:coarse)]:min-h-12 [@media(pointer:coarse)]:min-w-12",
						)}
					>
						<ArrowDown size={16} aria-hidden="true" />
					</Button>
				</div>
			) : (
				<span aria-hidden="true" />
			)}
		</li>
	);
}
