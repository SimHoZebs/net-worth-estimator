import { describe, expect, it, vi } from "vitest";
import {
	createBaseDocument,
	makeSettings,
	validCsvFiles,
} from "../__fixtures__";
import { projectRawFinancialModelDocument } from "../simulation/projectPath";
import {
	createBrowserCsvDataSource,
	FINANCIAL_MODEL_STORAGE_KEY,
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
		expect(fetchImpl).toHaveBeenCalledTimes(5);
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

	it("reports corrupt canonical data without falling back", async () => {
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: "{invalid",
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

	it("migrates legacy checkpoints into ordered structural once postings", async () => {
		const canonical = createBaseDocument();
		const legacy = {
			...canonical,
			accounts: canonical.accounts.slice(0, 2),
			postings: [
				{
					...canonical.postings.find(
						(posting) => posting.frequency !== "once",
					)!,
					id: "legacy_checkpoint_1",
				},
			],
			checkpoints: [
				{ Date: "2025-02-01", AccountId: "checking", Balance: 10.005 },
				{ Date: "2025-01-01", AccountId: "checking", Balance: 4.001 },
				{ Date: "2025-02-01", AccountId: "brokerage", Balance: -2.345 },
				{ Date: "2025-03-01", AccountId: "checking", Balance: 10.01 },
				{ Date: "2025-04-01", AccountId: "checking", Balance: 10.01 },
			],
		};
		const original = JSON.stringify(legacy);
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: original,
		});

		const result = await createBrowserCsvDataSource({ storage }).loadDocument();

		expect(result.document).not.toBeNull();
		expect(result.document).not.toHaveProperty("checkpoints");
		const migrated = result.document!.postings.slice(1);
		expect(migrated).toMatchObject([
			{
				id: "legacy_checkpoint_2",
				frequency: "once",
				startDate: "2025-01-01",
				destinations: ["checking"],
				arithmetic: "4.001",
			},
			{
				id: "legacy_checkpoint_1_2",
				frequency: "once",
				startDate: "2025-02-01",
				destinations: ["checking"],
				arithmetic: String(10.005 - 4.001),
			},
			{
				id: "legacy_checkpoint_3",
				frequency: "once",
				startDate: "2025-02-01",
				sourceAccountId: "brokerage",
				destinations: null,
				arithmetic: "2.345",
			},
			{
				id: "legacy_checkpoint_4",
				frequency: "once",
				startDate: "2025-03-01",
				destinations: ["checking"],
				arithmetic: String(10.01 - 10.005),
			},
			{
				id: "legacy_checkpoint_5",
				frequency: "once",
				startDate: "2025-04-01",
				destinations: ["checking"],
				arithmetic: "0",
			},
		]);
		expect(migrated).toHaveLength(5);
		expect(storage.setItem).toHaveBeenCalledTimes(1);
		const rewritten = storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)!;
		expect(rewritten).not.toBe(original);
		expect(JSON.parse(rewritten)).not.toHaveProperty("checkpoints");

		const projected = projectRawFinancialModelDocument(
			result.document!,
			makeSettings({
				fallbackProjectionStartDate: "2025-05-01",
				horizonYears: 0,
			}),
		);
		expect(projected.path.movementEvents).toEqual([]);
		expect(projected.result.totals).toEqual({
			externalInflowAmount: 0,
			externalOutflowAmount: 0,
			internalTransferAmount: 0,
		});
		expect(projected.result.accountSummaries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ accountId: "checking", startingBalance: 10 }),
				expect.objectContaining({
					accountId: "brokerage",
					startingBalance: -2,
				}),
			]),
		);
		expect(projected.result.milestones.latestHistoricalDate).toBe("2025-04-01");
	});

	it("leaves mixed once-posting legacy storage unchanged", async () => {
		const legacy = {
			...createBaseDocument(),
			checkpoints: [{ Date: "2025-01-01", AccountId: "checking", Balance: 10 }],
		};
		const original = JSON.stringify(legacy);
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: original,
		});

		const result = await createBrowserCsvDataSource({ storage }).loadDocument();

		expect(result).toMatchObject({
			document: null,
			issues: [{ code: "browser.storage.migration.failed" }],
		});
		expect(storage.setItem).not.toHaveBeenCalled();
		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).toBe(original);
	});

	it("leaves legacy storage unchanged when migration cannot validate", async () => {
		const legacy = {
			...createBaseDocument(),
			checkpoints: [{ Date: "2025-01-01", AccountId: "missing", Balance: 100 }],
		};
		const original = JSON.stringify(legacy);
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: original,
		});

		const result = await createBrowserCsvDataSource({ storage }).loadDocument();

		expect(result).toMatchObject({
			document: null,
			issues: [{ code: "browser.storage.migration.failed" }],
		});
		expect(storage.setItem).not.toHaveBeenCalled();
		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).toBe(original);
	});

	it("leaves legacy storage unchanged when an adjustment cannot satisfy account bounds", async () => {
		const canonical = createBaseDocument();
		const legacy = {
			...canonical,
			accounts: canonical.accounts.map((account) =>
				account.id === "checking" ? { ...account, maxBalance: 5 } : account,
			),
			checkpoints: [{ Date: "2025-01-01", AccountId: "checking", Balance: 10 }],
		};
		const original = JSON.stringify(legacy);
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: original,
		});

		const result = await createBrowserCsvDataSource({ storage }).loadDocument();

		expect(result).toMatchObject({
			document: null,
			issues: [{ code: "browser.storage.migration.failed" }],
		});
		expect(storage.setItem).not.toHaveBeenCalled();
		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).toBe(original);
	});

	it("leaves malformed nested legacy data unchanged", async () => {
		const canonical = createBaseDocument();
		const legacy = {
			...canonical,
			postings: [{ ...canonical.postings[0], enabled: "true" }],
			checkpoints: [{ Date: "2025-01-01", AccountId: "checking", Balance: 10 }],
		};
		const original = JSON.stringify(legacy);
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: original,
		});

		const result = await createBrowserCsvDataSource({ storage }).loadDocument();

		expect(result).toMatchObject({
			document: null,
			issues: [{ code: "browser.storage.migration.failed" }],
		});
		expect(storage.setItem).not.toHaveBeenCalled();
		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).toBe(original);
	});

	it("rejects checkpoint fields on otherwise canonical stored documents", async () => {
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: JSON.stringify({
				...createBaseDocument(),
				checkpoints: "not-a-legacy-checkpoint-array",
			}),
		});

		await expect(
			createBrowserCsvDataSource({ storage }).loadDocument(),
		).resolves.toMatchObject({
			document: null,
			issues: [{ code: "browser.storage.invalid" }],
		});
	});

	it("reports malformed nested canonical data without throwing", async () => {
		const malformed = createBaseDocument({ accounts: [null] as never });
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: JSON.stringify(malformed),
		});

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

	it("saves and resets only the canonical key", async () => {
		const storage = createMemoryStorage();
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

		const result = await dataSource.reset?.run();

		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).toBeNull();
		expect(result?.document?.accounts).toHaveLength(4);
		expect(fetchImpl).toHaveBeenCalledTimes(5);
	});

	it("preserves canonical storage when save validation fails", async () => {
		const canonical = JSON.stringify(createBaseDocument({ sourcePath: "old" }));
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: canonical,
		});
		const baseDocument = createBaseDocument();
		const invalid = createBaseDocument({
			accounts: [baseDocument.accounts[0], baseDocument.accounts[0]],
		});
		const dataSource = createBrowserCsvDataSource({
			fetchImpl: createCsvFetch(),
			storage,
		});

		await expect(dataSource.save?.run(invalid)).rejects.toThrow(
			"validation errors",
		);
		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).toBe(canonical);
	});

	it("rejects checkpoint fields on save without changing storage", async () => {
		const canonical = JSON.stringify(createBaseDocument({ sourcePath: "old" }));
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: canonical,
		});
		const dataSource = createBrowserCsvDataSource({ storage });

		await expect(
			dataSource.save?.run({
				...createBaseDocument(),
				checkpoints: [],
			} as never),
		).rejects.toThrow("Checkpoints are not supported");
		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).toBe(canonical);
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
});
