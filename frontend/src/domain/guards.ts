export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finite(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.length ? value : null;
}

export function parseUnion<T extends string>(
	value: unknown,
	options: readonly T[],
): T | null {
	return typeof value === "string" &&
		(options as readonly string[]).includes(value)
		? (value as T)
		: null;
}
