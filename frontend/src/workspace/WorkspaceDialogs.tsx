import { Suspense, lazy } from "react";
import { WorkspaceEditor } from "../components/WorkspaceEditor.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
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
	if (!overlays.evidence) return null;
	if (overlays.evidence.kind === "position")
		return (
			<Suspense fallback={<Skeleton className="h-32 w-full" />}>
				<CurrentPositionDialog onClose={overlays.closeEvidence} />
			</Suspense>
		);
	return (
		<Suspense fallback={<Skeleton className="h-32 w-full" />}>
			<EvidenceDialog
				target={overlays.evidence}
				onClose={overlays.closeEvidence}
				onEdit={overlays.editFromEvidence}
			/>
		</Suspense>
	);
}

export function WorkspaceDialogs({
	overlays,
}: {
	overlays: WorkspaceOverlays;
}) {
	return overlays.editor ? (
		<WorkspaceEditor target={overlays.editor} onClose={overlays.closeEditor} />
	) : null;
}
