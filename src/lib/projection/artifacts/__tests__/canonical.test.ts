import { describe, expect, it } from "vitest";
import { canonicalSerialize } from "../canonical";

describe("canonicalSerialize", () => {
	it("sorts plain-object keys recursively while preserving array order", () => {
		expect(
			canonicalSerialize({ z: 1, nested: { b: 2, a: 1 }, values: [3, 1, 2] }),
		).toBe('{"nested":{"a":1,"b":2},"values":[3,1,2],"z":1}');
		expect(canonicalSerialize({ a: 1, b: 2 })).toBe(
			canonicalSerialize({ b: 2, a: 1 }),
		);
	});

	it("distinguishes undefined and every non-JSON numeric value", () => {
		const values = [undefined, Number.NaN, Infinity, -Infinity, -0, null, 0];
		const serialized = values.map(canonicalSerialize);

		expect(new Set(serialized)).toHaveProperty("size", values.length);
		expect(canonicalSerialize([undefined])).not.toBe(
			canonicalSerialize([null]),
		);
	});

	it("escapes plain objects that use the reserved type key", () => {
		const object = { $projectionArtifactValue: "undefined" };
		expect(canonicalSerialize(object)).not.toBe(canonicalSerialize(undefined));
	});

	it("rejects unsupported objects and cycles", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;

		expect(() => canonicalSerialize(new Date())).toThrow("plain objects");
		expect(() => canonicalSerialize(cyclic)).toThrow("cycles");
	});
});
