import {
	type DataSource,
	type FinancialModelParseResult,
	type LegacyScenarioDataSource,
	toScenarioParseResult,
} from "../../dataSource";
import {
	CSV_MODEL_PUBLIC_PATH,
	FINANCIAL_MODEL_DOCUMENT_VERSION,
	type FinancialModelDocument,
} from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";
import { loadCsvFinancialModel } from "./csvLoader";
import { validateCsvFinancialModel } from "./csvValidation";

export const FINANCIAL_MODEL_STORAGE_KEY =
	"net-worth-estimator:financial-model:v1";
export const LEGACY_SCENARIO_PACK_STORAGE_KEY =
	"net-worth-estimator:scenario-pack:v1";

const BROWSER_STORAGE_SOURCE_PATH = "browser:local-storage";

type LegacyScenarioPack = Omit<
	FinancialModelDocument,
	"evaluations" | "version"
> & {
	version: 8;
};

type StoredDocumentRead =
	| { status: "absent" }
	| { status: "invalid"; issue: ModelValidationIssue }
	| {
			status: "found";
			document: FinancialModelDocument | LegacyScenarioPack;
	  };

export interface BrowserCsvDataSourceOptions {
	basePath?: string;
	fetchImpl?: typeof fetch;
	storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
	storageKey?: string;
}

function getDefaultStorage(): Pick<
	Storage,
	"getItem" | "setItem" | "removeItem"
