const TYPE_KEY = "$projectionArtifactValue";

function taggedValue(type: string, value?: string): string {
	const fields = [`${JSON.stringify(TYPE_KEY)}:${JSON.stringify(type)}`];
	if (value !== undefined) fields.push(`${JSON.stringify("value")}:${value}`);
	return `{${fields.join(",")}}`;
}

function serializeNumber(value: number): string {
	if (Number.isNaN(value)) return taggedValue("number", JSON.stringify("NaN"));
	if (value === Infinity) {
		return taggedValue("number", JSON.stringify("Infinity"));
	}
	if (value === -Infinity) {
		return taggedValue("number", JSON.stringify("-Infinity"));
	}
	if (Object.is(value, -0)) {
		return taggedValue("number", JSON.stringify("-0"));
	}
	return JSON.stringify(value);
}

function serializePlainObject(
	value: Record<string, unknown>,
	ancestors: WeakSet<object>,
): string {
	const symbolKeys = Object.getOwnPropertySymbols(value).filter(
		(key) => Object.getOwnPropertyDescriptor(value, key)?.enumerable,
	);
	if (symbolKeys.length > 0) {
		throw new TypeError(
			"Canonical serialization does not support symbol keys.",
		);
	}

	const body = valueHasReservedKey(value)
		? taggedValue("object", serializeObjectBody(value, ancestors))
		: serializeObjectBody(value, ancestors);
	return body;
}

function valueHasReservedKey(value: Record<string, unknown>): boolean {
	return Object.getOwnPropertyDescriptor(value, TYPE_KEY) !== undefined;
}

function serializeObjectBody(
	value: Record<string, unknown>,
	ancestors: WeakSet<object>,
): string {
	const properties = Object.keys(value)
		.sort()
		.map(
			(key) =>
				`${JSON.stringify(key)}:${serializeValue(value[key], ancestors)}`,
		);
	return `{${properties.join(",")}}`;
}

function serializeArray(value: unknown[], ancestors: WeakSet<object>): string {
	const items: string[] = [];
	for (let index = 0; index < value.length; index += 1) {
		items.push(
			Object.getOwnPropertyDescriptor(value, index) !== undefined
				? serializeValue(value[index], ancestors)
				: taggedValue("array-hole"),
		);
	}
	return `[${items.join(",")}]`;
}

function serializeValue(value: unknown, ancestors: WeakSet<object>): string {
	if (value === undefined) return taggedValue("undefined");
	if (value === null) return "null";

	switch (typeof value) {
		case "string":
		case "boolean":
			return JSON.stringify(value);
		case "number":
			return serializeNumber(value);
		case "bigint":
		case "function":
		case "symbol":
			throw new TypeError(
				`Canonical serialization does not support ${typeof value} values.`,
			);
		case "object": {
			if (ancestors.has(value)) {
				throw new TypeError("Canonical serialization does not support cycles.");
			}
			ancestors.add(value);
			try {
				if (Array.isArray(value)) return serializeArray(value, ancestors);
				const prototype = Object.getPrototypeOf(value);
				if (prototype !== Object.prototype && prototype !== null) {
					throw new TypeError(
						"Canonical serialization supports only plain objects and arrays.",
					);
				}
				return serializePlainObject(
					value as Record<string, unknown>,
					ancestors,
				);
			} finally {
				ancestors.delete(value);
			}
		}
	}

	throw new TypeError("Canonical serialization encountered an unknown value.");
}

/** Produces a deterministic, collision-safe string for supported values. */
export function canonicalSerialize(value: unknown): string {
	return serializeValue(value, new WeakSet<object>());
}
