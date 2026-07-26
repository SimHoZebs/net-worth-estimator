import { describe, expect, it, vi } from "vitest";
import { createBaseDocument, validCsvFiles } from "../__fixtures__";
import {
	createBrowserCsvDataSource,
	FINANCIAL_MODEL_STORAGE_KEY,
	LEGACY_SCENARIO_PACK_STORAGE_KEY,
} from "../sources/csv/browserCsvDataSource";

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
							: fileName === "posting-fulfillment.csv"
								? validCsvFiles.behaviors.postingFulfillment
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

		const result = await dataSource.loadDocument();

		expect(result.document?.accounts).toHaveLength(4);
		expect(result.issues).toEqual([]);
		expect(fetchImpl).toHaveBeenCalledTimes(6);
		expect(dataSource.save).toBeUndefined();
		expect(dataSource.reset).toBeUndefined();
	});

	it("loads the canonical browser key before fetching bundled CSV files", async () => {
		const document = createBaseDocument({
			sourcePath: "browser:local-storage",
		});
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: JSON.stringify(document),
		});
		const fetchImpl = createCsvFetch();

		const result = await createBrowserCsvDataSource({
			fetchImpl,
			storage,
		}).loadDocument();

		expect(result.document).toEqual(document);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("migrates a valid legacy key to the canonical key", async () => {
		const document = createBaseDocument({
			sourcePath: "browser:local-storage",
		});
		const storage = createMemoryStorage({
			[LEGACY_SCENARIO_PACK_STORAGE_KEY]: JSON.stringify(document),
		});

		const result = await createBrowserCsvDataSource({
			fetchImpl: createCsvFetch(),
			storage,
		}).loadDocument();

		expect(result.document).toEqual(document);
		expect(JSON.parse(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)!)).toEqual(
			document,
		);
		expect(storage.getItem(LEGACY_SCENARIO_PACK_STORAGE_KEY)).toBeNull();
	});

	it("gives the canonical key precedence over the legacy key", async () => {
		const canonical = createBaseDocument({ sourcePath: "canonical" });
		const legacy = createBaseDocument({ sourcePath: "legacy" });
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: JSON.stringify(canonical),
			[LEGACY_SCENARIO_PACK_STORAGE_KEY]: JSON.stringify(legacy),
		});

		const result = await createBrowserCsvDataSource({
			fetchImpl: createCsvFetch(),
			storage,
		}).loadDocument();

		expect(result.document?.sourcePath).toBe("canonical");
	});

	it("reports corrupt canonical data without falling back", async () => {
		const legacy = createBaseDocument({ sourcePath: "legacy" });
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: "{invalid",
			[LEGACY_SCENARIO_PACK_STORAGE_KEY]: JSON.stringify(legacy),
		});
		const fetchImpl = createCsvFetch();

		const result = await createBrowserCsvDataSource({
			fetchImpl,
			storage,
		}).loadDocument();

		expect(result.document).toBeNull();
		expect(result.issues).toMatchObject([
			{ severity: "error", code: "browser.storage.invalid" },
		]);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(storage.getItem(LEGACY_SCENARIO_PACK_STORAGE_KEY)).not.toBeNull();
	});

	it("rejects stored document version fields", async () => {
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: JSON.stringify({
				...createBaseDocument(),
				version: 1,
			}),
		});

		await expect(
			createBrowserCsvDataSource({ storage }).loadDocument(),
		).resolves.toMatchObject({
			document: null,
			issues: [{ code: "browser.storage.invalid" }],
		});
	});

	it("reports corrupt legacy data instead of silently loading bundled data", async () => {
		const storage = createMemoryStorage({
			[LEGACY_SCENARIO_PACK_STORAGE_KEY]: "{invalid",
		});
		const fetchImpl = createCsvFetch();

		const result = await createBrowserCsvDataSource({
			fetchImpl,
			storage,
		}).loadDocument();

		expect(result.document).toBeNull();
		expect(result.issues).toMatchObject([
			{ severity: "error", code: "browser.storage.invalid" },
		]);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		["canonical", FINANCIAL_MODEL_STORAGE_KEY],
		["legacy", LEGACY_SCENARIO_PACK_STORAGE_KEY],
	])("reports malformed nested %s data without throwing", async (_name, key) => {
		const malformed = createBaseDocument({
			accounts: [null] as never,
		});
		const storage = createMemoryStorage({ [key]: JSON.stringify(malformed) });

		await expect(
			createBrowserCsvDataSource({
				fetchImpl: createCsvFetch(),
				storage,
			}).loadDocument(),
		).resolves.toMatchObject({
			document: null,
			issues: [{ severity: "error", code: "browser.storage.invalid" }],
		});
	});

	it("saves canonically, removes legacy data, and resets both keys", async () => {
		const storage = createMemoryStorage({
			[LEGACY_SCENARIO_PACK_STORAGE_KEY]: JSON.stringify(createBaseDocument()),
		});
		const fetchImpl = createCsvFetch();
		const dataSource = createBrowserCsvDataSource({ fetchImpl, storage });

		await dataSource.save?.run({
			...createBaseDocument(),
			version: 1,
		} as never);

		const saved = JSON.parse(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)!) as {
			sourcePath: string;
		};
		expect(saved.sourcePath).toBe("browser:local-storage");
		expect(saved).not.toHaveProperty("version");
		expect(storage.getItem(LEGACY_SCENARIO_PACK_STORAGE_KEY)).toBeNull();

		storage.setItem(
			LEGACY_SCENARIO_PACK_STORAGE_KEY,
			JSON.stringify(createBaseDocument()),
		);
		const result = await dataSource.reset?.run();

		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).toBeNull();
		expect(storage.getItem(LEGACY_SCENARIO_PACK_STORAGE_KEY)).toBeNull();
		expect(result?.document?.accounts).toHaveLength(4);
		expect(fetchImpl).toHaveBeenCalledTimes(6);
	});

	it("preserves both storage keys when save validation fails", async () => {
		const canonical = JSON.stringify(createBaseDocument({ sourcePath: "old" }));
		const legacy = JSON.stringify(createBaseDocument({ sourcePath: "legacy" }));
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: canonical,
			[LEGACY_SCENARIO_PACK_STORAGE_KEY]: legacy,
		});
		const invalid = createBaseDocument({
			accounts: [
				createBaseDocument().accounts[0],
				createBaseDocument().accounts[0],
			],
		});
		const dataSource = createBrowserCsvDataSource({
			fetchImpl: createCsvFetch(),
			storage,
		});

		await expect(dataSource.save?.run(invalid)).rejects.toThrow(
			"validation errors",
		);
		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).toBe(canonical);
		expect(storage.getItem(LEGACY_SCENARIO_PACK_STORAGE_KEY)).toBe(legacy);
	});

	it("saves documents that have warnings", async () => {
		const storage = createMemoryStorage();
		const dataSource = createBrowserCsvDataSource({
			fetchImpl: createCsvFetch(),
			storage,
		});

		const result = await dataSource.save?.run(createBaseDocument());

		expect(result?.issues).toContainEqual(
			expect.objectContaining({ severity: "warning" }),
		);
		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).not.toBeNull();
	});

	it("exposes loadPack with a legacy result envelope", async () => {
		const dataSource = createBrowserCsvDataSource({
			fetchImpl: createCsvFetch(),
			storage: null,
		});

		const result = await dataSource.loadPack();

		expect(result.pack?.accounts).toHaveLength(4);
		expect(result).not.toHaveProperty("document");
	});
});
