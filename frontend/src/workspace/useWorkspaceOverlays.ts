import { useMemo } from "react";
import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/WorkspaceEditor.tsx";
import type { SafeSpendingDetailTab } from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import { useRouterState } from "@tanstack/react-router";
import {
	useSavedAccounts,
	useSavedSchedules,
	useSavedTransactions,
	useSavedEvaluations,
} from "../state/savedState.ts";
import { scheduleToDisplay } from "../domain/transactionRows.ts";
import {
	editorSearch,
	editorReturnSearch,
	editorReturnTarget,
	evidenceSearch,
	resolveOverlay,
	safeSpendingDetailSearch,
	type OverlayRows,
} from "./overlay.ts";
import { validateWorkspaceSearch } from "./overlaySearch.ts";
import { useOverlayNavigation } from "./useOverlayNavigation.ts";

/** URL overlays resolve against saved row queries, never unsaved form fields. */
export function useWorkspaceOverlays() {
	const navigation = useOverlayNavigation();
	const search = useRouterState({
		select: (state) => validateWorkspaceSearch(state.location.search),
	});
	const returnTo = editorReturnTarget(search);
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const savedRules = useSavedSchedules();
	const ruleRows = useMemo(
		() => (savedRules ?? []).map(scheduleToDisplay),
		[savedRules],
	);
	// Deep links resolve against every saved row. Wait for both row
	// sources so a rule link never reports unavailable before it arrives.
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
	const resolution = resolveOverlay(search, rows);

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
		navigation.open(evidenceSearch(target));
	};
	const openEditor = (target: EditorTarget) => {
		if (target.kind === "transaction" && search.detail !== undefined) {
			navigation.open(
				safeSpendingDetailSearch(
					search.tab ?? "cycle",
					target.item?.id ?? "new",
				),
			);
			return;
		}
		navigation.open({
			...editorSearch(target),
			...editorReturnSearch(evidence),
		});
	};
	const editFromEvidence = (target: EditorTarget) => {
		openEditor(target);
	};
	const closeEditor = () => {
		if (search.detail !== undefined && search.editTransaction !== undefined) {
			navigation.close(safeSpendingDetailSearch(search.tab ?? "cycle"));
			return;
		}
		if (returnTo) {
			navigation.close(evidenceSearch(returnTo));
			return;
		}
		navigation.close();
	};
	const closeEvidence = () => navigation.close();
	const openSafeSpendingDetail = (tab: SafeSpendingDetailTab) =>
		navigation.open(safeSpendingDetailSearch(tab));
	const switchSafeSpendingTab = (tab: SafeSpendingDetailTab) => {
		if (search.detail !== undefined)
			navigation.open(safeSpendingDetailSearch(tab, search.editTransaction), {
				replace: true,
			});
	};
	const closeSafeSpendingDetail = () => navigation.close();
	return {
		unavailable: resolution.state === "unknown",
		closeUnavailable: () => navigation.close(),
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
