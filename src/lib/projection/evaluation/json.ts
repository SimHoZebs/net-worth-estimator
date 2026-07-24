import type { JsonValue } from "../types/model";

export function isJsonValue(value: unknown): value is JsonValue {
	return isJsonValueInternal(value, new WeakSet<object>());
}

function isJsonValueInternal(
	value: unknown,
	seen: WeakSet<object>,
): value is JsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return true;
	}
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) {
		if (seen.has(value)) return false;
		seen.add(value);
		const valid = value.every((item) => isJsonValueInternal(item, seen));
		seen.delete(value);
		return valid;
	}
	if (typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	if (seen.has(value)) return false;
	seen.add(value);
	const valid = Object.values(value).every((item) =>
		isJsonValueInternal(item, seen),
	);
	seen.delete(value);
	return valid;
}
