import Papa from "papaparse";
import { z } from "zod";
import type { IncomeDataLoadResult, IncomeDataSource } from "../../incomeData";
import {
	INCOME_DATA_FILE_NAMES,
	INCOME_DATA_PUBLIC_PATH,
	type IncomeDataSnapshot,
	type IncomeSourceDefinition,
	type IncomeTaxProfile,
} from "../../types/income";
import type { ModelValidationIssue } from "../../types/validation";

const incomeSourceHeaders = [
	"id",
	"label",
	"effectiveFrom",
	"effectiveTo",
	"annualGrossIncome",
] as const;
const taxProfileHeaders = [
	"id",
	"label",
	"deduction",
	"brackets",
	"sourceUrl",
] as const;

const dateSchema = z
	.string()
	.trim()
	.regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u)
	.refine((value) => {
		const [year, month, day] = value.split("-").map(Number);
		const date = new Date(Date.UTC(year!, month! - 1, day!));
		return (
			date.getUTCFullYear() === year &&
			date.getUTCMonth() === month! - 1 &&
			date.getUTCDate() === day
		);
	}, "Expected a valid date.");
const incomeSourceSchema = z.object({
	id: z.string().trim().min(1),
	label: z.string().trim().min(1),
	effectiveFrom: dateSchema,
	effectiveTo: z.preprocess(
		(value) =>
			typeof value === "string" && value.trim() === "" ? null : value,
		dateSchema.nullable(),
	),
	annualGrossIncome: z.coerce.number().finite().positive(),
});
const taxProfileSchema = z.object({
	id: z.string().trim().min(1),
	label: z.string().trim().min(1),
	deduction: z.coerce.number().finite().min(0),
	brackets: z.preprocess(
		parseJson,
		z.array(
			z.object({
				upTo: z.number().finite().nullable(),
				rate: z.number().finite().min(0).max(1),
			}),
		),
	),
	sourceUrl: z.preprocess(
		(value) =>
			typeof value === "string" && value.trim() === "" ? null : value,
		z.string().url().nullable(),
	),
});

