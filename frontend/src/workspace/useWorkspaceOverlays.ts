import { useEffect, useMemo } from "react";
import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/WorkspaceEditor.tsx";
import type { SafeSpendingDetailTab } from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import {
	useSavedAccounts,
	useSavedSchedules,
	useSavedTransactions,
	useSavedEvaluations,
} from "../state/savedState.ts";
import { scheduleToDisplay } from "../domain/transactionRows.ts";
import {
	editorUrl,
	evidenceUrl,
	pageUrl,
	resolveOverlayRoute,
	safeSpendingDetailUrl,
	type OverlayRows,
	type WorkspaceRoute,
} from "./route.ts";

/** URL overlays resolve against saved row queries, never unsaved form fields. */
export function useWorkspaceOverlays({
	route,
	returnTo,
	pushUrl,
	replaceUrl,
}: {
	route: WorkspaceRoute;
	returnTo: EvidenceTarget | null;
	pushUrl: (url: string, returnTo?: EvidenceTarget | null) => void;
	replaceUrl: (url: string) => void;
}) {
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const savedRules = useSavedSchedules();
	const ruleRows = useMemo(
		() => (savedRules ?? []).map(scheduleToDisplay),
		[savedRules],
	);
	// Deep links resolve against every saved row. Wait for both row
	// sources so a rule link never normalizes away before it arrives.
	const allTransactions = useMemo(
		() =>
			transactions === null || savedRules === null
				? null
				: [...transactions, ...ruleRows],
		[transactions, savedRules, ruleRows],
	);
	const evaluations = useSavedEvaluations();
	const rows: OverlayRows = {
		accounts,
		transactions: allTransactions,
		evaluations,
	};
	const resolution = resolveOverlayRoute(route, rows);
	const page = route.page;
	useEffect(() => {
		if (resolution.state === "unknown") replaceUrl(pageUrl(page));
	}, [resolution.state, page, replaceUrl]);
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
		pushUrl(evidenceUrl(page, target, rows));
	};
	const openEditor = (target: EditorTarget) => {
		if (
			target.kind === "transaction" &&
			route.overlay?.type === "safeSpendingDetail"
		) {
			pushUrl(
				safeSpendingDetailUrl(
					page,
					route.overlay.tab,
					target.item?.id ?? "new",
				),
			);
			return;
		}
		pushUrl(editorUrl(page, target));
	};
	const editFromEvidence = (target: EditorTarget) => {
		pushUrl(editorUrl(page, target), evidence);
	};
	const closeEditor = () => {
		if (
			route.overlay?.type === "safeSpendingDetail" &&
			route.overlay.editTransaction !== undefined
		) {
			pushUrl(safeSpendingDetailUrl(page, route.overlay.tab));
			return;
		}
		if (returnTo) {
			pushUrl(evidenceUrl(page, returnTo, rows));
			return;
		}
		pushUrl(pageUrl(page));
	};
	const closeEvidence = () => pushUrl(pageUrl(page));
	const openSafeSpendingDetail = (tab: SafeSpendingDetailTab) =>
		pushUrl(safeSpendingDetailUrl(page, tab));
	const switchSafeSpendingTab = (tab: SafeSpendingDetailTab) => {
		if (route.overlay?.type === "safeSpendingDetail")
			replaceUrl(
				safeSpendingDetailUrl(page, tab, route.overlay.editTransaction),
			);
	};
	const closeSafeSpendingDetail = () => pushUrl(pageUrl(page));
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
