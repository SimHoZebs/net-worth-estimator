import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { ProjectionUpdating } from "../../components/ProjectionUpdating.tsx";
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
} from "../../state/savedRows.ts";
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
	const [removeError, setRemoveError] = useState<string | null>(null);
	const [moveError, setMoveError] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState("");
	if (!accounts || !purchases || !startDate) return null;
	const items = toPurchaseViewItems({ purchases, accounts, schedule });
	const end = horizonDate({ start: startDate, years });

	const moveItem = (purchase: PlannedPurchase, direction: -1 | 1) => {
		if (locked || purchase.readOnly) return;
		setMoveError(null);
		void moveSavedPurchase(purchases, purchase.id, direction).then(
			({ ok, next }) => {
				if (!ok) {
					setMoveError(
						"The purchase could not be moved. Review the workspace notice and try again.",
					);
					return;
				}
				if (!next) return;
				const index = next.findIndex((item) => item.id === purchase.id);
				setAnnouncement(`${purchase.name} is now priority ${index + 1}.`);
			},
		);
	};

	const confirmRemove = async () => {
		if (!remove || removing) return;
		setRemoving(true);
		setRemoveError(null);
		const ok = await removeSavedPurchase(remove.id);
		setRemoving(false);
		if (ok) setRemove(null);
		else setRemoveError("The purchase could not be removed.");
	};

	const editorPriority = editor?.item
		? purchases.findIndex((item) => item.id === editor.item!.id)
		: purchases.length;

	return (
		<>
			{projection.loading && base && <ProjectionUpdating />}
			<PurchasePlanner
				items={items}
				forecastEnd={end}
				locked={locked}
				onAdd={() => setEditor({ item: null })}
				onEdit={(purchase) => setEditor({ item: purchase })}
				onRemove={setRemove}
				onMove={moveItem}
			/>
			{moveError && <ErrorNotice message={moveError} />}
			<p className="sr-only" role="status">
				{announcement}
			</p>
			{editor && (
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
				<ConfirmDialog
					title={`Remove ${remove.name}?`}
					eyebrow="Planned purchases"
					cancelLabel="Keep item"
					confirmLabel="Remove and save"
					busyLabel="Removing…"
					busy={removing}
					error={removeError}
					onCancel={() => {
						setRemove(null);
						setRemoveError(null);
					}}
					onConfirm={() => void confirmRemove()}
				>
					<p>This removes the item and saves immediately.</p>
				</ConfirmDialog>
			)}
		</>
	);
}
