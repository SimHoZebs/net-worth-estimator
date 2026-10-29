import { Suspense, lazy } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { WorkspaceEditor } from "../components/WorkspaceEditor.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import {
	selectDraftChangeCount,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { useAccountPlan } from "../state/useAccountScope.ts";
import { stageAndSave } from "../state/workspaceWrites.ts";
import type { WorkspaceOverlays } from "./useWorkspaceOverlays.ts";

const EvidenceDialog = lazy(() =>
	import("../components/EvidenceDialog.tsx").then((module) => ({
		default: module.EvidenceDialog,
	})),
);

const CurrentPositionDialog = lazy(() =>
	import("../components/evidence/CurrentPositionDialog.tsx").then((module) => ({
		default: module.CurrentPositionDialog,
	})),
);

export function WorkspaceEvidence({
	overlays,
}: {
	overlays: WorkspaceOverlays;
}) {
	const plan = useAccountPlan();
	// Evidence subscribes to the base case only while its dialog is open.
	if (!overlays.evidence) return null;
	if (overlays.evidence.kind === "position")
		return plan ? (
			<Suspense fallback={<Skeleton className="h-32 w-full" />}>
				<CurrentPositionDialog plan={plan} onClose={overlays.closeEvidence} />
			</Suspense>
		) : null;
	return <WorkspaceEvidenceLoaded overlays={overlays} />;
}

function WorkspaceEvidenceLoaded({
	overlays,
}: {
	overlays: WorkspaceOverlays;
}) {
	const plan = useAccountPlan();
	const hasDraft = useWorkspaceStore((state) => state.draft != null);
	const projection = useRemoteProjection({ ranges: false });
	const base =
		projection.base instanceof Error || projection.base === null
			? null
			: projection.base;
	if (
		!overlays.evidence ||
		overlays.evidence.kind === "position" ||
		!plan ||
		!base
	)
		return null;
	return (
		<Suspense fallback={<Skeleton className="h-32 w-full" />}>
			<EvidenceDialog
				target={overlays.evidence}
				plan={plan}
				projection={base}
				temporary={hasDraft}
				onClose={overlays.closeEvidence}
				onEdit={overlays.editFromEvidence}
				onApply={stageAndSave}
			/>
		</Suspense>
	);
}

export function WorkspaceDialogs({
	overlays,
}: {
	overlays: WorkspaceOverlays;
}) {
	const plan = useAccountPlan();
	const applyError = useWorkspaceStore((state) => state.error);
	const changeCount = useWorkspaceStore(selectDraftChangeCount);
	if (!plan) return null;
	return (
		<>
			{overlays.editor && (
				<WorkspaceEditor
					target={overlays.editor}
					plan={plan}
					onApply={stageAndSave}
					applyError={applyError}
					onClose={overlays.closeEditor}
				/>
			)}
			{overlays.discardOpen && (
				<ConfirmDialog
					title="Return to your last save?"
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
						Your last save stays intact.
					</p>
				</ConfirmDialog>
			)}
		</>
	);
}
