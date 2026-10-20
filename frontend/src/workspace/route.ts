import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { Account, Evaluation, Movement } from "../domain/model.ts";
import type { EditorTarget } from "../domain/planEdits.ts";
import type { SafeSpendingDetailTab } from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import { pages, type Page } from "./navigation.ts";

// URL-driven overlays. The hash carries the page plus at most one overlay:
// `#accounts` stays the accounts page, `#accounts/everyday-checking` opens
// that account's activity, `#transactions/new` opens a blank movement editor.
// The hash (not component state) is the source of truth, so the back button,
// bookmarks, and direct loads all resolve through the same parser. Page-only
// hashes are unchanged: every overlay form appends segments to them.

export const SAFE_SPENDING_TABS: readonly SafeSpendingDetailTab[] = [
	"mandatory",
	"cycle",
	"configure",
];

export type OverlayRoute =
	| { type: "account"; key: string }
	| { type: "accountEdit"; key: string }
	| { type: "movementEdit"; key: string }
	| { type: "evaluation"; key: string }
	| { type: "evaluationEdit"; key: string }
	// Single-segment outlook reference: an evaluation id wins, otherwise an
	// account id-or-slug. Only produced by hand-typed URLs; serializers emit
	// the explicit two-segment forms below.
	| { type: "outlookItem"; key: string }
	| { type: "position" }
	| { type: "shortfall" }
	| { type: "safe-spending" }
	| {
			type: "safeSpendingDetail";
			tab: SafeSpendingDetailTab;
			editMovement?: string;
	  }
	| { type: "discard" }
	// Well-formed page, unparseable overlay segments. Resolves to unknown so
	// the URL normalizes back to the page instead of sticking.
	| { type: "invalid" };

export interface WorkspaceRoute {
	page: Page;
	overlay: OverlayRoute | null;
}

// Only the id and name lookups below touch the plan, so tests and resolvers
// depend on this narrow view rather than the full document shape.
export type PlanLike = {
	accounts: Account[];
	movements: Movement[];
	evaluations: Evaluation[];
};

export type ResolvedOverlay =
	| { kind: "evidence"; target: EvidenceTarget }
	| { kind: "editor"; target: EditorTarget }
	| {
			kind: "safeSpendingDetail";
			tab: SafeSpendingDetailTab;
			edit: EditorTarget | null;
	  }
	| { kind: "discard" };

export type OverlayResolution =
	| { state: "none" }
	| { state: "pending" }
	| { state: "unknown" }
	| { state: "ready"; overlay: ResolvedOverlay };

const LEGACY_PAGES: Record<string, Page> = {
	plan: "accounts",
	goals: "evaluations",
};

