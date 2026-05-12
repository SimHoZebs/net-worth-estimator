import type { DataSource, ScenarioParseResult } from "../../dataSource";
import {
	CSV_SCENARIO_PUBLIC_PATH,
	SCENARIO_MODEL_VERSION,
	type ScenarioPack,
} from "../../types/scenario";
import { loadCsvScenarioPack } from "./csvLoader";
import { validateCsvScenarioPack } from "./csvValidation";

const DEFAULT_STORAGE_KEY = "net-worth-estimator:scenario-pack:v1";
const BROWSER_STORAGE_SOURCE_PATH = "browser:local-storage";

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

function isScenarioPack(value: unknown): value is ScenarioPack {
	if (!isRecord(value)) return false;

	return (
		value.version === SCENARIO_MODEL_VERSION &&
		typeof value.sourcePath === "string" &&
		Array.isArray(value.accounts) &&
		Array.isArray(value.checkpoints) &&
		Array.isArray(value.postings)
	);
}

function readSavedPack(
	storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
	storageKey: string,
): ScenarioPack | null {
	try {
		const serialized = storage.getItem(storageKey);
		if (!serialized) return null;

		const parsed = JSON.parse(serialized) as unknown;
		return isScenarioPack(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

async function loadBundledPack(
	basePath: string,
	fetchImpl: typeof fetch,
): Promise<ScenarioParseResult> {
	const result = await loadCsvScenarioPack({ basePath, fetchImpl });
	return { pack: result.data, issues: result.issues };
}

export function createBrowserCsvDataSource(
	options: BrowserCsvDataSourceOptions = {},
): DataSource {
	const basePath = options.basePath ?? CSV_SCENARIO_PUBLIC_PATH;
	const fetchImpl = options.fetchImpl ?? fetch;
	const storage =
		options.storage === undefined ? getDefaultStorage() : options.storage;
	const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;

	return {
		sourceType: "csv-browser",
		label: "Browser-local scenario",
		description: storage
			? "Loads the bundled /scenario CSV files first, then saves edits in this browser's local storage."
			: "Loads the bundled /scenario CSV files. Browser storage is unavailable, so baseline edits cannot be saved.",
		loadPack: async (): Promise<ScenarioParseResult> => {
			const savedPack = storage ? readSavedPack(storage, storageKey) : null;

			if (savedPack) {
				return {
					pack: savedPack,
					issues: validateCsvScenarioPack(savedPack),
				};
			}

			return loadBundledPack(basePath, fetchImpl);
		},
		save: storage
			? {
					label: "Save in this browser",
					description:
						"Stores the edited scenario in local storage for this browser and device.",
					run: async (pack: ScenarioPack): Promise<ScenarioParseResult> => {
						const savedPack = {
							...pack,
							sourcePath: BROWSER_STORAGE_SOURCE_PATH,
						};
						storage.setItem(storageKey, JSON.stringify(savedPack));

						return {
							pack: savedPack,
							issues: validateCsvScenarioPack(savedPack),
						};
					},
				}
			: undefined,
		reset: storage
			? {
					label: "Reset to bundled CSV",
					description:
						"Deletes the browser-local scenario and reloads the deployed /scenario CSV files.",
					run: async (): Promise<ScenarioParseResult> => {
						storage.removeItem(storageKey);
						return loadBundledPack(basePath, fetchImpl);
					},
				}
			: undefined,
	};
}
