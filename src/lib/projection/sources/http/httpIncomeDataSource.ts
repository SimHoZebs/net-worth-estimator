import type { IncomeDataLoadResult, IncomeDataSource } from "../../incomeData";
import { parseIncomeDataFiles } from "../../sources/csv/incomeDataSource";

// HTTP income data source backed by the Go backend snapshot endpoint.

export const INCOME_DATA_HTTP_API_PATH = "/v1/income-data";

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
				const snapshot = (await response.json()) as {
					incomeSources: Record<string, unknown>[];
					taxProfiles: Record<string, unknown>[];
				};
				// The backend snapshot is already normalized; re-serialize through
				// the CSV parser for diagnostics parity and defensive validation.
				return parseIncomeDataFiles({
					incomeSources: toCsv(snapshot.incomeSources),
					taxProfiles: toTaxProfileRows(snapshot.taxProfiles),
				});
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

function csvEscape(value: string | number | null): string {
	if (value === null) return "";
	const text = String(value);
	if (/[",\n]/.test(text)) return `"${text.split('"').join('""')}"`;
	return text;
}

function toCsv(rows: Record<string, unknown>[]): string {
	if (rows.length === 0)
		return "id,label,effectiveFrom,effectiveTo,annualGrossIncome\n";
	const header = Object.keys(rows[0]);
	const lines = [header.join(",")];
	for (const row of rows) {
		lines.push(header.map((key) => csvEscape(row[key] as never)).join(","));
	}
	return `${lines.join("\n")}\n`;
}

function toTaxProfileRows(rows: Record<string, unknown>[]): string {
	const header = ["id", "label", "deduction", "brackets", "sourceUrl"];
	const lines = [header.join(",")];
	for (const row of rows) {
		lines.push(
			header
				.map((key) =>
					csvEscape(
						key === "brackets" ? JSON.stringify(row[key]) : (row[key] as never),
					),
				)
				.join(","),
		);
	}
	return `${lines.join("\n")}\n`;
}
