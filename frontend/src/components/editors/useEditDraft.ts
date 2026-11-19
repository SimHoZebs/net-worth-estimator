import { useState } from "react";
import { recurrenceEqual, type Recurrence } from "../../domain/recurrence.ts";

type DraftValue = string | boolean | Recurrence | null;

/** Recurrence compares by value: the source rebuilds it with a fresh
 * object identity on every render, so reference checks mistake a
 * re-render for a concurrent change. */
function fieldEqual(
	left: DraftValue | undefined,
	right: DraftValue | undefined,
): boolean {
	if (left === undefined || right === undefined) return left === right;
	if (
		typeof left === "object" &&
		typeof right === "object" &&
		left !== null &&
		right !== null
	)
		return recurrenceEqual(left, right);
	return left === right;
}

/**
 * Local edits override current values. Only edited fields retain a
 * conflict baseline. Object members such as recurrence compare by
 * value: editors keep the stored reference when nothing changed.
 */
export function useEditDraft<T extends Record<string, DraftValue>>(
	key: string,
	source: T,
) {
	const [edit, setEdit] = useState<{
		key: string;
		base: T;
		patch: Partial<T>;
	} | null>(null);
	const current = edit?.key === key ? edit : null;
	const patch = current?.patch ?? {};
	const value = { ...source, ...patch };
	const keys = Object.keys(patch) as (keyof T)[];
	const dirty = keys.some((field) => !fieldEqual(value[field], source[field]));
	const conflict =
		current !== null &&
		keys.some(
			(field) =>
				!fieldEqual(source[field], current.base[field]) &&
				!fieldEqual(source[field], value[field]),
		);
	return {
		value,
		dirty,
		conflict,
		update: (next: Partial<T>) =>
			setEdit((previous) => {
				const active = previous?.key === key ? previous : null;
				const base = { ...(active?.base ?? source) };
				const patch: Partial<T> = active ? { ...active.patch } : {};
				for (const field of Object.keys(next) as (keyof T)[]) {
					if (!(field in patch)) base[field] = source[field];
					if (fieldEqual(next[field], source[field])) delete patch[field];
					else patch[field] = next[field];
				}
				return { key, base, patch };
			}),
		reset: () => setEdit(null),
	};
}
