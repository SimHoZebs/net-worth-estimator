import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { Account, Evaluation, Transaction } from "../domain/model.ts";
import type { EditorTarget } from "../domain/accountEdits.ts";
import {
	SAFE_SPENDING_DETAIL_TABS,
	type SafeSpendingDetailTab,
} from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import { pages, type Page } from "./navigation.ts";

// URL-driven overlays. The pathname carries the page and the search string
// carries at most one overlay: `/accounts` stays the accounts page,
// `/accounts?account=everyday-checking` opens that account's activity,
// `/transactions?edit-transaction=new` opens a blank transaction editor.
// The URL (not component state) is the source of truth, so the back button,
// bookmarks, and direct loads all resolve through the same parser. The hash
// is reserved for in-page anchors (for example the skip link) and never
// carries routing state.

export const SAFE_SPENDING_TABS = SAFE_SPENDING_DETAIL_TABS.map(
	(tab) => tab.id,
);

export type OverlayRoute =
	| { type: "account"; key: string }
	| { type: "accountEdit"; key: string }
	| { type: "transactionEdit"; key: string }
	| { type: "scheduleEdit"; key: string }
	| { type: "evaluationEdit"; key: string }
	| { type: "group"; key: string }
	| { type: "position" }
	| { type: "shortfall" }
	| { type: "safe-spending" }
	| {
			type: "safeSpendingDetail";
			tab: SafeSpendingDetailTab;
			editTransaction?: string;
	  }
	// Well-formed page, unparseable overlay parameters. Resolves to unknown
	// so the URL normalizes back to the page instead of sticking.
	| { type: "invalid" };

export interface WorkspaceRoute {
	page: Page;
	overlay: OverlayRoute | null;
}

// Overlay resolution needs only the saved rows used by its lookups.
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
	  }
	| { kind: "group"; id: string };

export type OverlayResolution =
	| { state: "none" }
	| { state: "pending" }
	| { state: "unknown" }
	| { state: "ready"; overlay: ResolvedOverlay };

export function slugifyAccount(name: string): string {
	const slug = name
		.toLowerCase()
		.trim()
		.replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return slug || "account";
}

/** Exact id first, then a human-readable slug of the name. Archived accounts
 *  stay hidden: linking one resolves to unknown and the URL normalizes. */
export function findAccount(
	rows: Pick<OverlayRows, "accounts">,
	key: string,
): Account | undefined {
	const exact = rows.accounts?.find(
		(account) => !account.archived && account.id === key,
	);
	if (exact) return exact;
	const slug = key.toLowerCase();
	return rows.accounts?.find(
		(account) => !account.archived && slugifyAccount(account.name) === slug,
	);
}

function isSafeSpendingTab(
	value: string | null | undefined,
): value is SafeSpendingDetailTab {
	return SAFE_SPENDING_TABS.some((tab) => tab === value);
}

const ACCOUNT_PAGES: Page[] = ["accounts", "transactions", "outlook"];

// A single overlay parameter value. Each overlay parameter may appear at
// most once; duplicates are invalid rather than silently keeping the first.
function singleParam(
	params: URLSearchParams,
	name: string,
): string | null | undefined {
	const values = params.getAll(name);
	if (values.length === 0) return undefined;
	if (values.length > 1) return null;
	return values[0] ?? null;
}

