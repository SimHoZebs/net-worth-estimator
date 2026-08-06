import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createBaseDocument,
	makeSettings,
	validCsvFiles,
} from "../__fixtures__";
import {
	createBrowserFinancialModelRepository,
	FINANCIAL_MODEL_STORAGE_KEY,
} from "../sources/csv/browserFinancialModelRepository";

function createMemoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => values.set(key, value)),
		removeItem: vi.fn((key: string) => values.delete(key)),
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
									: fileName === "income-sources.csv"
										? "id,label,effectiveFrom,effectiveTo,annualGrossIncome\nsalary,Synthetic salary,2026-01-01,,120000"
										: fileName === "tax-profiles.csv"
											? 'id,label,deduction,brackets,sourceUrl\nsynthetic-tax,Synthetic tax,10000,"[{""upTo"":null,""rate"":0.2}]",'
											: null;
		return new Response(body ?? "", { status: body === null ? 404 : 200 });
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("createBrowserFinancialModelRepository", () => {
	it("loads bundled CSV files when no browser save exists", async () => {
		const fetchImpl = createCsvFetch();
		const dataSource = createBrowserFinancialModelRepository({
			fetchImpl,
			storage: null,
		});
		const result = await dataSource.loadDocument();

		expect(result.document?.accounts).toHaveLength(4);
		expect(result.issues).toEqual([]);
		expect(fetchImpl).toHaveBeenCalledTimes(8);
		expect(dataSource.save).toBeUndefined();
		expect(dataSource.reset).toBeUndefined();
	});

	it("uses a read-only repository when default browser storage is unusable", async () => {
		vi.stubGlobal("window", {
			localStorage: {
				getItem: vi.fn(() => null),
				setItem: vi.fn(() => {
					throw new Error("storage denied");
				}),
				removeItem: vi.fn(),
			},
		});
		vi.stubGlobal("navigator", {
			locks: { request: vi.fn() },
		});
		const repository = createBrowserFinancialModelRepository({
			fetchImpl: createCsvFetch(),
		});

		const result = await repository.loadDocument();

		expect(result.document?.accounts).toHaveLength(4);
		expect(repository.save).toBeUndefined();
		expect(repository.reset).toBeUndefined();
	});

	it("loads the canonical browser key before bundled CSV files", async () => {
		const document = createBaseDocument({
			sourcePath: "browser:local-storage",
		});
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: JSON.stringify(document),
		});
		const fetchImpl = createCsvFetch();
		const result = await createBrowserFinancialModelRepository({
			fetchImpl,
			storage,
		}).loadDocument();

		expect(result.document).toEqual(document);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("upgrades checkpoint-less browser documents", async () => {
		const { checkpoints: _checkpoints, ...legacyDocument } = createBaseDocument(
			{ sourcePath: "browser:local-storage" },
		);
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: JSON.stringify(legacyDocument),
		});

		const result = await createBrowserFinancialModelRepository({
			fetchImpl: createCsvFetch(),
			storage,
		}).loadDocument();

		expect(result.document?.checkpoints).toEqual([]);
		expect(storage.setItem).toHaveBeenCalledWith(
			FINANCIAL_MODEL_STORAGE_KEY,
			expect.stringContaining('"checkpoints":[]'),
		);
	});

	it("restores checkpoints from generated browser surrogate postings", async () => {
		const { checkpoints: _checkpoints, ...legacyDocument } = createBaseDocument(
			{ sourcePath: "browser:local-storage" },
		);
		const surrogatePosting = {
			...legacyDocument.postings[0]!,
			id: "opening_20260131_checking",
			label: "Opening checking balance",
			sourceAccountId: null,
			destinations: ["checking"],
			amount: {
				resolver: "expression",
				config: { expression: "800" },
				inputs: {},
			},
			frequency: "once",
			annualRate: 0,
			annualGrowthRate: 0,
			volatility: 0,
			startDate: "2026-01-31",
			endDate: null,
			annualCap: null,
			priority: 1,
			enabled: true,
		};
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: JSON.stringify({
				...legacyDocument,
				postings: [surrogatePosting, ...legacyDocument.postings.slice(1)],
			}),
		});

		const result = await createBrowserFinancialModelRepository({
			fetchImpl: createCsvFetch(),
			storage,
		}).loadDocument();

		expect(result.document?.checkpoints).toEqual([
			{ Date: "2026-01-31", AccountId: "checking", Balance: 800 },
		]);
		expect(result.document?.postings).not.toContainEqual(
			expect.objectContaining({ id: surrogatePosting.id }),
		);
		expect(storage.setItem).toHaveBeenCalled();
	});

	it("upgrades a saved FI plan that predates the expense basis", async () => {
		const currentConfig =
			makeSettings().evaluations.financialIndependence[0]!.config;
		const document = createBaseDocument({
			sourcePath: "browser:local-storage",
			evaluations: {
				financialIndependence: [
					{
						instanceId: "fi",
						label: "Financial independence",
						enabled: true,
						config: currentConfig,
					},
				],
				netWorthThreshold: [],
				postingFulfillment: [],
			},
		});
		delete (
			document.evaluations.financialIndependence[0]!
				.config as unknown as Record<string, unknown>
		).annualExpenseTargetBasis;
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: JSON.stringify(document),
		});

		const result = await createBrowserFinancialModelRepository({
			fetchImpl: createCsvFetch(),
			storage,
		}).loadDocument();

		expect(
			result.document?.evaluations.financialIndependence[0]?.config
				.annualExpenseTargetBasis,
		).toBe("projection-start-purchasing-power");
		expect(storage.setItem).toHaveBeenCalledWith(
			FINANCIAL_MODEL_STORAGE_KEY,
			expect.stringContaining(
				'"annualExpenseTargetBasis":"projection-start-purchasing-power"',
			),
		);
	});

	it("rejects saved legacy arithmetic postings", async () => {
		const document = createBaseDocument({
			sourcePath: "browser:local-storage",
		});
		const legacy = {
			...document,
			postings: document.postings.map(({ amount, ...posting }) => ({
				...posting,
				arithmetic: amount.config.expression,
			})),
		};
		const storage = createMemoryStorage({
			[FINANCIAL_MODEL_STORAGE_KEY]: JSON.stringify(legacy),
		});

		const result = await createBrowserFinancialModelRepository({
			storage,
		}).loadDocument();

		expect(result.document).toBeNull();
		expect(result.issues).toHaveLength(1);
		expect(storage.setItem).not.toHaveBeenCalled();
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
			const result = await createBrowserFinancialModelRepository({
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
		const dataSource = createBrowserFinancialModelRepository({
			fetchImpl,
			storage,
		});

		await dataSource.save?.run(createBaseDocument());
		const saved = JSON.parse(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)!) as {
			document: { sourcePath: string };
		};
		expect(saved.document.sourcePath).toBe("browser:local-storage");

		const result = await dataSource.reset?.run();
		expect(
			JSON.parse(storage.getItem(FINANCIAL_MODEL_STORAGE_KEY)!),
		).toMatchObject({
			provenance: {
				type: "source",
				sourceId: "bundled-csv:/configs",
			},
		});
		expect(result?.document?.accounts).toHaveLength(4);
		expect(fetchImpl).toHaveBeenCalledTimes(10);
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
		const dataSource = createBrowserFinancialModelRepository({
			fetchImpl: createCsvFetch(),
			storage,
		});

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
		const dataSource = createBrowserFinancialModelRepository({ storage });

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
		const dataSource = createBrowserFinancialModelRepository({
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
