import type { PlannedPurchase } from "../../domain/model.ts";
import type { PurchaseViewItem } from "./purchase.types.ts";
import { PurchaseRow } from "./PurchaseRow.tsx";

export function PurchasePriorityList({
	items,
	locked,
	onInspect,
	onMove,
}: {
	items: PurchaseViewItem[];
	locked?: boolean;
	onInspect: (item: PlannedPurchase) => void;
	onMove?: (item: PlannedPurchase, direction: -1 | 1) => void;
}) {
	return (
		<section aria-label="Purchase priority">
			<p className="mb-2 text-xs text-muted">
				Higher priorities are considered first. Move an item to recalculate the
				projection.
			</p>
			<ol
				className="m-0 list-none p-0"
				// oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list semantics for list-style:none.
				role="list"
			>
				{items.map((item, index) => (
					<PurchaseRow
						key={item.purchase.id}
						item={item}
						locked={locked}
						onInspect={onInspect}
						onMove={onMove}
						canMoveUp={index > 0}
						canMoveDown={index < items.length - 1}
					/>
				))}
			</ol>
		</section>
	);
}