function parseOverlayParams(
	params: URLSearchParams,
	page: Page,
): OverlayRoute | null {
	const account = singleParam(params, "account");
	const evidence = singleParam(params, "evidence");
	const editAccount = singleParam(params, "edit-account");
	const editTransaction = singleParam(params, "edit-transaction");
	const editSchedule = singleParam(params, "edit-schedule");
	const editEvaluation = singleParam(params, "edit-evaluation");
	const group = singleParam(params, "group");
	const detail = singleParam(params, "detail");
	const present = [
		account,
		evidence,
		editAccount,
		editTransaction,
		editSchedule,
		editEvaluation,
		group,
		detail,
	].filter((value) => value !== undefined);
	// A duplicate or empty value is unparseable. `null` marks a duplicate;
	// an empty string is never a usable key, evidence kind, or tab.
	if (present.some((value) => value === null || value === "")) {
		return { type: "invalid" };
	}
	if (present.length === 0) return null;
	// Safe-spending detail is the only overlay that stacks with another
	// parameter: `detail` plus `edit-transaction` edits a transaction
	// inside the detail. Every other combination claims two overlays.
	if (detail !== undefined && editTransaction !== undefined) {
		const others = present.filter(
			(value) => value !== detail && value !== editTransaction,
		);
		if (others.length > 0) return { type: "invalid" };
		if (!isSafeSpendingTab(detail)) return { type: "invalid" };
		return {
			type: "safeSpendingDetail",
			tab: detail,
			editTransaction: editTransaction ?? "",
		};
	}
	if (present.length > 1) return { type: "invalid" };
	// Exactly one overlay parameter is present.
	if (detail !== undefined) {
		if (!isSafeSpendingTab(detail)) return { type: "invalid" };
		return { type: "safeSpendingDetail", tab: detail };
	}
	if (account !== undefined) {
		if (!ACCOUNT_PAGES.includes(page)) return { type: "invalid" };
		return { type: "account", key: account ?? "" };
	}
	if (evidence !== undefined) {
		switch (evidence) {
			case "position":
				return { type: "position" };
			case "shortfall":
				return { type: "shortfall" };
			case "safe-spending":
				return { type: "safe-spending" };
			default:
				return { type: "invalid" };
		}
	}
	if (editAccount !== undefined)
		return { type: "accountEdit", key: editAccount ?? "" };
	if (editTransaction !== undefined)
		return { type: "transactionEdit", key: editTransaction ?? "" };
	if (editSchedule !== undefined)
		return { type: "scheduleEdit", key: editSchedule ?? "" };
	if (editEvaluation !== undefined)
		return { type: "evaluationEdit", key: editEvaluation ?? "" };
	// Group detail resolves against membership, not financial rows.
	if (group !== undefined) {
		if (page !== "groups") return { type: "invalid" };
		return { type: "group", key: group ?? "" };
	}
	return { type: "invalid" };
}

/** Parse a path-plus-search URL such as `/accounts?account=checking` into
 *  its page and overlay. The root path is the outlook landing page. Unknown
 *  paths fall back to outlook with an invalid overlay so the URL normalizes. */
export function parseUrl(url: string): WorkspaceRoute {
	const queryIndex = url.indexOf("?");
	const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
	const search = queryIndex === -1 ? "" : url.slice(queryIndex + 1);
	const segments: string[] = [];
	for (const part of pathname.split("/")) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(part);
		} catch {
			return { page: "outlook", overlay: { type: "invalid" } };
		}
		if (decoded.length) segments.push(decoded);
	}
	if (segments.length === 0) {
		// The root path is the outlook landing page.
		return {
			page: "outlook",
			overlay: parseOverlayParams(new URLSearchParams(search), "outlook"),
		};
	}
	if (segments.length > 1)
		return { page: "outlook", overlay: { type: "invalid" } };
	const [head] = segments as [string];
	const page: Page | null = pages.some((item) => item.id === head)
		? (head as Page)
		: null;
	if (!page) return { page: "outlook", overlay: { type: "invalid" } };
	return {
		page,
		overlay: parseOverlayParams(new URLSearchParams(search), page),
	};
}

function unknown(): OverlayResolution {
	return { state: "unknown" };
}

function ready(overlay: ResolvedOverlay): OverlayResolution {
	return { state: "ready", overlay };
}

