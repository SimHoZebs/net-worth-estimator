/** Single null-means-all resolver: stored `null` means every known id;
 * unknown ids drop out; an empty selection falls back to the full set so a
 * deleted id never silently empties the effective set. Pass `fallback`
 * to override the empty-selection result (e.g. the detected checking
 * account instead of every account). */
export function resolveEffectiveIds(
	stored: string[] | null,
	knownIds: readonly string[],
	fallback?: readonly string[],
): string[] {
	const known = new Set(knownIds);
	const fallbackIds = (fallback ?? knownIds).filter((id) => known.has(id));
	if (!stored) return fallbackIds;
	const selected = stored.filter((id) => known.has(id));
	return selected.length ? selected : fallbackIds;
}

/** One toggle rule for cards, cash accounts, bills and income. When the
 * toggle lands on the automatic selection (or nothing), collapse back to the
 * stored `null` that means all/auto. A strict-subset fallback keeps explicit
 * lists that extend it. */
export function toggleEffectiveId(
	stored: string[] | null,
	knownIds: readonly string[],
	id: string,
	fallback?: readonly string[],
): string[] | null {
	const effective = resolveEffectiveIds(stored, knownIds, fallback);
	const next = effective.includes(id)
		? effective.filter((item) => item !== id)
		: [...effective, id];
	// `null` is the automatic selection. Collapse to it only when the toggle
	// returns to that automatic result, or clears the list. A fallback that is
	// a strict subset (checking account, default cards) must keep an explicit
	// list when the user selects beyond it — `coversAll` alone would silently
	// drop those ids back to the fallback.
	const automatic = resolveEffectiveIds(null, knownIds, fallback);
	const sameAsAutomatic =
		next.length === automatic.length &&
		automatic.every((autoId) => next.includes(autoId));
	return next.length === 0 || sameAsAutomatic ? null : next;
}
