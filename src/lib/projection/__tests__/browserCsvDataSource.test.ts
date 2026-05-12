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
		expect(fetchImpl).toHaveBeenCalledTimes(3);
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
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});
});
