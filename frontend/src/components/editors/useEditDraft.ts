import { useState } from "react";

/** Local edits override current values. Only edited fields retain a conflict baseline. */
export function useEditDraft<T extends Record<string, string | boolean>>(
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
	const dirty = keys.some((field) => value[field] !== source[field]);
	const conflict =
		current !== null &&
		keys.some(
			(field) =>
				source[field] !== current.base[field] && source[field] !== value[field],
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
					if (next[field] === source[field]) delete patch[field];
					else patch[field] = next[field];
				}
				return { key, base, patch };
			}),
		reset: () => setEdit(null),
	};
}
