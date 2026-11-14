import { Suspense, lazy } from "react";
import type { WorkspaceOverlays } from "./useWorkspaceOverlays.ts";
import { Button } from "@/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { useModalRegistration } from "../state/modalPresence.ts";

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
			<Button variant="secondary" onClick={onClose}>
				Continue on this page
			</Button>
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
	// The native dialog registers itself with the modal presence counter so
	// the mobile navigation swipe never stacks the nav sheet above it.
	useModalRegistration(overlays.unavailable);
	if (overlays.unavailable)
		return (
			<Dialog
				open
				onOpenChange={(next) => {
					if (!next) overlays.closeUnavailable();
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Linked item unavailable</DialogTitle>
						<DialogDescription>
							This item does not exist or is not available in this workspace.
							Close this message to continue on this page.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="secondary" />}>
							Close message
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</Dialog>
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
