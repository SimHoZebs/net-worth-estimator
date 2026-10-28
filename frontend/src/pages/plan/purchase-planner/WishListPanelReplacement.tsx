import { useState } from "react";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import type { Plan, PlannedPurchase } from "../../../domain/model.ts";
import { movePurchase } from "../../../domain/purchases.ts";
import { horizonDate } from "../../../domain/result.ts";
import type { PurchaseSchedule } from "../../../domain/result.ts";
import { useUiStore } from "../../../state/uiStore.ts";
import { useWorkspaceStore } from "../../../state/workspaceStore.ts";
import {
	useDraftConflict,
	useWorkspaceReadOnly,
} from "../../../state/useWorkspacePlan.ts";
import { WishListEditor } from "../WishListEditor.tsx";
import { toPurchaseViewItems } from "./purchase.adapter.ts";
import { PurchasePlanner } from "./PurchasePlanner.tsx";
import type { PurchaseEnhancements } from "./purchase.types.ts";

/**
 * Drop-in replacement for the current WishListPanel in PurchasesPage.tsx.
 * Preserves the existing plan update, editor, removal and read-only behavior.
 * The optional enhancements prop is for a future fixed-date-aware backend.
 */
export function WishListPanel({
	plan,
	schedule,
	enhancements,
}: {
	plan: Plan;
	schedule: PurchaseSchedule | null;
	enhancements?: PurchaseEnhancements;
}) {
	const onUpdate = useWorkspaceStore((state) => state.updatePlan);
	const applyError = useWorkspaceStore((state) => state.error);
	const blocked = useWorkspaceReadOnly();
	const draftConflict = useDraftConflict();
	const years = useUiStore((state) => state.years);
	const locked = blocked || Boolean(draftConflict) || plan.readOnly;
	const [editor, setEditor] = useState<{ item: PlannedPurchase | null } | null>(
		null,
	);
	const [remove, setRemove] = useState<PlannedPurchase | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const items = toPurchaseViewItems({ plan, schedule, enhancements });
	const end = horizonDate({ start: plan.startDate, years });

	return (
		<>
			<PurchasePlanner
				items={items}
				forecastEnd={end}
				locked={locked}
				onAdd={() => setEditor({ item: null })}
				onEdit={(purchase) => setEditor({ item: purchase })}
				onRemove={setRemove}
				onMove={(purchase, direction) => {
					if (locked || purchase.readOnly) return;
					const next = movePurchase(plan, purchase.id, direction);
					if (onUpdate(next)) {
						const idx = next.plannedPurchases.findIndex(
							(item) => item.id === purchase.id,
						);
						setAnnouncement(`${purchase.name} is now priority ${idx + 1}.`);
					}
				}}
			/>
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
								plannedPurchases: plan.plannedPurchases.filter(
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
		</>
	);
}
