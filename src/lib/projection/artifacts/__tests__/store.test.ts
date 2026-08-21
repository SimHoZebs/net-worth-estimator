import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
	isProjectionArtifactEnvelope,
	type ProjectionArtifactEnvelope,
} from "../envelope";
import {
	IndexedDbProjectionArtifactStore,
	PROJECTION_ARTIFACT_DATABASE_NAME,
	PROJECTION_ARTIFACT_STORE_NAME,
} from "../indexedDbStore";
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

describe("IndexedDbProjectionArtifactStore", () => {
	it("opens lazily and rejects when IndexedDB is unavailable", async () => {
		const store = new IndexedDbProjectionArtifactStore({
			indexedDB: undefined,
		});

		await expect(store.get("key")).rejects.toThrow("IndexedDB is unavailable");
	});

	it("persists artifacts across store instances and keeps one race winner", async () => {
		const databaseName = `${PROJECTION_ARTIFACT_DATABASE_NAME}:race-${crypto.randomUUID()}`;
		const firstStore = new IndexedDbProjectionArtifactStore({
			databaseName,
			indexedDB,
		});
		const secondStore = new IndexedDbProjectionArtifactStore({
			databaseName,
			indexedDB,
		});
		const first = envelope({ values: [1] });
		const second = envelope({ values: [2] });

		const winners = await Promise.all([
			firstStore.putIfAbsent("same-key", first),
			secondStore.putIfAbsent("same-key", second),
		]);

		expect(winners[0]).toEqual(winners[1]);
		expect(await firstStore.get("same-key")).toEqual(winners[0]);
		expect(await secondStore.get("same-key")).toEqual(winners[0]);
	});

	it("deletes malformed records so their keys can be republished", async () => {
		const databaseName = `${PROJECTION_ARTIFACT_DATABASE_NAME}:repair-${crypto.randomUUID()}`;
		const store = new IndexedDbProjectionArtifactStore({
			databaseName,
			indexedDB,
		});
		await store.get("malformed");
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(databaseName);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const transaction = database.transaction(
			PROJECTION_ARTIFACT_STORE_NAME,
			"readwrite",
		);
		transaction.objectStore(PROJECTION_ARTIFACT_STORE_NAME).add({
			key: "malformed",
			createdAt: Date.now(),
			envelope: { invalid: true },
		});
		await new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		database.close();

		expect(await store.get("malformed")).toBeUndefined();
		const replacement = envelope({ values: [3] });
		expect(await store.putIfAbsent("malformed", replacement)).toEqual(
			replacement,
		);
	});

	it("prunes oldest entries and supports deletion", async () => {
		const store = new IndexedDbProjectionArtifactStore({
			databaseName: `${PROJECTION_ARTIFACT_DATABASE_NAME}:prune-${crypto.randomUUID()}`,
			indexedDB,
			maxEntries: 2,
		});
		await store.putIfAbsent("oldest", {
			...envelope({ values: [1] }),
			createdAt: "2026-07-26T10:00:00.000Z",
		});
		await store.putIfAbsent("middle", {
			...envelope({ values: [2] }),
			createdAt: "2026-07-26T11:00:00.000Z",
		});
		await store.putIfAbsent("newest", {
			...envelope({ values: [3] }),
			createdAt: "2026-07-26T12:00:00.000Z",
		});

		expect(await store.get("oldest")).toBeUndefined();
		expect(await store.get("middle")).toBeDefined();
		await store.delete("middle");
		expect(await store.get("middle")).toBeUndefined();
	});
});
