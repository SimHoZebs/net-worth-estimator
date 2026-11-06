import { z } from "zod";
import {
	SAFE_SPENDING_DETAIL_TABS,
	type SafeSpendingDetailTab,
} from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";

// Every page shares one overlay search shape: the pathname names the page
// (`/accounts`) and dialogs live in query params instead of pseudo nested
// paths (`?evidence=account&id=…`). Group detail is the one path segment
// (`/groups/<id>`). The `gmail` flag is the post-OAuth callback outcome: it
// rides along on every navigation until the Gmail panel consumes it, so it
// is validated here and retained by Router search middleware.

const evidenceKind = z.enum([
	"position",
	"shortfall",
	"safe-spending",
	"account",
]);
const editorKind = z.enum(["account", "transaction", "schedule", "evaluation"]);
const safeSpendingDetailKind = z.enum(["safe-spending"]);
const safeSpendingTab = z
	.string()
	.refine((value): value is SafeSpendingDetailTab =>
		SAFE_SPENDING_DETAIL_TABS.some((tab) => tab.id === value),
	);
const gmailOutcome = z.enum(["connected", "error"]);

export const workspaceSearchSchema = z.object({
	evidence: evidenceKind.optional(),
	editor: editorKind.optional(),
	detail: safeSpendingDetailKind.optional(),
	id: z.string().optional(),
	tab: safeSpendingTab.optional(),
	editTransaction: z.string().optional(),
	gmail: gmailOutcome.optional(),
});

export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>;

// Overlay parameters are strings, including numeric or boolean-like account
// slugs. Preserve duplicates as arrays so validation rejects ambiguity instead
// of selecting one value. TanStack's default parser coerces primitives.
export function parseWorkspaceSearch(
	queryString: string,
): Record<string, unknown> {
	const result: Record<string, unknown> = Object.create(null);
	for (const [key, value] of new URLSearchParams(queryString)) {
		const previous = result[key];
		if (previous === undefined) result[key] = value;
		else if (Array.isArray(previous)) previous.push(value);
		else result[key] = [previous, value];
	}
	return result;
}

/**
 * Validate route search into a trustworthy shape. TanStack Router merges the
 * return value over the raw search: a key the return omits survives. So the
 * result mentions every overlay key explicitly — a value or `undefined` — and
 * any shape the parsers reject (mutually exclusive kinds, a missing `id`, a
 * lone `id`/`tab`/`editTransaction`, a bad enum, a duplicate param parsed as
 * an array) normalizes to no overlay while the Gmail flag survives.
 */
export function validateWorkspaceSearch(
	search: Record<string, unknown>,
): WorkspaceSearch {
	const parsed = workspaceSearchSchema.safeParse(search);
	if (!parsed.success) {
		const gmail = safeGmail(search);
		return GmailOnly(gmail);
	}
	const value = parsed.data;
	return isConsistent(value)
		? {
				evidence: value.evidence,
				editor: value.editor,
				detail: value.detail,
				id: value.id,
				tab: value.tab,
				editTransaction: value.editTransaction,
				gmail: value.gmail,
			}
		: GmailOnly(value.gmail);
}

function safeGmail(search: Record<string, unknown>): WorkspaceSearch["gmail"] {
	return search.gmail === "connected" || search.gmail === "error"
		? search.gmail
		: undefined;
}

function GmailOnly(gmail: WorkspaceSearch["gmail"]): WorkspaceSearch {
	return {
		evidence: undefined,
		editor: undefined,
		detail: undefined,
		id: undefined,
		tab: undefined,
		editTransaction: undefined,
		gmail,
	};
}

// Each overlay kind may carry the params; exactly one kind or none is valid,
// and kind-specific params never stand alone.
function isConsistent(value: Exclude<WorkspaceSearch, undefined>): boolean {
	const kinds = [value.evidence, value.editor, value.detail].filter(
		(kind) => kind !== undefined,
	);
	if (kinds.length > 1) return false;
	if (value.evidence === "account" && value.id === undefined) return false;
	if (value.editor !== undefined && value.id === undefined) return false;
	if (
		kinds.length === 0 &&
		(value.id !== undefined ||
			value.tab !== undefined ||
			value.editTransaction !== undefined)
	)
		return false;
	return true;
}