// Single-segment overlay words, so an account literally named "New" still
// deep-links (serializers fall back to the explicit `account/<id>` form).
const RESERVED_SLUGS = new Set([
	"new",
	"edit",
	"discard",
	"position",
	"shortfall",
	"safe-spending",
	"safe-spending-detail",
	"account",
	"evaluation",
	"evaluations",
	"edit-account",
	"edit-movement",
	"edit-evaluation",
]);

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
export function findAccount(plan: PlanLike, key: string): Account | undefined {
	const exact = plan.accounts.find(
		(account) => !account.archived && account.id === key,
	);
	if (exact) return exact;
	const slug = key.toLowerCase();
	return plan.accounts.find(
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

function homeEditor(page: Page): OverlayRoute | { type: "invalid" } {
	switch (page) {
		case "accounts":
			return { type: "accountEdit", key: "new" };
		case "transactions":
			return { type: "movementEdit", key: "new" };
		case "evaluations":
			return { type: "evaluationEdit", key: "new" };
		default:
			return { type: "invalid" };
	}
}

function scopedEditor(page: Page, key: string): OverlayRoute | null {
	switch (page) {
		case "accounts":
			return { type: "accountEdit", key };
		case "transactions":
			return { type: "movementEdit", key };
		case "evaluations":
			return { type: "evaluationEdit", key };
		default:
			return null;
	}
}

function parseSafeSpendingDetail(parts: string[]): OverlayRoute {
	const [tabOrEdit, maybeEdit, key, ...extra] = parts;
	if (extra.length > 0) return { type: "invalid" };
	if (tabOrEdit === "edit-movement") {
		// `#outlook/safe-spending-detail/edit-movement/<id>`
		return maybeEdit
			? {
					type: "safeSpendingDetail",
					tab: "mandatory",
					editMovement: maybeEdit,
				}
			: { type: "invalid" };
	}
	if (!isSafeSpendingTab(tabOrEdit)) return { type: "invalid" };
	if (maybeEdit === undefined)
		return { type: "safeSpendingDetail", tab: tabOrEdit };
	// `#outlook/safe-spending-detail/<tab>/edit-movement/<id>`
	return maybeEdit === "edit-movement" && key
		? { type: "safeSpendingDetail", tab: tabOrEdit, editMovement: key }
		: { type: "invalid" };
}

function isSafeSpendingTab(
	value: string | undefined,
): value is SafeSpendingDetailTab {
	return value === "mandatory" || value === "cycle" || value === "configure";
}

function parseOverlaySegments(rest: string[], page: Page): OverlayRoute | null {
	if (rest.length === 0) return null;
	const [first, second] = rest;
	// Length is checked, so the head always exists; this only satisfies the
	// type checker for indexed access.
	if (first === undefined) return null;
	if (first === "safe-spending-detail") {
		if (rest.length > 4) return { type: "invalid" };
		if (second === undefined)
			return { type: "safeSpendingDetail", tab: "mandatory" };
		return parseSafeSpendingDetail(rest.slice(1));
	}
	if (rest.length > 2) return { type: "invalid" };
	if (rest.length === 1) {
		switch (first) {
			case "discard":
				return { type: "discard" };
			case "position":
				return { type: "position" };
			case "shortfall":
				return { type: "shortfall" };
			case "safe-spending":
				return { type: "safe-spending" };
			case "safe-spending-detail":
				return { type: "safeSpendingDetail", tab: "mandatory" };
			case "new":
				return homeEditor(page);
			default:
				switch (page) {
					case "accounts":
					case "transactions":
						return { type: "account", key: first };
					case "evaluations":
						return { type: "evaluation", key: first };
					case "outlook":
						return { type: "outlookItem", key: first };
					default:
						return { type: "invalid" };
				}
		}
	}
	switch (first) {
		case "edit-account":
			return { type: "accountEdit", key: second ?? "" };
		case "edit-movement":
			return { type: "movementEdit", key: second ?? "" };
		case "edit-evaluation":
			return { type: "evaluationEdit", key: second ?? "" };
		case "account":
			return { type: "account", key: second ?? "" };
		case "evaluation":
			return { type: "evaluation", key: second ?? "" };
		default:
			if (second === "edit") {
				// `new` stays reserved for creation: an account literally
				// named "New" deep-links through the explicit
				// `edit-account/<id>` form instead.
				if (first === "new") return { type: "invalid" };
				return scopedEditor(page, first) ?? { type: "invalid" };
			}
			return { type: "invalid" };
	}
}

export function parseHash(hash: string): WorkspaceRoute {
	const withoutMark = hash.startsWith("#") ? hash.slice(1) : hash;
	const body = withoutMark.startsWith("/") ? withoutMark.slice(1) : withoutMark;
	if (!body) return { page: "outlook", overlay: null };
	const segments: string[] = [];
	for (const part of body.split("/")) {
		const decoded = decodeSegment(part);
		if (decoded === null)
			return { page: "outlook", overlay: { type: "invalid" } };
		if (decoded.length) segments.push(decoded);
	}
	if (!segments.length) return { page: "outlook", overlay: null };
	const [head, ...rest] = segments as [string, ...string[]];
	const page: Page | null = pages.some((item) => item.id === head)
		? (head as Page)
		: (LEGACY_PAGES[head] ?? null);
	if (!page) return { page: "outlook", overlay: { type: "invalid" } };
	return { page, overlay: parseOverlaySegments(rest, page) };
}

function unknown(): OverlayResolution {
	return { state: "unknown" };
}

function ready(overlay: ResolvedOverlay): OverlayResolution {
	return { state: "ready", overlay };
}

export function resolveOverlayRoute(
	route: WorkspaceRoute,
	plan: PlanLike | null,
): OverlayResolution {
	const overlay = route.overlay;
	if (!overlay) return { state: "none" };
	if (overlay.type === "invalid") return unknown();
	// Data not fetched yet: keep the URL and render nothing until the plan
	// arrives, then resolve or normalize.
	if (!plan) return { state: "pending" };
	switch (overlay.type) {
		case "position":
			return ready({ kind: "evidence", target: { kind: "position" } });
		case "shortfall":
			return ready({ kind: "evidence", target: { kind: "failure" } });
		case "safe-spending":
			return ready({ kind: "evidence", target: { kind: "safe-spending" } });
		case "discard":
			return ready({ kind: "discard" });
		case "account": {
			const account = findAccount(plan, overlay.key);
			return account
				? ready({
						kind: "evidence",
						target: { kind: "account", id: account.id },
					})
				: unknown();
		}
		case "accountEdit": {
			if (overlay.key === "new")
				return ready({
					kind: "editor",
					target: { kind: "account", item: null },
				});
			const account = findAccount(plan, overlay.key);
			return account
				? ready({ kind: "editor", target: { kind: "account", item: account } })
				: unknown();
		}
		case "movementEdit": {
			if (overlay.key === "new")
				return ready({
					kind: "editor",
					target: { kind: "movement", item: null },
				});
			const movement = plan.movements.find((item) => item.id === overlay.key);
			return movement
				? ready({
						kind: "editor",
						target: { kind: "movement", item: movement },
					})
				: unknown();
		}
		case "evaluation": {
			const evaluation = plan.evaluations.find(
				(item) => item.id === overlay.key,
			);
			return evaluation
				? ready({
						kind: "evidence",
						target: { kind: "evaluation", id: evaluation.id },
					})
				: unknown();
		}
		case "evaluationEdit": {
			if (overlay.key === "new")
				return ready({
					kind: "editor",
					target: { kind: "evaluation", item: null },
				});
			const evaluation = plan.evaluations.find(
				(item) => item.id === overlay.key,
			);
			return evaluation
				? ready({
						kind: "editor",
						target: { kind: "evaluation", item: evaluation },
					})
				: unknown();
		}
		case "outlookItem": {
			const evaluation = plan.evaluations.find(
				(item) => item.id === overlay.key,
			);
			if (evaluation)
				return ready({
					kind: "evidence",
					target: { kind: "evaluation", id: evaluation.id },
				});
			const account = findAccount(plan, overlay.key);
			return account
				? ready({
						kind: "evidence",
						target: { kind: "account", id: account.id },
					})
				: unknown();
		}
		case "safeSpendingDetail": {
			if (overlay.editMovement === undefined)
				return ready({
					kind: "safeSpendingDetail",
					tab: overlay.tab,
					edit: null,
				});
			if (overlay.editMovement === "new")
				return ready({
					kind: "safeSpendingDetail",
					tab: overlay.tab,
					edit: { kind: "movement", item: null },
				});
			const movement = plan.movements.find(
				(item) => item.id === overlay.editMovement,
			);
			return movement
				? ready({
						kind: "safeSpendingDetail",
						tab: overlay.tab,
						edit: { kind: "movement", item: movement },
					})
				: unknown();
		}
	}
}

export function pageHash(page: Page): string {
	return `#${page}`;
}

const encode = (value: string): string => encodeURIComponent(value);

function accountSlug(account: Account): string | null {
	const slug = slugifyAccount(account.name);
	return RESERVED_SLUGS.has(slug) ? null : slug;
}

export function evidenceHash(
	page: Page,
	target: EvidenceTarget,
	plan: PlanLike | null,
): string {
	switch (target.kind) {
		case "position":
			return `#${page}/position`;
		case "failure":
			return `#${page}/shortfall`;
		case "safe-spending":
			return `#${page}/safe-spending`;
		case "account": {
			const account = plan ? findAccount(plan, target.id) : undefined;
			const slug = account ? accountSlug(account) : null;
			if ((page === "accounts" || page === "transactions") && slug)
				return `#${page}/${encode(slug)}`;
			return `#${page}/account/${encode(slug ?? target.id)}`;
		}
		case "evaluation":
			return page === "evaluations"
				? `#${page}/${encode(target.id)}`
				: `#${page}/evaluation/${encode(target.id)}`;
	}
}

export function editorHash(page: Page, target: EditorTarget): string {
	switch (target.kind) {
		case "account": {
			if (!target.item)
				return page === "accounts"
					? `#${page}/new`
					: `#${page}/edit-account/new`;
			const slug = accountSlug(target.item);
			return page === "accounts" && slug
				? `#${page}/${encode(slug)}/edit`
				: `#${page}/edit-account/${encode(slug ?? target.item.id)}`;
		}
		case "movement":
			if (!target.item)
				return page === "transactions"
					? `#${page}/new`
					: `#${page}/edit-movement/new`;
			return page === "transactions"
				? `#${page}/${encode(target.item.id)}/edit`
				: `#${page}/edit-movement/${encode(target.item.id)}`;
		case "evaluation":
			if (!target.item)
				return page === "evaluations"
					? `#${page}/new`
					: `#${page}/edit-evaluation/new`;
			return page === "evaluations"
				? `#${page}/${encode(target.item.id)}/edit`
				: `#${page}/edit-evaluation/${encode(target.item.id)}`;
	}
}

export function safeSpendingDetailHash(
	page: Page,
	tab: SafeSpendingDetailTab,
	editKey?: string,
): string {
	const base = `#${page}/safe-spending-detail/${tab}`;
	return editKey ? `${base}/edit-movement/${encode(editKey)}` : base;
}

export function discardHash(page: Page): string {
	return `#${page}/discard`;
}
