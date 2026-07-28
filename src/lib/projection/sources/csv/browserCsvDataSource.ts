import { canonicalSerialize } from "../../artifacts/canonical";
import type { DataSource, FinancialModelParseResult } from "../../dataSource";
import {
	CSV_MODEL_PUBLIC_PATH,
	type FinancialModelDocument,
	type Posting,
} from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";
import {
	loadCsvFinancialModel,
	parseCsvFinancialModel,
	serializeCsvFinancialModel,
} from "./csvLoader";
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
		!("checkpoints" in value) &&
		typeof value.sourcePath === "string" &&
		Array.isArray(value.accounts) &&
		isRecord(evaluations) &&
		Array.isArray(evaluations.financialIndependence) &&
		Array.isArray(evaluations.netWorthThreshold) &&
		Array.isArray(evaluations.postingFulfillment) &&
		Array.isArray(value.postings)
	);
}

interface LegacyCheckpoint {
	Date: string;
	AccountId: string;
	Balance: number;
}

interface LegacyFinancialModelDocument extends Record<string, unknown> {
	accounts: FinancialModelDocument["accounts"];
	checkpoints: LegacyCheckpoint[];
	evaluations: FinancialModelDocument["evaluations"];
	postings: FinancialModelDocument["postings"];
	sourcePath: string;
}

function isLegacyCheckpoint(value: unknown): value is LegacyCheckpoint {
	return (
		isRecord(value) &&
		typeof value.Date === "string" &&
		/^\d{4}-\d{2}-\d{2}$/u.test(value.Date) &&
		!Number.isNaN(Date.parse(value.Date)) &&
		typeof value.AccountId === "string" &&
		value.AccountId.length > 0 &&
		typeof value.Balance === "number" &&
		Number.isFinite(value.Balance)
	);
}

function isLegacyFinancialModelDocument(
	value: unknown,
): value is LegacyFinancialModelDocument {
	if (!isRecord(value) || "version" in value) return false;
	const evaluations = value.evaluations;
	return (
		typeof value.sourcePath === "string" &&
		Array.isArray(value.accounts) &&
		Array.isArray(value.checkpoints) &&
		value.checkpoints.every(isLegacyCheckpoint) &&
		isRecord(evaluations) &&
		Array.isArray(evaluations.financialIndependence) &&
		Array.isArray(evaluations.netWorthThreshold) &&
		Array.isArray(evaluations.postingFulfillment) &&
		Array.isArray(value.postings)
	);
}

function migrateLegacyDocument(
	legacy: LegacyFinancialModelDocument,
): FinancialModelDocument | null {
	if (
		legacy.postings.some(
			(posting) => isRecord(posting) && posting.frequency === "once",
		)
	) {
		return null;
	}
	const accountById = new Map(
		legacy.accounts.map((account) => [account.id, account]),
	);
	const accountIds = new Set(accountById.keys());
	const usedIds = new Set([
		...accountIds,
		...legacy.postings.map((posting) => posting.id),
	]);
	const balances = new Map<string, number>();
	const migratedPostings: Posting[] = [];
	const checkpoints = legacy.checkpoints
		.map((checkpoint, index) => ({ checkpoint, index }))
		.sort(
			(left, right) =>
				left.checkpoint.Date.localeCompare(right.checkpoint.Date) ||
				left.index - right.index,
		);

	for (const { checkpoint, index } of checkpoints) {
		const account = accountById.get(checkpoint.AccountId);
		if (!account) return null;
		const target = checkpoint.Balance;
		if (target < account.minBalance || target > account.maxBalance) return null;
		const delta = target - (balances.get(checkpoint.AccountId) ?? 0);
		balances.set(checkpoint.AccountId, target);

		const idBase = `legacy_checkpoint_${index + 1}`;
		let id = idBase;
		let suffix = 2;
		while (usedIds.has(id)) id = `${idBase}_${suffix++}`;
		usedIds.add(id);
		migratedPostings.push({
			id,
			label: `Historical balance adjustment for ${checkpoint.AccountId}`,
			sourceAccountId: delta < 0 ? checkpoint.AccountId : null,
			destinations: delta < 0 ? null : [checkpoint.AccountId],
			arithmetic: String(Math.abs(delta)),
			frequency: "once",
			annualRate: 0,
			annualGrowthRate: 0,
			volatility: 0,
			startDate: checkpoint.Date,
			endDate: null,
			annualCap: null,
			priority: index + 1,
			enabled: true,
		});
	}

	const migrated: FinancialModelDocument = {
		sourcePath: BROWSER_STORAGE_SOURCE_PATH,
		accounts: legacy.accounts,
		evaluations: legacy.evaluations,
		postings: [...legacy.postings, ...migratedPostings],
	};
	try {
		const roundTrip = parseCsvFinancialModel(
			serializeCsvFinancialModel(migrated),
			{ basePath: BROWSER_STORAGE_SOURCE_PATH },
		);
		if (
			roundTrip.data === null ||
			roundTrip.issues.some((issue) => issue.severity === "error") ||
			canonicalSerialize(roundTrip.data) !== canonicalSerialize(migrated)
		) {
			return null;
		}
		return roundTrip.data;
	} catch {
		return null;
	}
}

function invalidStorageIssue(storageKey: string): ModelValidationIssue {
	return {
		severity: "error",
		code: "browser.storage.invalid",
		message: `Saved financial model at '${storageKey}' is corrupt or has an unsupported shape.`,
		path: [],
	};
}

function migrationStorageIssue(storageKey: string): ModelValidationIssue {
	return {
		severity: "error",
		code: "browser.storage.migration.failed",
		message: `Saved checkpoint-based financial model at '${storageKey}' could not be migrated and was left unchanged.`,
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
	storage: Pick<Storage, "getItem" | "setItem">,
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
		if (isLegacyFinancialModelDocument(parsed)) {
			const migrated = migrateLegacyDocument(parsed);
			if (!migrated) {
				return { status: "invalid", issue: migrationStorageIssue(storageKey) };
			}
			const result = validateStoredDocument(migrated, storageKey);
			if (
				result.document === null ||
				result.issues.some((issue) => issue.severity === "error")
			) {
				return { status: "invalid", issue: migrationStorageIssue(storageKey) };
			}
			try {
				storage.setItem(storageKey, JSON.stringify(migrated));
			} catch {
				return { status: "invalid", issue: migrationStorageIssue(storageKey) };
			}
			return { status: "found", document: migrated };
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
						if (
							"checkpoints" in (document as unknown as Record<string, unknown>)
						) {
							throw new Error("Checkpoints are not supported.");
						}
						const savedDocument: FinancialModelDocument = {
							sourcePath: BROWSER_STORAGE_SOURCE_PATH,
							accounts: document.accounts,
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
