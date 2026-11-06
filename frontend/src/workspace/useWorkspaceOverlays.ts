import { useCallback, useEffect, useMemo } from "react";
import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/WorkspaceEditor.tsx";
import type { SafeSpendingDetailTab } from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import {
	useRouter,
	useSearch,
	useMatches,
	useRouterState,
} from "@tanstack/react-router";
import { isRecord } from "../domain/guards.ts";
import {
	useSavedAccounts,
	useSavedSchedules,
	useSavedTransactions,
	useSavedEvaluations,
} from "../state/savedState.ts";
import { scheduleToDisplay } from "../domain/transactionRows.ts";
import {
	editorSearch,
	evidenceSearch,
	resolveOverlay,
	safeSpendingDetailSearch,
	type OverlayRows,
} from "./overlay.ts";
import type { WorkspaceSearch } from "./overlaySearch.ts";

/** The editor's return target lives in history state, never in the URL:
 *  ordinary navigations start without it and Back/Forward restore the
 *  entry's value. Router-internal keys share the state object, so the read
 *  is guarded against foreign shapes. */
function readReturnTo(state: unknown): EvidenceTarget | null {
	if (!isRecord(state) || !isRecord(state.returnTo)) return null;
	const target = state.returnTo;
	switch (target.kind) {
		case "position":
		case "failure":
		case "safe-spending":
			return { kind: target.kind };
		case "account":
			return typeof target.id === "string"
				? { kind: "account", id: target.id }
				: null;
		default:
			return null;
	}
}

/** URL overlays resolve against saved row queries, never unsaved form fields. */
export function useWorkspaceOverlays() {
	const router = useRouter();
	const search = useSearch({ strict: false }) as WorkspaceSearch;
	const matches = useMatches();
	const routeId = matches[matches.length - 1]?.routeId;
	const locationState = useRouterState({
		select: (state) => state.location.state,
	});
	const returnTo = readReturnTo(locationState);
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
	const resolution = resolveOverlay(search, rows);

	const navigateHere = useCallback(
		(
			next: WorkspaceSearch,
			opts?: { replace?: boolean; returnTarget?: EvidenceTarget },
		) => {
			// The root match has no page of its own; overlay moves need a page.
			if (!routeId || routeId === "__root__") return;
			void router.navigate({
				from: routeId,
				to: ".",
				search: next,
				replace: opts?.replace,
				// Search-only moves keep the scroll position: overlay opens and
				// closes must not jump to the top of the page.
				resetScroll: false,
				// Every entry carries an explicit state so ordinary navigations
				// never inherit a previous editor's return target.
				state: opts?.returnTarget ? { returnTo: opts.returnTarget } : {},
			});
		},
		[router, routeId],
	);

	useEffect(() => {
		if (resolution.state === "unknown") navigateHere({}, { replace: true });
	}, [resolution.state, navigateHere]);

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
		navigateHere(evidenceSearch(target, rows));
	};
	const openEditor = (target: EditorTarget) => {
		if (target.kind === "transaction" && search.detail !== undefined) {
			navigateHere(
				safeSpendingDetailSearch(
					search.tab ?? "cycle",
					target.item?.id ?? "new",
				),
			);
			return;
		}
		navigateHere(editorSearch(target));
	};
	const editFromEvidence = (target: EditorTarget) => {
		navigateHere(editorSearch(target), {
			returnTarget: evidence ?? undefined,
		});
	};
	const closeEditor = () => {
		if (search.detail !== undefined && search.editTransaction !== undefined) {
			navigateHere(safeSpendingDetailSearch(search.tab ?? "cycle"));
			return;
		}
		if (returnTo) {
			navigateHere(evidenceSearch(returnTo, rows));
			return;
		}
		navigateHere({});
	};
	const closeEvidence = () => navigateHere({});
	const openSafeSpendingDetail = (tab: SafeSpendingDetailTab) =>
		navigateHere(safeSpendingDetailSearch(tab));
	const switchSafeSpendingTab = (tab: SafeSpendingDetailTab) => {
		if (search.detail !== undefined)
			navigateHere(safeSpendingDetailSearch(tab, search.editTransaction), {
				replace: true,
			});
	};
	const closeSafeSpendingDetail = () => navigateHere({});
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
