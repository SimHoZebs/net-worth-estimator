import type { DataSource, FinancialModelParseResult } from "../../dataSource";
import {
	CSV_MODEL_PUBLIC_PATH,
	type FinancialModelDocument,
} from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";
import { loadCsvFinancialModel } from "./csvLoader";
import { validateCsvFinancialModel } from "./csvValidation";

export const FINANCIAL_MODEL_STORAGE_KEY =
	"net-worth-estimator:financial-model:v1";

const BROWSER_STORAGE_SOURCE_PATH = "browser:local-storage";

type StoredDocumentRead =
	| { status: "absent" }
	| { status: "invalid"; issue: ModelValidationIssue }
	| {
			status: "found";
			document: FinancialModelDocument;
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
	const evaluations = value.evaluations;

	return (
		!("version" in value) &&
		typeof value.sourcePath === "string" &&
		Array.isArray(value.accounts) &&
		Array.isArray(value.checkpoints) &&
		isRecord(evaluations) &&
		Array.isArray(evaluations.financialIndependence) &&
		Array.isArray(evaluations.netWorthThreshold) &&
		Array.isArray(evaluations.postingFulfillment) &&
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
		if (isFinancialModelDocument(parsed)) {
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

export function createBrowserCsvDataSource(
	options: BrowserCsvDataSourceOptions = {},
): DataSource {
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

			const stored = readStoredDocument(storage, storageKey);
			if (stored.status === "invalid") {
				return { document: null, issues: [stored.issue] };
			}
			if (stored.status === "found") {
				return validateStoredDocument(stored.document, storageKey);
			}

			return loadBundledDocument(basePath, fetchImpl);
		},
		save: storage
			? {
					label: "Save in this browser",
					description:
						"Stores the edited model in local storage for this browser and device.",
					run: async (
						document: FinancialModelDocument,
					): Promise<FinancialModelParseResult> => {
						const savedDocument: FinancialModelDocument = {
							sourcePath: BROWSER_STORAGE_SOURCE_PATH,
							accounts: document.accounts,
							checkpoints: document.checkpoints,
							evaluations: document.evaluations,
							postings: document.postings,
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
						return loadBundledDocument(basePath, fetchImpl);
					},
				}
			: undefined,
	};

	return dataSource;
}
