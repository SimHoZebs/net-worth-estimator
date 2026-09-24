import { useMemo, useState } from "react";

export const NO_CHANGED_IDS: ReadonlySet<string> = new Set<string>();

export function duplicateIds(ids: readonly string[]): Set<string> {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) duplicates.add(id);
		seen.add(id);
	}
	return duplicates;
}

export function findChangedIds<T extends { id: string }>(
	originalById: ReadonlyMap<string, T>,
	workingRows: readonly T[] | null | undefined,
	isDirty: boolean,
): Set<string> {
	if (!isDirty || workingRows == null) return NO_CHANGED_IDS as Set<string>;
	const changed = new Set<string>();
	for (const row of workingRows) {
		const original = originalById.get(row.id);
		if (
			original === undefined ||
			JSON.stringify(row) !== JSON.stringify(original)
		) {
			changed.add(row.id);
		}
	}
	return changed;
}

export function useChangedIds<T extends { id: string }>(
	originalById: ReadonlyMap<string, T>,
	workingRows: readonly T[] | null | undefined,
	isDirty: boolean,
): Set<string> {
	return useMemo(
		() => findChangedIds(originalById, workingRows, isDirty),
		[originalById, workingRows, isDirty],
	);
}

export function useRowById<T extends { id: string }>(
	rows: readonly T[] | null | undefined,
): ReadonlyMap<string, T> {
	return useMemo(
		() => new Map((rows ?? []).map((row) => [row.id, row] as const)),
		[rows],
	);
}

export function useTableSearch(initial = "") {
	const [search, setSearch] = useState(initial);
	const query = useMemo(() => search.trim().toLowerCase(), [search]);
	return { search, setSearch, query };
}

export function SearchFooter({
	count,
	singular,
	plural,
}: {
	count: number;
	singular: string;
	plural: string;
}) {
	return (
		<div className="type-caption" aria-live="polite">
			{count} {count === 1 ? singular : plural}
		</div>
	);
}

/**
 * Readable auto-ID for newly added rows ("new-account", "new-account-2", …)
 * instead of cryptic timestamp IDs. Suffixes only when the base is taken.
 */
export function nextReadableId(
	prefix: string,
	existingIds: ReadonlySet<string> | readonly string[],
): string {
	const existing =
		existingIds instanceof Set ? existingIds : new Set(existingIds);
	if (!existing.has(prefix)) return prefix;
	let counter = 2;
	while (existing.has(`${prefix}-${counter}`)) counter += 1;
	return `${prefix}-${counter}`;
}
