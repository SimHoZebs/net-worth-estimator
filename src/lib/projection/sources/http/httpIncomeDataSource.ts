import { buildApiUrl } from "@/lib/api-url";
import type { IncomeDataLoadResult, IncomeDataSource } from "../../incomeData";
import { parseIncomeDataSnapshot } from "./incomeSnapshotParser";

// HTTP income data source backed by the Go backend snapshot endpoint.

export const INCOME_DATA_HTTP_API_PATH = buildApiUrl("/v1/income-data");

export interface HttpIncomeDataSourceOptions {
	basePath?: string;
	fetchImpl?: typeof fetch;
}

export function createHttpIncomeDataSource(
	options: HttpIncomeDataSourceOptions = {},
): IncomeDataSource {
	const basePath = options.basePath ?? INCOME_DATA_HTTP_API_PATH;
	const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
	return {
		sourceType: "http-backend",
		label: "Backend",
		description: "Income definitions load from the Go backend SQLite database.",
		async load(): Promise<IncomeDataLoadResult> {
			try {
				const response = await fetchImpl(basePath);
				if (!response.ok) {
					throw new Error(`Income data request failed (${response.status}).`);
				}
				return parseIncomeDataSnapshot(await response.json());
			} catch (error) {
				return {
					data: null,
					issues: [
						{
							severity: "error",
							code: "income-data.load.failed",
							message:
								error instanceof Error
									? error.message
									: "Could not load income data.",
							path: [],
						},
					],
				};
			}
		},
	};
}
