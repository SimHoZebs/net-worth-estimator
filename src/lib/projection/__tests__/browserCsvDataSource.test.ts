import { describe, expect, it, vi } from "vitest";
import { createBasePack, validCsvFiles } from "../__fixtures__";
import { createBrowserCsvDataSource } from "../sources/csv/browserCsvDataSource";

function createMemoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));

	return {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => {
			values.set(key, value);
		}),
		removeItem: vi.fn((key: string) => {
			values.delete(key);
		}),
	};
}

function createCsvFetch() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const fileName = String(input).split("/").pop();
		const body =
			fileName === "accounts.csv"
				? validCsvFiles.accounts
				: fileName === "checkpoints.csv"
					? validCsvFiles.checkpoints
					: fileName === "financial-independence.csv"
						? validCsvFiles.behaviors.financialIndependence
						: fileName === "net-worth-threshold.csv"
							? validCsvFiles.behaviors.netWorthThreshold
							: fileName === "postings.csv"
								? validCsvFiles.postings
								: null;

		return new Response(body ?? "", { status: body === null ? 404 : 200 });
	});
}

describe("createBrowserCsvDataSource", () => {
	it("loads bundled CSV files when no browser save exists", async () => {
		const fetchImpl = createCsvFetch();
		const dataSource = createBrowserCsvDataSource({ fetchImpl, storage: null });

		const result = await dataSource.loadPack();

		expect(result.pack?.accounts).toHaveLength(4);
		expect(result.issues).toEqual([]);
		expect(fetchImpl).toHaveBeenCalledTimes(5);
		expect(dataSource.save).toBeUndefined();
		expect(dataSource.reset).toBeUndefined();
	});

	it("loads the saved browser pack before fetching bundled CSV files", async () => {
		const storageKey = "scenario:test";
		const savedPack = createBasePack({ sourcePath: "browser:local-storage" });
		const storage = createMemoryStorage({
			[storageKey]: JSON.stringify(savedPack),
		});
		const fetchImpl = createCsvFetch();
		const dataSource = createBrowserCsvDataSource({
			fetchImpl,
			storage,
			storageKey,
		});

		const result = await dataSource.loadPack();

		expect(result.pack).toEqual(savedPack);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("migrates a version 8 browser pack with bundled evaluations", async () => {
		const storageKey = "scenario:test";
		const currentPack = createBasePack({
			sourcePath: "browser:local-storage",
		});
		const { evaluations: _evaluations, ...legacyPack } = currentPack;
		const storage = createMemoryStorage({
			[storageKey]: JSON.stringify({ ...legacyPack, version: 8 }),
		});
		const fetchImpl = createCsvFetch();
		const dataSource = createBrowserCsvDataSource({
			fetchImpl,
			storage,
			storageKey,
		});

		const result = await dataSource.loadPack();

		expect(result.pack).toMatchObject({
			version: 9,
			sourcePath: "browser:local-storage",
			accounts: currentPack.accounts,
			evaluations: [{ instanceId: "net-worth-1m" }],
		});
		expect(fetchImpl).toHaveBeenCalledTimes(5);
		expect(JSON.parse(storage.getItem(storageKey)!)).toMatchObject({
			version: 9,
			evaluations: [{ instanceId: "net-worth-1m" }],
		});
	});

	it("loads a migrated version 8 pack when browser storage is read-only", async () => {
		const currentPack = createBasePack({
			sourcePath: "browser:local-storage",
		});
		const { evaluations: _evaluations, ...legacyPack } = currentPack;
		const storage = {
			getItem: vi.fn(() => JSON.stringify({ ...legacyPack, version: 8 })),
			setItem: vi.fn(() => {
				throw new Error("Storage is read-only");
			}),
			removeItem: vi.fn(),
		};
		const dataSource = createBrowserCsvDataSource({
			fetchImpl: createCsvFetch(),
			storage,
		});

		const result = await dataSource.loadPack();

		expect(result.pack?.version).toBe(9);
		expect(result.pack?.accounts).toEqual(currentPack.accounts);
		expect(result.pack?.evaluations).toHaveLength(1);
		expect(storage.setItem).toHaveBeenCalledOnce();
	});

	it("saves to browser storage and resets back to bundled CSV files", async () => {
		const storageKey = "scenario:test";
		const storage = createMemoryStorage();
		const fetchImpl = createCsvFetch();
		const dataSource = createBrowserCsvDataSource({
			fetchImpl,
			storage,
			storageKey,
		});
		const pack = createBasePack();

		await dataSource.save?.run(pack);

		const saved = JSON.parse(storage.getItem(storageKey)!) as {
			sourcePath: string;
		};
		expect(saved.sourcePath).toBe("browser:local-storage");

		const result = await dataSource.reset?.run();

		expect(storage.getItem(storageKey)).toBeNull();
		expect(result?.pack?.accounts).toHaveLength(4);
		expect(fetchImpl).toHaveBeenCalledTimes(5);
	});
});