function parseJson(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

function parseRows<T>(
	fileName: string,
	text: string,
	headers: readonly string[],
	schema: z.ZodType<T>,
): { rows: T[]; issues: ModelValidationIssue[] } {
	const issues: ModelValidationIssue[] = [];
	const parsed = Papa.parse<Record<string, unknown>>(text, {
		header: true,
		skipEmptyLines: "greedy",
		transformHeader: (header) => header.trim(),
		transform: (value) => (typeof value === "string" ? value.trim() : value),
	});
	const fields = parsed.meta.fields ?? [];
	for (const header of headers) {
		if (!fields.includes(header)) {
			issues.push({
				severity: "error",
				code: "income-data.header.missing",
				message: `Missing required header '${header}'.`,
				path: [fileName],
			});
		}
	}
	for (const error of parsed.errors) {
		issues.push({
			severity: "error",
			code: "income-data.csv.invalid",
			message: error.message,
			path: [fileName, (error.row ?? 0) + 2],
		});
	}
	const rows: T[] = [];
	parsed.data.forEach((row, index) => {
		const result = schema.safeParse(row);
		if (!result.success) {
			for (const issue of result.error.issues) {
				issues.push({
					severity: "error",
					code: "income-data.row.invalid",
					message: issue.message,
					path: [fileName, index + 2, ...issue.path.map(String)],
				});
			}
			return;
		}
		rows.push(result.data);
	});
	return { rows, issues };
}

function validateSnapshot(
	incomeSources: IncomeSourceDefinition[],
	taxProfiles: IncomeTaxProfile[],
	issues: ModelValidationIssue[],
): IncomeDataSnapshot | null {
	const sourcesById = new Map<string, IncomeSourceDefinition[]>();
	for (const source of incomeSources) {
		const sources = sourcesById.get(source.id) ?? [];
		sources.push(source);
		sourcesById.set(source.id, sources);
		if (
			source.effectiveTo !== null &&
			source.effectiveTo < source.effectiveFrom
		) {
			issues.push({
				severity: "error",
				code: "income-data.source.date-range",
				message: `Income source '${source.id}' has an invalid effective date range.`,
				path: [INCOME_DATA_FILE_NAMES.incomeSources],
			});
		}
	}
	for (const [id, sources] of sourcesById) {
		const ordered = [...sources].sort((left, right) =>
			left.effectiveFrom.localeCompare(right.effectiveFrom),
		);
		for (let index = 1; index < ordered.length; index += 1) {
			const previous = ordered[index - 1]!;
			const current = ordered[index]!;
			if (
				previous.effectiveTo === null ||
				current.effectiveFrom <= previous.effectiveTo
			) {
				issues.push({
					severity: "error",
					code: "income-data.source.overlap",
					message: `Income source '${id}' has overlapping effective date ranges.`,
					path: [INCOME_DATA_FILE_NAMES.incomeSources],
				});
				break;
			}
		}
	}
	const taxIds = new Set<string>();
	for (const profile of taxProfiles) {
		if (taxIds.has(profile.id)) {
			issues.push({
				severity: "error",
				code: "income-data.tax-profile.duplicate",
				message: `Tax profile '${profile.id}' is duplicated.`,
				path: [INCOME_DATA_FILE_NAMES.taxProfiles],
			});
		}
		taxIds.add(profile.id);
		if (
			profile.brackets.length === 0 ||
			profile.brackets[profile.brackets.length - 1]?.upTo !== null
		) {
			issues.push({
				severity: "error",
				code: "income-data.tax-profile.brackets",
				message: `Tax profile '${profile.id}' must end with an open-ended bracket.`,
				path: [INCOME_DATA_FILE_NAMES.taxProfiles],
			});
		}
		let previous = 0;
		for (const [index, bracket] of profile.brackets.entries()) {
			if (bracket.upTo === null && index !== profile.brackets.length - 1) {
				issues.push({
					severity: "error",
					code: "income-data.tax-profile.brackets",
					message: `Tax profile '${profile.id}' may only have an open-ended final bracket.`,
					path: [INCOME_DATA_FILE_NAMES.taxProfiles],
				});
				break;
			}
			if (bracket.upTo !== null && bracket.upTo <= previous) {
				issues.push({
					severity: "error",
					code: "income-data.tax-profile.order",
					message: `Tax profile '${profile.id}' bracket limits must be ascending.`,
					path: [INCOME_DATA_FILE_NAMES.taxProfiles],
				});
				break;
			}
			if (bracket.upTo !== null) previous = bracket.upTo;
		}
	}
	return issues.some((issue) => issue.severity === "error")
		? null
		: {
				incomeSources: [...incomeSources].sort(
					(left, right) =>
						left.id.localeCompare(right.id) ||
						left.effectiveFrom.localeCompare(right.effectiveFrom),
				),
				taxProfiles: [...taxProfiles].sort((left, right) =>
					left.id.localeCompare(right.id),
				),
			};
}

export function parseIncomeDataFiles(files: {
	incomeSources: string;
	taxProfiles: string;
}): IncomeDataLoadResult {
	const incomeResult = parseRows(
		INCOME_DATA_FILE_NAMES.incomeSources,
		files.incomeSources,
		incomeSourceHeaders,
		incomeSourceSchema,
	);
	const taxResult = parseRows(
		INCOME_DATA_FILE_NAMES.taxProfiles,
		files.taxProfiles,
		taxProfileHeaders,
		taxProfileSchema,
	);
	const issues = [...incomeResult.issues, ...taxResult.issues];
	const data = validateSnapshot(
		incomeResult.rows,
		taxResult.rows as IncomeTaxProfile[],
		issues,
	);
	return { data, issues };
}

export interface CsvIncomeDataSourceOptions {
	basePath?: string;
	fetchImpl?: typeof fetch;
}

export function createCsvIncomeDataSource(
	options: CsvIncomeDataSourceOptions = {},
): IncomeDataSource {
	const basePath = (options.basePath ?? INCOME_DATA_PUBLIC_PATH).replace(
		/\/$/u,
		"",
	);
	const fetchImpl = options.fetchImpl ?? fetch;
	const loadFile = async (fileName: string) => {
		const response = await fetchImpl(`${basePath}/${fileName}`);
		if (!response.ok) {
			throw new Error(
				`Could not load ${fileName} from ${basePath} (${response.status} ${response.statusText}).`,
			);
		}
		return response.text();
	};
	return {
		sourceType: "csv-income-data",
		label: "Income data",
		description:
			"Loads income definitions and tax profiles from CSV data files.",
		load: async () => {
			try {
				const [incomeSources, taxProfiles] = await Promise.all([
					loadFile(INCOME_DATA_FILE_NAMES.incomeSources),
					loadFile(INCOME_DATA_FILE_NAMES.taxProfiles),
				]);
				return parseIncomeDataFiles({ incomeSources, taxProfiles });
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
