import { Suspense, lazy } from "react";
import type { WorkspaceOverlays } from "./useWorkspaceOverlays.ts";
import { Modal } from "../components/Modal.tsx";
import { Button } from "../components/Button.tsx";

export function WorkspaceInvalidLink({ onClose }: { onClose: () => void }) {
	return (
		<section
			aria-label="Invalid workspace link"
			className="grid justify-items-start gap-4 p-6"
		>
			<h2 className="text-2xl">Invalid workspace link</h2>
			<p>
				This link has invalid or conflicting dialog parameters. Check the
				address or continue on this page.
			</p>
			<Button onClick={onClose}>Continue on this page</Button>
		</section>
	);
}

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
// Editors and their row forms are interaction-only: keep them out of the
// boot chunk and fetch the one the user opens.
const WorkspaceEditor = lazy(() =>
	import("../components/WorkspaceEditor.tsx").then((module) => ({
		default: module.WorkspaceEditor,
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
			<Suspense fallback={null}>
				<CurrentPositionDialog onClose={overlays.closeEvidence} />
			</Suspense>
		);
	return (
		<Suspense fallback={null}>
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
	if (overlays.unavailable)
		return (
			<Modal
				title="Linked item unavailable"
				onClose={overlays.closeUnavailable}
			>
				<p>
					This item does not exist or is not available in this workspace. Close
					this message to continue on this page.
				</p>
			</Modal>
		);
	if (!overlays.editor) return null;
	return (
		<Suspense fallback={null}>
			<WorkspaceEditor
				target={overlays.editor}
				onClose={overlays.closeEditor}
			/>
		</Suspense>
	);
}
