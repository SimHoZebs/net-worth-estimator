import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { Account, Evaluation, Transaction } from "../domain/model.ts";
import type { EditorTarget } from "../domain/accountEdits.ts";
import {
	SAFE_SPENDING_DETAIL_TABS,
	type SafeSpendingDetailTab,
} from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import { pages, type Page } from "./navigation.ts";

// URL-driven overlays. The pathname carries the page: `/accounts` is the
// accounts page and `/groups/<id>` opens that group. In-page dialogs live
// in query params instead of pseudo nested paths: `?evidence=account&id=…`
// opens that account's activity and `?editor=transaction&id=new` opens a
// blank transaction editor. The URL (not component state) is the source of
// truth, so the back button, bookmarks, and direct loads all resolve
// through the same parser.

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
	// Well-formed page, unparseable overlay params. Resolves to unknown so
	// the URL normalizes back to the page instead of sticking.
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

// The only slug that collides in query form: `id=new` means the new-item
// editor, so an account literally named "New" deep-links by exact id
// instead (serializers fall back to the id form).
const RESERVED_SLUGS = new Set(["new"]);

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

function decodeSegment(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

function isSafeSpendingTab(
	value: string | undefined,
): value is SafeSpendingDetailTab {
	return SAFE_SPENDING_TABS.some((tab) => tab === value);
}

function invalidOverlay(): OverlayRoute {
	return { type: "invalid" };
}

function parseOverlayQuery(params: URLSearchParams): OverlayRoute | null {
	const evidence = params.get("evidence");
	const editor = params.get("editor");
	const detail = params.get("detail");
	const kinds = [evidence, editor, detail].filter((value) => value !== null);
	if (kinds.length > 1) return invalidOverlay();
	if (evidence !== null) {
		switch (evidence) {
			case "position":
				return { type: "position" };
			case "shortfall":
				return { type: "shortfall" };
			case "safe-spending":
				return { type: "safe-spending" };
			case "account": {
				const key = params.get("id");
				return key ? { type: "account", key } : invalidOverlay();
			}
			default:
				return invalidOverlay();
		}
	}
	if (editor !== null) {
		const key = params.get("id");
		if (!key) return invalidOverlay();
		switch (editor) {
			case "account":
				return { type: "accountEdit", key };
			case "transaction":
				return { type: "transactionEdit", key };
			case "schedule":
				return { type: "scheduleEdit", key };
			case "evaluation":
				return { type: "evaluationEdit", key };
			default:
				return invalidOverlay();
		}
	}
	if (detail !== null) {
		if (detail !== "safe-spending") return invalidOverlay();
		const requestedTab = params.get("tab") ?? "cycle";
		if (!isSafeSpendingTab(requestedTab)) return invalidOverlay();
		const editTransaction = params.get("editTransaction");
		return editTransaction
			? { type: "safeSpendingDetail", tab: requestedTab, editTransaction }
			: { type: "safeSpendingDetail", tab: requestedTab };
	}
	// A lone id, tab, or stacked-editor param has no overlay to belong to.
	if (params.has("id") || params.has("tab") || params.has("editTransaction")) {
		return invalidOverlay();
	}
	return null;
}

export function parseRoute(url: string): WorkspaceRoute {
	const question = url.indexOf("?");
	const pathname = question === -1 ? url : url.slice(0, question);
	const search = question === -1 ? "" : url.slice(question + 1);
	const segments: string[] = [];
	for (const part of pathname.split("/")) {
		const decoded = decodeSegment(part);
		if (decoded === null) return { page: "outlook", overlay: invalidOverlay() };
		if (decoded.length) segments.push(decoded);
	}
	if (!segments.length) return { page: "outlook", overlay: null };
	const [head, sub, ...extra] = segments as [string, ...string[]];
	const page: Page | null = pages.some((item) => item.id === head)
		? (head as Page)
		: null;
	if (!page) return { page: "outlook", overlay: invalidOverlay() };
	const params = new URLSearchParams(search);
	const queryOverlay = parseOverlayQuery(params);
	// Group detail is a path segment, not a query overlay. Any query
	// overlay alongside it is malformed.
	if (page === "groups" && sub !== undefined) {
		if (extra.length > 0 || queryOverlay !== null) {
			return { page, overlay: invalidOverlay() };
		}
		return { page, overlay: { type: "group", key: sub } };
	}
	if (sub !== undefined) return { page, overlay: invalidOverlay() };
	return { page, overlay: queryOverlay };
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

export function pagePath(page: Page): string {
	return `/${page}`;
}

export function groupPath(id: string): string {
	return `/groups/${encodeURIComponent(id)}`;
}

function withParams(base: string, params: Record<string, string>): string {
	const query = new URLSearchParams(params).toString();
	return query ? `${base}?${query}` : base;
}

function accountSlug(account: Account): string | null {
	const slug = slugifyAccount(account.name);
	return RESERVED_SLUGS.has(slug) ? null : slug;
}

export function evidencePath(
	page: Page,
	target: EvidenceTarget,
	rows: Pick<OverlayRows, "accounts"> | null,
): string {
	const base = pagePath(page);
	switch (target.kind) {
		case "position":
			return withParams(base, { evidence: "position" });
		case "failure":
			return withParams(base, { evidence: "shortfall" });
		case "safe-spending":
			return withParams(base, { evidence: "safe-spending" });
		case "account": {
			const account = rows ? findAccount(rows, target.id) : undefined;
			const key = account ? (accountSlug(account) ?? account.id) : target.id;
			return withParams(base, { evidence: "account", id: key });
		}
	}
}

export function editorPath(page: Page, target: EditorTarget): string {
	const base = pagePath(page);
	switch (target.kind) {
		case "account": {
			const key = target.item
				? (accountSlug(target.item) ?? target.item.id)
				: "new";
			return withParams(base, { editor: "account", id: key });
		}
		case "transaction":
			return withParams(base, {
				editor: "transaction",
				id: target.item?.id ?? "new",
			});
		case "schedule":
			return withParams(base, { editor: "schedule", id: "new" });
		case "evaluation":
			return withParams(base, {
				editor: "evaluation",
				id: target.item?.id ?? "new",
			});
	}
}

export function safeSpendingDetailPath(
	page: Page,
	tab: SafeSpendingDetailTab,
	editKey?: string,
): string {
	const params: Record<string, string> = {
		detail: "safe-spending",
		tab,
	};
	if (editKey) params.editTransaction = editKey;
	return withParams(pagePath(page), params);
}
