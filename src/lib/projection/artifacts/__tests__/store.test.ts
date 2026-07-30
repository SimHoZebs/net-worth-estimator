import { describe, expect, it } from "vitest";
import {
	isProjectionArtifactEnvelope,
	type ProjectionArtifactEnvelope,
} from "../envelope";
import { InMemoryProjectionArtifactStore } from "../inMemoryStore";

function envelope(payload: {
	values: number[];
}): ProjectionArtifactEnvelope<{ values: number[] }> {
	return {
		kind: "deterministic-projection",
		inputDigest: "input-digest",
		createdAt: "2026-07-26T12:00:00.000Z",
		payload,
	};
}

describe("InMemoryProjectionArtifactStore", () => {
	it("atomically keeps and returns the first winner", async () => {
		const store = new InMemoryProjectionArtifactStore<{ values: number[] }>();
		const first = envelope({ values: [1] });
		const second = envelope({ values: [2] });

		const winners = await Promise.all([
			store.putIfAbsent("same-key", first),
			store.putIfAbsent("same-key", second),
		]);

		expect(winners).toEqual([first, first]);
		expect(await store.get("same-key")).toEqual(first);
	});

	it("clones writes, reads, and returned winners", async () => {
		const store = new InMemoryProjectionArtifactStore<{ values: number[] }>();
		const input = envelope({ values: [1] });
		const winner = await store.putIfAbsent("key", input);

		input.payload.values.push(2);
		winner.payload.values.push(3);
		const read = await store.get("key");
		read?.payload.values.push(4);

		expect((await store.get("key"))?.payload.values).toEqual([1]);
	});
});

describe("isProjectionArtifactEnvelope", () => {
	it("validates envelope metadata and an optional payload predicate", () => {
		const valid = envelope({ values: [1] });
		const hasValues = (payload: unknown): payload is { values: number[] } =>
			typeof payload === "object" &&
			payload !== null &&
			Array.isArray((payload as { values?: unknown }).values);

		expect(isProjectionArtifactEnvelope(valid, hasValues)).toBe(true);
		expect(
			isProjectionArtifactEnvelope({ ...valid, inputDigest: "" }, hasValues),
		).toBe(false);
		expect(
			isProjectionArtifactEnvelope({ ...valid, createdAt: "not-a-date" }),
		).toBe(false);
		expect(
			isProjectionArtifactEnvelope({ ...valid, payload: null }, hasValues),
		).toBe(false);
	});
});
