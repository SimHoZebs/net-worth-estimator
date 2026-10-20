import { useEffect, useState } from "react";
import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/PlanEditor.tsx";
import type { TimingDetailTab } from "../pages/outlook/timing/timingDetailModel.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import {
	discardHash,
	editorHash,
	evidenceHash,
	pageHash,
	resolveOverlayRoute,
	timingDetailHash,
	type PlanLike,
	type WorkspaceRoute,
} from "./route.ts";

// Overlay state lives in the URL hash (see route.ts): opening a modal pushes
// a hash, closing one pushes the page hash, and the back button, bookmarks,
// and direct loads all resolve through the same parser. While the plan has
// not loaded yet, a routed overlay waits instead of rendering; when the plan
// is ready but the routed id or slug matches nothing, the hash normalizes
// back to the page.
export function useWorkspaceOverlays({
	discard,
	route,
	pushHash,
	replaceHash,
}: {
	discard: () => boolean | Promise<boolean>;
	route: WorkspaceRoute;
	pushHash: (hash: string) => void;
	replaceHash: (hash: string) => void;
}) {
	const plan: PlanLike | null = useWorkspaceStore(
		(state) => state.workspace?.draft ?? state.workspace?.saved ?? null,
	);
	const resolution = resolveOverlayRoute(route, plan);
	const [returnTo, setReturnTo] = useState<EvidenceTarget | null>(null);
	const [discarding, setDiscarding] = useState(false);
	const page = route.page;

	// Unknown overlays (bad shape, or an id/slug the loaded plan does not
	// contain) normalize back to the page without adding history.
	useEffect(() => {
		if (resolution.state === "unknown") replaceHash(pageHash(page));
	}, [resolution.state, page, replaceHash]);

	const ready = resolution.state === "ready" ? resolution.overlay : null;
	const evidence = ready?.kind === "evidence" ? ready.target : null;
	const timingDetail = ready?.kind === "timingDetail" ? ready.tab : null;
	const timingEdit = ready?.kind === "timingDetail" ? ready.edit : null;
	const editor = ready?.kind === "editor" ? ready.target : (timingEdit ?? null);
	const discardOpen = ready?.kind === "discard";

	const openEvidence = (target: EvidenceTarget) => {
		if (!plan) return;
		setReturnTo(null);
		pushHash(evidenceHash(page, target, plan));
	};
	const openEditor = (target: EditorTarget) => {
		if (!plan) return;
		// An editor opened from the timing detail stacks onto it, preserving
		// the detail underneath; anywhere else it replaces the overlay.
		if (target.kind === "movement" && route.overlay?.type === "timingDetail") {
			pushHash(
				timingDetailHash(
					page,
					route.overlay.tab,
					target.item ? target.item.id : "new",
				),
			);
			return;
		}
		setReturnTo(null);
		pushHash(editorHash(page, target));
	};
	// Opening an editor from evidence remembers the evidence so closing the
	// editor returns to it; the back button restores it regardless.
	const editFromEvidence = (target: EditorTarget) => {
		if (!plan) return;
		setReturnTo(evidence);
		pushHash(editorHash(page, target));
	};
	const closeEditor = () => {
		if (!plan) return;
		if (
			route.overlay?.type === "timingDetail" &&
			route.overlay.editMovement !== undefined
		) {
			pushHash(timingDetailHash(page, route.overlay.tab));
			return;
		}
		if (returnTo) {
			setReturnTo(null);
			pushHash(evidenceHash(page, returnTo, plan));
			return;
		}
		pushHash(pageHash(page));
	};
	const closeEvidence = () => {
		pushHash(pageHash(page));
	};
	const openTimingDetail = (tab: TimingDetailTab) => {
		pushHash(timingDetailHash(page, tab));
	};
	const switchTimingTab = (tab: TimingDetailTab) => {
		if (route.overlay?.type !== "timingDetail") return;
		replaceHash(timingDetailHash(page, tab, route.overlay.editMovement));
	};
	const closeTimingDetail = () => {
		pushHash(pageHash(page));
	};
	const openDiscard = () => {
		pushHash(discardHash(page));
	};
	const closeDiscard = () => {
		pushHash(pageHash(page));
	};
	const confirmDiscard = async () => {
		if (discarding) return;
		setDiscarding(true);
		try {
			if (await discard()) closeDiscard();
		} finally {
			setDiscarding(false);
		}
	};
	return {
		editor,
		evidence,
		timingDetail,
		discardOpen,
		discarding,
		openEditor,
		openEvidence,
		editFromEvidence,
		closeEditor,
		closeEvidence,
		openTimingDetail,
		switchTimingTab,
		closeTimingDetail,
		openDiscard,
		closeDiscard,
		confirmDiscard,
	};
}

export type WorkspaceOverlays = ReturnType<typeof useWorkspaceOverlays>;