> | null {
	if (typeof window === "undefined") return null;

	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isFinancialModelDocument(
	value: unknown,
): value is FinancialModelDocument {
	if (!isRecord(value)) return false;

	return (
		value.version === FINANCIAL_MODEL_DOCUMENT_VERSION &&
		typeof value.sourcePath === "string" &&
		Array.isArray(value.accounts) &&
		Array.isArray(value.checkpoints) &&
		Array.isArray(value.evaluations) &&
		Array.isArray(value.postings)
	);
}

function isLegacyScenarioPack(value: unknown): value is LegacyScenarioPack {
	if (!isRecord(value)) return false;

	return (
		value.version === 8 &&
		typeof value.sourcePath === "string" &&
		Array.isArray(value.accounts) &&
		Array.isArray(value.checkpoints) &&
		Array.isArray(value.postings)
	);
}

function invalidStorageIssue(storageKey: string): ModelValidationIssue {
	return {
		severity: "error",
		code: "browser.storage.invalid",
		message: `Saved financial model at '${storageKey}' is corrupt or has an unsupported shape.`,
		path: [],
	};
}

function validateStoredDocument(
	document: FinancialModelDocument,
	storageKey: string,
): FinancialModelParseResult {
	try {
		return { document, issues: validateCsvFinancialModel(document) };
	} catch {
		return { document: null, issues: [invalidStorageIssue(storageKey)] };
	}
}

function readStoredDocument(
	storage: Pick<Storage, "getItem">,
	storageKey: string,
): StoredDocumentRead {
	let serialized: string | null;
	try {
		serialized = storage.getItem(storageKey);
	} catch {
		return { status: "invalid", issue: invalidStorageIssue(storageKey) };
	}
	if (serialized === null) return { status: "absent" };

	try {
		const parsed = JSON.parse(serialized) as unknown;
		if (isFinancialModelDocument(parsed) || isLegacyScenarioPack(parsed)) {
			return { status: "found", document: parsed };
		}
	} catch {
		// The issue below deliberately prevents fallback when the canonical key exists.
	}

	return { status: "invalid", issue: invalidStorageIssue(storageKey) };
}

async function loadBundledDocument(
	basePath: string,
	fetchImpl: typeof fetch,
): Promise<FinancialModelParseResult> {
	const result = await loadCsvFinancialModel({ basePath, fetchImpl });
	return { document: result.data, issues: result.issues };
}

async function migrateVersionEightDocument(
	legacyDocument: LegacyScenarioPack,
	basePath: string,
	fetchImpl: typeof fetch,
	storageKey: string,
): Promise<FinancialModelParseResult> {
	const bundled = await loadBundledDocument(basePath, fetchImpl);
	if (!bundled.document) return bundled;

	const document: FinancialModelDocument = {
		...legacyDocument,
		version: FINANCIAL_MODEL_DOCUMENT_VERSION,
		evaluations: bundled.document.evaluations,
	};
	return validateStoredDocument(document, storageKey);
}

function persistMigratedDocument(
	storage: Pick<Storage, "setItem" | "removeItem">,
	storageKey: string,
	document: FinancialModelDocument,
): void {
	try {
		storage.setItem(storageKey, JSON.stringify(document));
		if (storageKey !== LEGACY_SCENARIO_PACK_STORAGE_KEY) {
			storage.removeItem(LEGACY_SCENARIO_PACK_STORAGE_KEY);
		}
	} catch {
		// A read-only or full cache must not prevent loading a valid document.
	}
}

export function createBrowserCsvDataSource(
	options: BrowserCsvDataSourceOptions = {},
): DataSource & LegacyScenarioDataSource {
	const basePath = options.basePath ?? CSV_MODEL_PUBLIC_PATH;
	const fetchImpl = options.fetchImpl ?? fetch;
	const storage =
		options.storage === undefined ? getDefaultStorage() : options.storage;
	const storageKey = options.storageKey ?? FINANCIAL_MODEL_STORAGE_KEY;

	const dataSource: DataSource = {
		sourceType: "csv-browser",
		label: "Browser-local model",
		description: storage
			? "Loads the bundled /configs CSV files first, then saves edits in this browser's local storage."
			: "Loads the bundled /configs CSV files. Browser storage is unavailable, so baseline edits cannot be saved.",
		loadDocument: async (): Promise<FinancialModelParseResult> => {
			if (!storage) return loadBundledDocument(basePath, fetchImpl);

			const canonical = readStoredDocument(storage, storageKey);
			if (canonical.status === "invalid") {
				return { document: null, issues: [canonical.issue] };
			}
			if (canonical.status === "found") {
				const result =
					canonical.document.version === FINANCIAL_MODEL_DOCUMENT_VERSION
						? validateStoredDocument(canonical.document, storageKey)
						: await migrateVersionEightDocument(
								canonical.document,
								basePath,
								fetchImpl,
								storageKey,
							);
				if (
					result.document &&
					!result.issues.some((issue) => issue.severity === "error")
				) {
					persistMigratedDocument(storage, storageKey, result.document);
				}
				return result;
			}

			const legacy = readStoredDocument(
				storage,
				LEGACY_SCENARIO_PACK_STORAGE_KEY,
			);
			if (legacy.status === "invalid") {
				return { document: null, issues: [legacy.issue] };
			}
			if (legacy.status === "absent") {
				return loadBundledDocument(basePath, fetchImpl);
			}

			const result =
				legacy.document.version === FINANCIAL_MODEL_DOCUMENT_VERSION
					? validateStoredDocument(
							legacy.document,
							LEGACY_SCENARIO_PACK_STORAGE_KEY,
						)
					: await migrateVersionEightDocument(
							legacy.document,
							basePath,
							fetchImpl,
							LEGACY_SCENARIO_PACK_STORAGE_KEY,
						);
			if (
				result.document &&
				!result.issues.some((issue) => issue.severity === "error")
			) {
				persistMigratedDocument(storage, storageKey, result.document);
			}
			return result;
		},
		save: storage
			? {
					label: "Save in this browser",
					description:
						"Stores the edited model in local storage for this browser and device.",
					run: async (
						document: FinancialModelDocument,
					): Promise<FinancialModelParseResult> => {
						const savedDocument = {
							...document,
							sourcePath: BROWSER_STORAGE_SOURCE_PATH,
						};
						let issues: ModelValidationIssue[];
						try {
							issues = validateCsvFinancialModel(savedDocument);
						} catch {
							throw new Error("The financial model has an invalid shape.");
						}
						if (issues.some((issue) => issue.severity === "error")) {
							throw new Error(
								"The financial model contains validation errors.",
							);
						}
						storage.setItem(storageKey, JSON.stringify(savedDocument));
						if (storageKey !== LEGACY_SCENARIO_PACK_STORAGE_KEY) {
							storage.removeItem(LEGACY_SCENARIO_PACK_STORAGE_KEY);
						}

						return {
							document: savedDocument,
							issues,
						};
					},
				}
			: undefined,
		reset: storage
			? {
					label: "Reset to bundled CSV",
					description:
						"Deletes the browser-local model and reloads the deployed /configs CSV files.",
					run: async (): Promise<FinancialModelParseResult> => {
						storage.removeItem(storageKey);
						storage.removeItem(LEGACY_SCENARIO_PACK_STORAGE_KEY);
						return loadBundledDocument(basePath, fetchImpl);
					},
				}
			: undefined,
	};

	return {
		...dataSource,
		// Deprecated compatibility; remove after concrete callers migrate.
		loadPack: async () =>
			toScenarioParseResult(await dataSource.loadDocument()),
	};
}