export function resolveOverlayRoute(
	route: WorkspaceRoute,
	rows: OverlayRows | null,
): OverlayResolution {
	const overlay = route.overlay;
	if (!overlay) return { state: "none" };
	if (overlay.type === "invalid") return unknown();
	// Group detail resolves against membership, not financial rows.
	if (overlay.type === "group")
		return ready({ kind: "group", id: overlay.key });
	// Keep unresolved URLs until their saved rows arrive.
	if (!rows) return { state: "pending" };
	switch (overlay.type) {
		case "position":
			return ready({ kind: "evidence", target: { kind: "position" } });
		case "shortfall":
			return ready({ kind: "evidence", target: { kind: "failure" } });
		case "safe-spending":
			return ready({ kind: "evidence", target: { kind: "safe-spending" } });
		case "account": {
			if (!rows.accounts) return { state: "pending" };
			const account = findAccount(rows, overlay.key);
			return account
				? ready({
						kind: "evidence",
						target: { kind: "account", id: account.id },
					})
				: unknown();
		}
		case "accountEdit": {
			if (!rows.accounts) return { state: "pending" };
			if (overlay.key === "new")
				return ready({
					kind: "editor",
					target: { kind: "account", item: null },
				});
			const account = findAccount(rows, overlay.key);
			return account
				? ready({ kind: "editor", target: { kind: "account", item: account } })
				: unknown();
		}
		case "transactionEdit": {
			if (overlay.key === "new")
				return ready({
					kind: "editor",
					target: { kind: "transaction", item: null },
				});
			if (!rows.transactions) return { state: "pending" };
			const transaction = rows.transactions.find(
				(item) => item.id === overlay.key,
			);
			return transaction
				? ready({
						kind: "editor",
						target: { kind: "transaction", item: transaction },
					})
				: unknown();
		}
		case "scheduleEdit": {
			if (overlay.key === "new")
				return ready({
					kind: "editor",
					target: { kind: "schedule", item: null },
				});
			return unknown();
		}
		case "evaluationEdit": {
			if (overlay.key === "new")
				return ready({
					kind: "editor",
					target: { kind: "evaluation", item: null },
				});
			if (!rows.evaluations) return { state: "pending" };
			const evaluation = rows.evaluations.find(
				(item) => item.id === overlay.key,
			);
			return evaluation
				? ready({
						kind: "editor",
						target: { kind: "evaluation", item: evaluation },
					})
				: unknown();
		}
		case "safeSpendingDetail": {
			if (overlay.editTransaction === undefined)
				return ready({
					kind: "safeSpendingDetail",
					tab: overlay.tab,
					edit: null,
				});
			if (overlay.editTransaction === "new")
				return ready({
					kind: "safeSpendingDetail",
					tab: overlay.tab,
					edit: { kind: "transaction", item: null },
				});
			if (!rows.transactions) return { state: "pending" };
			const transaction = rows.transactions.find(
				(item) => item.id === overlay.editTransaction,
			);
			return transaction
				? ready({
						kind: "safeSpendingDetail",
						tab: overlay.tab,
						edit: { kind: "transaction", item: transaction },
					})
				: unknown();
		}
	}
}

export function pageUrl(page: Page): string {
	return `/${page}`;
}

export function groupUrl(id: string): string {
	return `/groups?group=${encodeURIComponent(id)}`;
}

const encode = (value: string): string => encodeURIComponent(value);

export function evidenceUrl(
	page: Page,
	target: EvidenceTarget,
	rows: Pick<OverlayRows, "accounts"> | null,
): string {
	switch (target.kind) {
		case "position":
			return `/${page}?evidence=position`;
		case "failure":
			return `/${page}?evidence=shortfall`;
		case "safe-spending":
			return `/${page}?evidence=safe-spending`;
		case "account": {
			const account = rows ? findAccount(rows, target.id) : undefined;
			const key = account ? slugifyAccount(account.name) : target.id;
			return `/${page}?account=${encode(key)}`;
		}
	}
}

export function editorUrl(page: Page, target: EditorTarget): string {
	switch (target.kind) {
		case "account": {
			if (!target.item) return `/${page}?edit-account=new`;
			return `/${page}?edit-account=${encode(slugifyAccount(target.item.name))}`;
		}
		case "transaction":
			if (!target.item) return `/${page}?edit-transaction=new`;
			return `/${page}?edit-transaction=${encode(target.item.id)}`;
		case "schedule":
			return `/${page}?edit-schedule=new`;
		case "evaluation":
			if (!target.item) return `/${page}?edit-evaluation=new`;
			return `/${page}?edit-evaluation=${encode(target.item.id)}`;
	}
}

export function safeSpendingDetailUrl(
	page: Page,
	tab: SafeSpendingDetailTab,
	editKey?: string,
): string {
	const base = `/${page}?detail=${tab}`;
	return editKey ? `${base}&edit-transaction=${encode(editKey)}` : base;
}
