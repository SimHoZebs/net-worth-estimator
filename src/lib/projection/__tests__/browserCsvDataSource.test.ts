import { describe, expect, it, vi } from "vitest";
import { createBaseDocument, validCsvFiles } from "../__fixtures__";
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

	it("loads the canonical browser key before bundled CSV files", async () => {
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

	it("reports corrupt or noncanonical stored data without falling back", async () => {
		const document = createBaseDocument();
		for (const stored of [
			"{invalid",
			JSON.stringify({ ...document, unexpected: true }),
			JSON.stringify({
				...document,
				accounts: [
					{ ...document.accounts[0], unexpected: true },
					...document.accounts.slice(1),
				],
			}),
			JSON.stringify(createBaseDocument({ accounts: [null] as never })),
		]) {
			const fetchImpl = createCsvFetch();
			const result = await createBrowserCsvDataSource({
				fetchImpl,
				storage: createMemoryStorage({
					[FINANCIAL_MODEL_STORAGE_KEY]: stored,
				}),
			}).loadDocument();

			expect(result).toMatchObject({
				document: null,
				issues: [{ severity: "error", code: "browser.storage.invalid" }],
			});
			expect(fetchImpl).not.toHaveBeenCalled();
		}
	});

	it("saves and resets the canonical browser key", async () => {
		const storage = createMemoryStorage();
		const fetchImpl = createCsvFetch();
		const dataSource = createBrowserCsvDataSource({ fetchImpl, storage });

		await dataSource.save?.run(createBaseDocument());

		const saved = JSON.parse(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)!) as {
			sourcePath: string;
		};
		expect(saved.sourcePath).toBe("browser:local-storage");

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
		const dataSource = createBrowserCsvDataSource({ storage });

		await expect(dataSource.save?.run(invalid)).rejects.toThrow(
			"validation errors",
		);
		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).toBe(canonical);
	});

	it("rejects noncanonical save input without changing storage", async () => {
		const canonical = JSON.stringify(createBaseDocument({ sourcePath: "old" }));
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: canonical,
		});
		const dataSource = createBrowserCsvDataSource({ storage });

		await expect(
			dataSource.save?.run({
				...createBaseDocument(),
				unexpected: true,
			} as never),
		).rejects.toThrow("not canonical");
		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).toBe(canonical);
	});

	it("saves documents that have warnings", async () => {
		const storage = createMemoryStorage();
		const dataSource = createBrowserCsvDataSource({ storage });

		const result = await dataSource.save?.run(createBaseDocument());

		expect(result?.issues).toContainEqual(
			expect.objectContaining({ severity: "warning" }),
		);
		expect(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)).not.toBeNull();
	});
});
