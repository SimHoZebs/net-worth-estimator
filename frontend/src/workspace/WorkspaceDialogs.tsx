import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { EvidenceDialog } from "../components/EvidenceDialog.tsx";
import { PlanEditor } from "../components/PlanEditor.tsx";
import { changesBetween } from "../domain/model.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import type { WorkspaceOverlays } from "./useWorkspaceOverlays.ts";

export function WorkspaceEvidence({
	overlays,
}: {
	overlays: WorkspaceOverlays;
}) {
	// Hooks subscribe only while the dialog is open: mounting attaches to the
	// page's in-flight stream (or its cached result) instead of duplicating it.
	if (!overlays.evidence) return null;
	return <WorkspaceEvidenceLoaded overlays={overlays} />;
}

function WorkspaceEvidenceLoaded({
	overlays,
}: {
	overlays: WorkspaceOverlays;
}) {
	const workspace = useWorkspaceStore((state) => state.workspace);
	const plan = workspace?.draft ?? workspace?.saved ?? null;
	const projection = useRemoteProjection();
	const base =
		projection.base instanceof Error || projection.base === null
			? null
			: projection.base;
	if (!overlays.evidence || !plan || !base) return null;
	return (
		<EvidenceDialog
			target={overlays.evidence}
			plan={plan}
			projection={base}
			range={projection.range}
			temporary={Boolean(workspace?.draft)}
			onClose={overlays.closeEvidence}
			onEdit={overlays.editFromEvidence}
		/>
	);
}

export function WorkspaceDialogs({
	overlays,
}: {
	overlays: WorkspaceOverlays;
}) {
	const workspace = useWorkspaceStore((state) => state.workspace);
	const plan = workspace?.draft ?? workspace?.saved ?? null;
	const updatePlan = useWorkspaceStore((state) => state.updatePlan);
	const changeCount =
		workspace && plan
			? changesBetween({ saved: workspace.saved, current: plan }).length
			: 0;
	if (!plan) return null;
	return (
		<>
			{overlays.editor && (
				<PlanEditor
					target={overlays.editor}
					plan={plan}
					onApply={updatePlan}
					onClose={overlays.closeEditor}
				/>
			)}
			{overlays.discardOpen && (
				<ConfirmDialog
					title="Return to your saved plan?"
					eyebrow="Discard unsaved changes"
					onCancel={overlays.closeDiscard}
					onConfirm={() => void overlays.confirmDiscard()}
					cancelLabel="Keep exploring"
					confirmLabel="Discard changes"
					busyLabel="Discarding…"
					busy={overlays.discarding}
				>
					<p>
						Your {changeCount} unsaved{" "}
						{changeCount === 1 ? "change will" : "changes will"} be removed.
						Your saved plan and captured comparison measures stay intact.
					</p>
				</ConfirmDialog>
			)}
		</>
	);
}
