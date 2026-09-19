import { parseDecimalDraft } from "@/lib/number-draft";

export function parseDecimalField(
	raw: string,
	label: string,
	errors: string[],
): number {
	const parsed = parseDecimalDraft(raw);
	if (parsed === null) {
		errors.push(`${label} must be a valid number.`);
		return 0;
	}
	return parsed;
}

export function duplicateIdError(
	id: string,
	kind: "Account" | "Posting",
	reservedIds: readonly string[],
	existingIds: readonly string[],
): string | null {
	const trimmed = id.trim();
	if (!trimmed) return null;
	if (reservedIds.includes(trimmed) || existingIds.includes(trimmed)) {
		return `${kind} ID "${trimmed}" is already in use.`;
	}
	return null;
}

interface RouteEndpoint {
	sourceAccountId?: string | null;
	destinations?: string[] | null;
}

interface LabeledAccount {
	id: string;
	label: string;
}

export function describePostingRoute(
	posting: RouteEndpoint,
	accounts: readonly LabeledAccount[],
	separator = " \u2192 ",
): string {
	const byId = new Map(accounts.map((a) => [a.id, a]));
	const src = posting.sourceAccountId
		? (byId.get(posting.sourceAccountId)?.label ?? posting.sourceAccountId)
		: "External";
	const dst =
		posting.destinations == null
			? "External"
			: posting.destinations.map((d) => byId.get(d)?.label ?? d).join(" ; ");
	return `${src}${separator}${dst}`;
}
