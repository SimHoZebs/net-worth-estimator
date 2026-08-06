import type { FinancialModelIngestionSource } from "../../persistence/financialModelPersistence";
import { financialModelSourceRevision } from "../../persistence/financialModelPersistence";
import { CSV_MODEL_PUBLIC_PATH } from "../../types/model";
import { loadCsvFinancialModel } from "./csvLoader";

export interface BundledCsvFinancialModelSourceOptions {
	basePath?: string;
	fetchImpl?: typeof fetch;
}

export function createBundledCsvFinancialModelSource(
	options: BundledCsvFinancialModelSourceOptions = {},
): FinancialModelIngestionSource {
	const basePath = options.basePath ?? CSV_MODEL_PUBLIC_PATH;
	const fetchImpl = options.fetchImpl ?? fetch;
	return {
		async load() {
			const loaded = await loadCsvFinancialModel({ basePath, fetchImpl });
			const result = { document: loaded.data, issues: loaded.issues };
			return {
				sourceId: `bundled-csv:${basePath}`,
				revision: loaded.data
					? await financialModelSourceRevision(loaded.data)
					: null,
				result,
			};
		},
	};
}
