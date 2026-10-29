import { useEffect, useState } from "react";
import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/WorkspaceEditor.tsx";
import type { SafeSpendingDetailTab } from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import { useAccountPlan } from "../state/useAccountScope.ts";
import {
	discardHash,
	editorHash,
	evidenceHash,
	pageHash,
	resolveOverlayRoute,
	safeSpendingDetailHash,
	type AccountLike,
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
	const plan: AccountLike | null = useAccountPlan();
	const resolution = resolveOverlayRoute(route, plan);
	const [returnTo, setReturnTo] = useState<EvidenceTarget | null>(null);
	const [discarding, setDiscarding] = useState(false);
	const page = route.page;

	// Unknown overlays (bad shape, or an id/slug the loaded plan does not
	// contain) normalize back to the page without adding history.
	useEffect(() => {
		if (resolution.state === "unknown") replaceHash(pageHash(page));
	}, [resolution.state, page, replaceHash]);

	// The hash is the overlay source of truth: once it resolves to no
	// overlay (closed or normalized), any stacked return target is stale and
	// must clear so a later editor does not reopen old evidence. Pending
	// (plan not loaded yet) preserves the stack: the URL still names the
	// same editor.
	useEffect(() => {
		if (resolution.state === "none" || resolution.state === "unknown")
			// oxlint-disable-next-line react/set-state-in-effect
			setReturnTo(null);
	}, [resolution.state]);

	const ready = resolution.state === "ready" ? resolution.overlay : null;
	const evidence = ready?.kind === "evidence" ? ready.target : null;
	const safeSpendingDetail =
		ready?.kind === "safeSpendingDetail" ? ready.tab : null;
	const safeSpendingEdit =
		ready?.kind === "safeSpendingDetail" ? ready.edit : null;
	const editor =
		ready?.kind === "editor" ? ready.target : (safeSpendingEdit ?? null);
	const discardOpen = ready?.kind === "discard";

	const openEvidence = (target: EvidenceTarget) => {
		if (!plan) return;
		setReturnTo(null);
		pushHash(evidenceHash(page, target, plan));
	};
	const openEditor = (target: EditorTarget) => {
		if (!plan) return;
		// An editor opened from the safe spending detail stacks onto it, preserving
		// the detail underneath; anywhere else it replaces the overlay.
		if (
			target.kind === "transaction" &&
			route.overlay?.type === "safeSpendingDetail"
		) {
			pushHash(
				safeSpendingDetailHash(
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
			route.overlay?.type === "safeSpendingDetail" &&
			route.overlay.editTransaction !== undefined
		) {
			pushHash(safeSpendingDetailHash(page, route.overlay.tab));
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
	const openSafeSpendingDetail = (tab: SafeSpendingDetailTab) => {
		pushHash(safeSpendingDetailHash(page, tab));
	};
	const switchSafeSpendingTab = (tab: SafeSpendingDetailTab) => {
		if (route.overlay?.type !== "safeSpendingDetail") return;
		replaceHash(
			safeSpendingDetailHash(page, tab, route.overlay.editTransaction),
		);
	};
	const closeSafeSpendingDetail = () => {
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
		safeSpendingDetail,
		discardOpen,
		discarding,
		openEditor,
		openEvidence,
		editFromEvidence,
		closeEditor,
		closeEvidence,
		openSafeSpendingDetail,
		switchSafeSpendingTab,
		closeSafeSpendingDetail,
		openDiscard,
		closeDiscard,
		confirmDiscard,
	};
}

export type WorkspaceOverlays = ReturnType<typeof useWorkspaceOverlays>;
