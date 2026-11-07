import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { Account, Evaluation, Transaction } from "../domain/model.ts";
import type { EditorTarget } from "../domain/accountEdits.ts";
import type { SafeSpendingDetailTab } from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import type { WorkspaceSearch } from "./overlaySearch.ts";

// Overlay resolution needs only the saved rows used by its lookups. Validated
// search carries the raw key (`id`); the resolver turns it into a dialog
// target, waiting for rows (`pending`) or reporting unavailable IDs (`unknown`)
// so deep links never flash a wrong dialog.

export type OverlayRows = {
	accounts: Account[] | null;
	transactions: Transaction[] | null;
	evaluations: Evaluation[] | null;
};

export type ResolvedOverlay =
	| { kind: "evidence"; target: EvidenceTarget }
	| { kind: "editor"; target: EditorTarget }
	| {
			kind: "safeSpendingDetail";
			tab: SafeSpendingDetailTab;
			edit: EditorTarget | null;
	  };

export type OverlayResolution =
	| { state: "none" }
	| { state: "pending" }
	| { state: "unknown" }
	| { state: "ready"; overlay: ResolvedOverlay };

/** Links identify saved accounts by stable ID. Archived accounts stay hidden. */
export function findAccount(
	rows: Pick<OverlayRows, "accounts">,
	key: string,
): Account | undefined {
	return rows.accounts?.find(
		(account) => !account.archived && account.id === key,
	);
}

function unknown(): OverlayResolution {
	return { state: "unknown" };
}

function ready(overlay: ResolvedOverlay): OverlayResolution {
	return { state: "ready", overlay };
}

export function resolveOverlay(
	search: WorkspaceSearch,
	rows: OverlayRows | null,
): OverlayResolution {
	// Validated search guarantees one kind or none, with required keys
	// present; the guards below keep the resolver total for hand-built
	// search (tests, optimistic navigation).
	if (search.evidence !== undefined) {
		switch (search.evidence) {
			case "position":
				return ready({ kind: "evidence", target: { kind: "position" } });
			case "shortfall":
				return ready({ kind: "evidence", target: { kind: "failure" } });
			case "safe-spending":
				return ready({
					kind: "evidence",
					target: { kind: "safe-spending" },
				});
		}
	}
	if (search.editor !== undefined) {
		const key = search.id;
		if (!key) return unknown();
		switch (search.editor) {
			case "account": {
				if (key === "new")
					return ready({
						kind: "editor",
						target: { kind: "account", item: null },
					});
				if (!rows) return { state: "pending" };
				if (!rows.accounts) return { state: "pending" };
				const account = findAccount(rows, key);
				return account
					? ready({
							kind: "editor",
							target: { kind: "account", item: account },
						})
					: unknown();
			}
			case "transaction": {
				if (key === "new")
					return ready({
						kind: "editor",
						target: { kind: "transaction", item: null },
					});
				if (!rows) return { state: "pending" };
				if (!rows.transactions) return { state: "pending" };
				const transaction = rows.transactions.find((item) => item.id === key);
				return transaction
					? ready({
							kind: "editor",
							target: { kind: "transaction", item: transaction },
						})
					: unknown();
			}
			case "schedule": {
				if (key !== "new") return unknown();
				return ready({
					kind: "editor",
					target: { kind: "schedule", item: null },
				});
			}
			case "evaluation": {
				if (key === "new")
					return ready({
						kind: "editor",
						target: { kind: "evaluation", item: null },
					});
				if (!rows) return { state: "pending" };
				if (!rows.evaluations) return { state: "pending" };
				const evaluation = rows.evaluations.find((item) => item.id === key);
				return evaluation
					? ready({
							kind: "editor",
							target: { kind: "evaluation", item: evaluation },
						})
					: unknown();
			}
		}
	}
	if (search.detail !== undefined) {
		const tab = search.tab ?? "cycle";
		const editKey = search.editTransaction;
		if (editKey === undefined)
			return ready({ kind: "safeSpendingDetail", tab, edit: null });
		if (editKey === "new")
			return ready({
				kind: "safeSpendingDetail",
				tab,
				edit: { kind: "transaction", item: null },
			});
		if (!rows) return { state: "pending" };
		if (!rows.transactions) return { state: "pending" };
		const transaction = rows.transactions.find((item) => item.id === editKey);
		return transaction
			? ready({
					kind: "safeSpendingDetail",
					tab,
					edit: { kind: "transaction", item: transaction },
				})
			: unknown();
	}
	return { state: "none" };
}

/** Search that opens an evidence dialog. */
export function evidenceSearch(target: EvidenceTarget): WorkspaceSearch {
	switch (target.kind) {
		case "position":
			return { evidence: "position" };
		case "failure":
			return { evidence: "shortfall" };
		case "safe-spending":
			return { evidence: "safe-spending" };
	}
}

/** Search that opens an editor dialog. */
export function editorSearch(target: EditorTarget): WorkspaceSearch {
	switch (target.kind) {
		case "account":
			return { editor: "account", id: target.item?.id ?? "new" };
		case "transaction":
			return { editor: "transaction", id: target.item?.id ?? "new" };
		case "schedule":
			return { editor: "schedule", id: "new" };
		case "evaluation":
			return { editor: "evaluation", id: target.item?.id ?? "new" };
	}
}

/** The owning evidence is part of a shareable editor URL. */
export function editorReturnSearch(
	target: EvidenceTarget | null,
): WorkspaceSearch {
	if (!target) return {};
	const search = evidenceSearch(target);
	return { returnEvidence: search.evidence, returnId: search.id };
}

export function editorReturnTarget(
	search: WorkspaceSearch,
): EvidenceTarget | null {
	switch (search.returnEvidence) {
		case "position":
			return { kind: "position" };
		case "shortfall":
			return { kind: "failure" };
		case "safe-spending":
			return { kind: "safe-spending" };
		default:
			return null;
	}
}

/** Search that opens safe-spending detail, optionally with a stacked editor. */
export function safeSpendingDetailSearch(
	tab: SafeSpendingDetailTab,
	editKey?: string,
): WorkspaceSearch {
	return editKey
		? { detail: "safe-spending", tab, editTransaction: editKey }
		: { detail: "safe-spending", tab };
}
