import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import type { PlannedPurchase } from "../../domain/model.ts";
import { horizonDate } from "../../domain/result.ts";
import {
	moveSavedPurchase,
	removeSavedPurchase,
} from "../../state/purchaseWrites.ts";
import { PURCHASE_EVALUATIONS } from "../../state/purchaseEvaluation.ts";
import { useRemoteProjection } from "../../state/useRemoteProjection.ts";
import { useUiStore } from "../../state/uiStore.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";
import {
	useSavedAccounts,
	useSavedPurchases,
	useSavedStartDate,
} from "../../state/savedState.ts";
import { PlannedPurchaseEditor } from "./PlannedPurchaseEditor.tsx";
import { toPurchaseViewItems } from "./purchase.adapter.ts";
import { PurchasePlanner } from "./PurchasePlanner.tsx";

/**
 * Planned-purchase panel over saved account and purchase rows. Each save
 * writes targeted row operations and refreshes authoritative state; the form
 * only closes after the server persisted the change.
 */
export function PlannedPurchasePanel() {
	const accounts = useSavedAccounts();
	const purchases = useSavedPurchases();
	const startDate = useSavedStartDate();
	const projection = useRemoteProjection({
		ranges: false,
		evaluations: PURCHASE_EVALUATIONS,
	});
	const base = projection.base instanceof Error ? null : projection.base;
	const current = base !== null && !projection.loading && !projection.baseError;
	const schedule = current ? (base?.plannedPurchases ?? null) : null;
	const blocked = useUserReadOnly();
	const years = useUiStore((state) => state.years);
	const locked = blocked;
	const [editor, setEditor] = useState<{ item: PlannedPurchase | null } | null>(
		null,
	);
	const [remove, setRemove] = useState<PlannedPurchase | null>(null);
	const [removing, setRemoving] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	// Keep saved rows visible while their dates are calculated.
	const savedPending = !accounts || !purchases || !startDate;
	const items = toPurchaseViewItems({
		purchases: purchases ?? [],
		accounts: accounts ?? [],
		schedule,
	});
	const end = startDate ? horizonDate({ start: startDate, years }) : "";

	const moveItem = (purchase: PlannedPurchase, direction: -1 | 1) => {
		if (locked || purchase.readOnly || !purchases) return;
		void moveSavedPurchase(purchases, purchase.id, direction).then(
			({ ok, next }) => {
				if (!ok) return;
				if (!next) return;
				const index = next.findIndex((item) => item.id === purchase.id);
				setAnnouncement(`${purchase.name} is now priority ${index + 1}.`);
			},
		);
	};

	const confirmRemove = async () => {
		if (!remove || removing) return;
		setRemoving(true);
		const ok = await removeSavedPurchase(remove.id);
		setRemoving(false);
		// A failure reaches the toast from the purchase write; the dialog
		// stays open for retry with no inline mirror.
		if (ok) setRemove(null);
	};

	const editorPriority = editor?.item
		? (purchases ?? []).findIndex((item) => item.id === editor.item!.id)
		: (purchases ?? []).length;

	return (
		<>
			<PurchasePlanner
				items={items}
				forecastEnd={end}
				locked={locked || savedPending}
				loading={savedPending}
				onAdd={() => setEditor({ item: null })}
				onEdit={(purchase) => setEditor({ item: purchase })}
				onRemove={setRemove}
				onMove={moveItem}
			/>
			<p className="sr-only" role="status">
				{announcement}
			</p>
			{editor && accounts && startDate && (
				<PlannedPurchaseEditor
					accounts={accounts}
					startDate={startDate}
					item={editor.item}
					priority={Math.max(editorPriority, 0)}
					onSaved={() => setEditor(null)}
					onClose={() => setEditor(null)}
				/>
			)}
			{remove && (
				<AlertDialog
					open
					onOpenChange={(open) => {
						if (!open && !removing) {
							setRemove(null);
						}
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
								Planned purchases
							</p>
							<AlertDialogTitle>Remove {remove.name}?</AlertDialogTitle>
							<AlertDialogDescription>
								This removes the item and saves immediately.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={removing}>
								Keep item
							</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								disabled={removing}
								onClick={() => void confirmRemove()}
							>
								{removing ? "Removing…" : "Remove and save"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
		</>
	);
}
