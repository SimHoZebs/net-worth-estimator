import { useEffect } from "react";
import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/WorkspaceEditor.tsx";
import type { SafeSpendingDetailTab } from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import {
	useSavedAccounts,
	useSavedTransactions,
	useSavedEvaluations,
} from "../state/savedRows.ts";
import {
	editorHash,
	evidenceHash,
	pageHash,
	resolveOverlayRoute,
	safeSpendingDetailHash,
	type OverlayRows,
	type WorkspaceRoute,
} from "./route.ts";

/** URL overlays resolve against saved row queries, never unsaved form fields. */
export function useWorkspaceOverlays({
	route,
	returnTo,
	pushHash,
	replaceHash,
}: {
	route: WorkspaceRoute;
	returnTo: EvidenceTarget | null;
	pushHash: (hash: string, returnTo?: EvidenceTarget | null) => void;
	replaceHash: (hash: string) => void;
}) {
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const evaluations = useSavedEvaluations();
	const rows: OverlayRows = { accounts, transactions, evaluations };
	const resolution = resolveOverlayRoute(route, rows);
	const page = route.page;
	useEffect(() => {
		if (resolution.state === "unknown") replaceHash(pageHash(page));
	}, [resolution.state, page, replaceHash]);
	const ready = resolution.state === "ready" ? resolution.overlay : null;
	const evidence = ready?.kind === "evidence" ? ready.target : null;
	const safeSpendingDetail =
		ready?.kind === "safeSpendingDetail" ? ready.tab : null;
	const editor =
		ready?.kind === "editor"
			? ready.target
			: ready?.kind === "safeSpendingDetail"
				? ready.edit
				: null;
	const openEvidence = (target: EvidenceTarget) => {
		pushHash(evidenceHash(page, target, rows));
	};
	const openEditor = (target: EditorTarget) => {
		if (
			target.kind === "transaction" &&
			route.overlay?.type === "safeSpendingDetail"
		) {
			pushHash(
				safeSpendingDetailHash(
					page,
					route.overlay.tab,
					target.item?.id ?? "new",
				),
			);
			return;
		}
		pushHash(editorHash(page, target));
	};
	const editFromEvidence = (target: EditorTarget) => {
		pushHash(editorHash(page, target), evidence);
	};
	const closeEditor = () => {
		if (
			route.overlay?.type === "safeSpendingDetail" &&
			route.overlay.editTransaction !== undefined
		) {
			pushHash(safeSpendingDetailHash(page, route.overlay.tab));
			return;
		}
		if (returnTo) {
			pushHash(evidenceHash(page, returnTo, rows));
			return;
		}
		pushHash(pageHash(page));
	};
	const closeEvidence = () => pushHash(pageHash(page));
	const openSafeSpendingDetail = (tab: SafeSpendingDetailTab) =>
		pushHash(safeSpendingDetailHash(page, tab));
	const switchSafeSpendingTab = (tab: SafeSpendingDetailTab) => {
		if (route.overlay?.type === "safeSpendingDetail")
			replaceHash(
				safeSpendingDetailHash(page, tab, route.overlay.editTransaction),
			);
	};
	const closeSafeSpendingDetail = () => pushHash(pageHash(page));
	return {
		editor,
		evidence,
		safeSpendingDetail,
		openEditor,
		openEvidence,
		editFromEvidence,
		closeEditor,
		closeEvidence,
		openSafeSpendingDetail,
		switchSafeSpendingTab,
		closeSafeSpendingDetail,
	};
}

export type WorkspaceOverlays = ReturnType<typeof useWorkspaceOverlays>;
