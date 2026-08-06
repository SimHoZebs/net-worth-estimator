import {
	type FinancialModelParseResult,
	type FinancialModelRepository,
	FinancialModelValidationError,
} from "../../modelRepository";
import {
	createFinancialModelRecord,
	FinancialModelIngestionCoordinator,
} from "../../persistence/financialModelPersistence";
import {
	createInProcessFinancialModelStorageLock,
	createWebFinancialModelStorageLock,
	type FinancialModelStorage,
	type FinancialModelStorageLock,
	LocalStorageFinancialModelDao,
} from "../../persistence/localStorageFinancialModelDao";
import type { FinancialModelDocument } from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";
import { createBundledCsvFinancialModelSource } from "./bundledCsvFinancialModelSource";
import { parseFinancialModelDocument } from "./csvDataSource";
import { validateCsvFinancialModel } from "./csvValidation";
import { createCsvIncomeDataSource } from "./incomeDataSource";

export const FINANCIAL_MODEL_STORAGE_KEY =
	"net-worth-estimator:financial-model";

const BROWSER_STORAGE_SOURCE_PATH = "browser:local-storage";

export interface BrowserFinancialModelRepositoryOptions {
	basePath?: string;
	incomeBasePath?: string;
	fetchImpl?: typeof fetch;
	storage?: FinancialModelStorage | null;
	storageLock?: FinancialModelStorageLock;
	storageKey?: string;
}

function getDefaultStorage(): {
	storage: FinancialModelStorage;
	lock: FinancialModelStorageLock;
} | null {
	if (
		typeof window === "undefined" ||
		typeof navigator === "undefined" ||
		!navigator.locks
	)
		return null;
	try {
		const storage = window.localStorage;
		const probeKey = `${FINANCIAL_MODEL_STORAGE_KEY}:availability-probe`;
		storage.setItem(probeKey, "available");
		storage.getItem(probeKey);
		storage.removeItem(probeKey);
		return {
			storage,
			lock: createWebFinancialModelStorageLock(
				navigator.locks,
				FINANCIAL_MODEL_STORAGE_KEY,
			),
		};
	} catch {
		return null;
	}
}

function hasErrors(issues: readonly ModelValidationIssue[]): boolean {
	return issues.some((issue) => issue.severity === "error");
}

export function createBrowserFinancialModelRepository(
	options: BrowserFinancialModelRepositoryOptions = {},
): FinancialModelRepository {
	const fetchImpl = options.fetchImpl ?? fetch;
	const source = createBundledCsvFinancialModelSource({
		basePath: options.basePath,
		fetchImpl,
	});
	const incomeDataSource = createCsvIncomeDataSource({
		basePath: options.incomeBasePath,
		fetchImpl,
	});
	const defaultPersistence =
		options.storage === undefined ? getDefaultStorage() : null;
	const storage =
		options.storage === undefined
			? (defaultPersistence?.storage ?? null)
			: options.storage;
	const storageLock =
		options.storageLock ??
		defaultPersistence?.lock ??
		(storage ? createInProcessFinancialModelStorageLock() : null);
	const dao =
		storage && storageLock
			? new LocalStorageFinancialModelDao(
					storage,
					options.storageKey ?? FINANCIAL_MODEL_STORAGE_KEY,
					storageLock,
				)
			: null;
	const coordinator = dao
		? new FinancialModelIngestionCoordinator(source, dao)
		: null;
	let operation = Promise.resolve();

	const exclusive = <T>(run: () => Promise<T>): Promise<T> => {
		const result = operation.then(run, run);
		operation = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};
	const withIncomeValidation = async (
		result: FinancialModelParseResult,
	): Promise<FinancialModelParseResult> => {
		if (!result.document) return result;
		const income = await incomeDataSource.load();
		return {
			document: result.document,
			issues: [
				...result.issues,
				...income.issues,
				...validateCsvFinancialModel(result.document, income.data ?? undefined),
			],
		};
	};
	const loadDocument = (): Promise<FinancialModelParseResult> =>
		exclusive(async () => {
			if (!coordinator) {
				const snapshot = await source.load();
				return withIncomeValidation(snapshot.result);
			}
			return withIncomeValidation(await coordinator.synchronize());
		});

	return {
		repositoryType: storage ? "browser-database" : "bundled-csv-readonly",
		label: storage ? "Browser model database" : "Bundled model",
		description: storage
			? "Stores the operational model in this browser and synchronizes untouched source-owned data from bundled CSV files."
			: "Loads bundled model and income CSV files. Browser storage is unavailable, so baseline edits cannot be saved.",
		loadDocument,
		save: dao
			? {
					label: "Save in this browser",
					description:
						"Stores the edited model in the browser model repository for this device.",
					run: (document: FinancialModelDocument) =>
						exclusive(async () => {
							const canonical = parseFinancialModelDocument(document);
							if (!canonical) {
								throw new Error("The financial model is not canonical.");
							}
							const savedDocument: FinancialModelDocument = {
								sourcePath: BROWSER_STORAGE_SOURCE_PATH,
								accounts: canonical.accounts,
								checkpoints: canonical.checkpoints,
								evaluations: canonical.evaluations,
								postings: canonical.postings,
							};
							const validated = await withIncomeValidation({
								document: savedDocument,
								issues: [],
							});
							if (hasErrors(validated.issues)) {
								throw new FinancialModelValidationError(validated);
							}
							await dao.replace(
								createFinancialModelRecord(savedDocument, { type: "user" }),
							);
							return validated;
						}),
				}
			: undefined,
		reset: dao
			? {
					label: "Reset to bundled CSV",
					description:
						"Clears the browser model repository and ingests the deployed /configs CSV files again.",
					run: () =>
						exclusive(async () => {
							await dao.clear();
							return withIncomeValidation(await coordinator!.synchronize());
						}),
				}
			: undefined,
	};
}
