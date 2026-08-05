import {
	type DataSource,
	type FinancialModelParseResult,
	FinancialModelValidationError,
} from "../../dataSource";
import type { IncomeDataSnapshot } from "../../types/income";
import {
	CSV_MODEL_PUBLIC_PATH,
	type FinancialModelDocument,
} from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";
import { parseFinancialModelDocument } from "./csvDataSource";
import { loadCsvFinancialModel } from "./csvLoader";
import { validateCsvFinancialModel } from "./csvValidation";
import { createCsvIncomeDataSource } from "./incomeDataSource";

export const FINANCIAL_MODEL_STORAGE_KEY =
	"net-worth-estimator:financial-model";

const BROWSER_STORAGE_SOURCE_PATH = "browser:local-storage";

type StoredDocumentRead =
	| { status: "absent" }
	| { status: "invalid"; issue: ModelValidationIssue }
	| { status: "found"; document: FinancialModelDocument };

interface CheckpointSurrogate {
	index: number;
	kind: "opening" | "adjustment";
	date: string;
	accountId: string;
	delta: number;
}

export interface BrowserCsvDataSourceOptions {
	basePath?: string;
	incomeBasePath?: string;
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

function invalidStorageIssue(storageKey: string): ModelValidationIssue {
	return {
		severity: "error",
		code: "browser.storage.invalid",
		message: `Saved financial model at '${storageKey}' is corrupt or is not canonical.`,
		path: [],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCheckpointSurrogate(
	value: unknown,
	index: number,
): CheckpointSurrogate | null {
	if (!isRecord(value) || typeof value.id !== "string") return null;
	const match = /^(opening|adjustment)_(\d{4})(\d{2})(\d{2})_(.+)$/u.exec(
		value.id,
	);
	if (!match) return null;
	const [, kind, year, month, day, accountId] = match;
	const date = `${year}-${month}-${day}`;
	if (
		(kind !== "opening" && kind !== "adjustment") ||
		!accountId ||
		value.frequency !== "once" ||
		value.startDate !== date ||
		value.endDate !== null ||
		value.annualRate !== 0 ||
		value.annualGrowthRate !== 0 ||
		value.volatility !== 0 ||
		value.annualCap !== null ||
		value.priority !== 1 ||
		value.enabled !== true ||
		!isRecord(value.amount) ||
		value.amount.resolver !== "expression" ||
		!isRecord(value.amount.config) ||
		typeof value.amount.config.expression !== "string" ||
		!isRecord(value.amount.inputs) ||
		Object.keys(value.amount.inputs).length !== 0
	) {
		return null;
	}
	const amount = Number(value.amount.config.expression);
	if (!Number.isFinite(amount) || amount < 0) return null;

	const isInflow =
		value.sourceAccountId === null &&
		Array.isArray(value.destinations) &&
		value.destinations.length === 1 &&
		value.destinations[0] === accountId;
	const isOutflow =
		value.sourceAccountId === accountId && value.destinations === null;
	if (!isInflow && !isOutflow) return null;

	return {
		index,
		kind,
		date,
		accountId,
		delta: isOutflow ? -amount : amount,
	};
}

function upgradeCheckpointSurrogates(value: unknown): unknown {
	if (!isRecord(value) || !Array.isArray(value.postings)) return value;
	if (Array.isArray(value.checkpoints) && value.checkpoints.length > 0) {
		return value;
	}

	const surrogates = value.postings
		.map(parseCheckpointSurrogate)
		.filter((surrogate): surrogate is CheckpointSurrogate => surrogate !== null)
		.sort(
			(left, right) =>
				left.date.localeCompare(right.date) || left.index - right.index,
		);
	if (surrogates.length === 0) return value;

	const balances = new Map<string, number>();
	const checkpoints = surrogates.map((surrogate) => {
		const balance =
			surrogate.kind === "opening"
				? surrogate.delta
				: (balances.get(surrogate.accountId) ?? 0) + surrogate.delta;
		balances.set(surrogate.accountId, balance);
		return {
			Date: surrogate.date,
			AccountId: surrogate.accountId,
			Balance: balance,
		};
	});
	const surrogateIndexes = new Set(
		surrogates.map((surrogate) => surrogate.index),
	);
	return {
		...value,
		checkpoints,
		postings: value.postings.filter((_, index) => !surrogateIndexes.has(index)),
	};
}

function validateStoredDocument(
	document: FinancialModelDocument,
	storageKey: string,
	incomeData?: IncomeDataSnapshot,
): FinancialModelParseResult {
	try {
		return {
			document,
			issues: validateCsvFinancialModel(document, incomeData),
		};
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
		const document = parseFinancialModelDocument(
			upgradeCheckpointSurrogates(JSON.parse(serialized)),
		);
		if (document) {
			const upgraded = JSON.stringify(document);
			if (upgraded !== serialized) {
				try {
					storage.setItem(storageKey, upgraded);
				} catch {
					// Loading valid data does not depend on persisting its canonical upgrade.
				}
			}
			return { status: "found", document };
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
	const incomeDataSource = createCsvIncomeDataSource({
		basePath: options.incomeBasePath,
		fetchImpl,
	});
	const storage =
		options.storage === undefined ? getDefaultStorage() : options.storage;
	const storageKey = options.storageKey ?? FINANCIAL_MODEL_STORAGE_KEY;

	return {
		sourceType: "csv-browser",
		label: "Browser-local model",
		description: storage
			? "Loads bundled model and income CSV files first, then saves edits in this browser's local storage."
			: "Loads bundled model and income CSV files. Browser storage is unavailable, so baseline edits cannot be saved.",
		loadDocument: async (): Promise<FinancialModelParseResult> => {
			const stored = storage ? readStoredDocument(storage, storageKey) : null;
			if (stored?.status === "invalid") {
				return { document: null, issues: [stored.issue] };
			}

			const income = await incomeDataSource.load();
			const withIncomeValidation = (
				result: FinancialModelParseResult,
			): FinancialModelParseResult => ({
				document: result.document,
				issues: [
					...result.issues,
					...income.issues,
					...(result.document
						? validateCsvFinancialModel(
								result.document,
								income.data ?? undefined,
							)
						: []),
				],
			});
			if (!storage) {
				return withIncomeValidation(
					await loadBundledDocument(basePath, fetchImpl),
				);
			}

			if (stored?.status === "found") {
				return validateStoredDocument(
					stored.document,
					storageKey,
					income.data ?? undefined,
				);
			}
			return withIncomeValidation(
				await loadBundledDocument(basePath, fetchImpl),
			);
		},
		save: storage
			? {
					label: "Save in this browser",
					description:
						"Stores the edited model in local storage for this browser and device.",
					run: async (
						document: FinancialModelDocument,
					): Promise<FinancialModelParseResult> => {
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
						const income = await incomeDataSource.load();
						let issues: ModelValidationIssue[];
						try {
							issues = [
								...income.issues,
								...validateCsvFinancialModel(
									savedDocument,
									income.data ?? undefined,
								),
							];
						} catch {
							throw new Error("The financial model has an invalid shape.");
						}
						if (issues.some((issue) => issue.severity === "error")) {
							throw new FinancialModelValidationError({
								document: savedDocument,
								issues,
							});
						}
						storage.setItem(storageKey, JSON.stringify(savedDocument));
						return { document: savedDocument, issues };
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
}
