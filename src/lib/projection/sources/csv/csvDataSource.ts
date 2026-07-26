import type { DataSource, FinancialModelParseResult } from "../../dataSource";
import type { FinancialModelDocument } from "../../types/model";

export interface CsvDataSourceOptions {
	apiPath?: string;
	fetchImpl?: typeof fetch;
}

export function createCsvDataSource(
	options?: CsvDataSourceOptions,
): DataSource {
	const apiPath = options?.apiPath ?? "/api/financial-model";
	const fetchImpl = options?.fetchImpl ?? fetch;
	const loadDocument = async (): Promise<FinancialModelParseResult> => {
		const response = await fetchImpl(apiPath);

		if (!response.ok) {
			throw new Error(
				`Failed to load financial model (${response.status} ${response.statusText}).`,
			);
		}

		return response.json() as Promise<FinancialModelParseResult>;
	};

	return {
		sourceType: "csv-api",
		label: "Repo CSV files",
		description:
			"Loaded through the Vite dev server; saved edits write back to public/configs/ in this checkout.",
		loadDocument,
		save: {
			label: "Save to CSV files",
			description:
				"Writes the edited model to public/configs/ through the local Vite dev server.",
			run: async (
				document: FinancialModelDocument,
			): Promise<FinancialModelParseResult> => {
				const response = await fetchImpl(apiPath, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(document),
				});

				if (!response.ok) {
					throw new Error(
						`Failed to save financial model (${response.status} ${response.statusText}).`,
					);
				}

				return response.json() as Promise<FinancialModelParseResult>;
			},
		},
	};
}
