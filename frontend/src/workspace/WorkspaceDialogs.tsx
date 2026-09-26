import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { EvidenceDialog } from "../components/EvidenceDialog.tsx";
import { PlanEditor } from "../components/PlanEditor.tsx";
import type { Plan } from "../domain/model.ts";
import type { ProjectionState } from "./types.ts";
import type { WorkspaceOverlays } from "./useWorkspaceOverlays.ts";

export function WorkspaceEvidence({
	overlays,
	plan,
	projection,
	temporary,
	serverMode,
}: {
	overlays: WorkspaceOverlays;
	plan: Plan;
	projection: ProjectionState;
	temporary: boolean;
	serverMode: boolean;
}) {
	if (
		!overlays.evidence ||
		!projection.base ||
		projection.base instanceof Error
	)
		return null;
	return (
		<EvidenceDialog
			target={overlays.evidence}
			plan={plan}
			projection={projection.base}
			range={projection.range}
			temporary={temporary}
			serverMode={serverMode}
			onClose={overlays.closeEvidence}
			onEdit={overlays.editFromEvidence}
		/>
	);
}

export function WorkspaceDialogs({
	overlays,
	plan,
	changeCount,
	onUpdate,
}: {
	overlays: WorkspaceOverlays;
	plan: Plan;
	changeCount: number;
	onUpdate: (plan: Plan) => boolean;
}) {
	return (
		<>
			{overlays.editor && (
				<PlanEditor
					target={overlays.editor}
					plan={plan}
					onApply={onUpdate}
					onClose={overlays.closeEditor}
				/>
			)}
			{overlays.discardOpen && (
				<ConfirmDialog
					title="Return to your saved plan?"
					eyebrow="Discard temporary version"
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
