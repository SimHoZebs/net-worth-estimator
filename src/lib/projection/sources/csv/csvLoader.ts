import Papa from "papaparse";
import type { ZodType } from "zod";
import { isGeneratedCheckpointSurrogate } from "../../model/checkpointSurrogates";
import {
	CSV_BEHAVIOR_FILE_NAMES,
	CSV_MODEL_FILE_NAMES,
	CSV_MODEL_PUBLIC_PATH,
	type FinancialModelDocument,
	type ModelFileContents,
} from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";
import { addIssue } from "../../utils/validation";
import {
	csvAccountSchema,
	csvAccountsHeaders,
	csvCheckpointSchema,
	csvCheckpointsHeaders,
	csvFinancialIndependenceRequiredHeaders,
	csvFinancialIndependenceSchema,
	csvNetWorthThresholdHeaders,
	csvNetWorthThresholdSchema,
	csvPostingFulfillmentHeaders,
	csvPostingFulfillmentSchema,
	csvPostingSchema,
	csvPostingsHeaders,
} from "./csvSchema";
import { validateCsvFinancialModel } from "./csvValidation";

export interface CsvFinancialModelParseResult {
	data: FinancialModelDocument | null;
	issues: ModelValidationIssue[];
}

export interface CsvFinancialModelOptions {
	basePath?: string;
}

interface ParsedRowsResult<TRow> {
	rows: TRow[];
	issues: ModelValidationIssue[];
	hasFatalIssue: boolean;
}

function parseRows<TRow>(
	fileName: string,
	csvText: string,
	requiredHeaders: readonly string[],
	rowSchema: ZodType<TRow>,
	allowedHeaders?: readonly string[],
): ParsedRowsResult<TRow> {
	const issues: ModelValidationIssue[] = [];
	const result = Papa.parse<Record<string, unknown>>(csvText, {
		header: true,
		skipEmptyLines: "greedy",
		transformHeader: (header) => header.trim(),
		transform: (value) => (typeof value === "string" ? value.trim() : value),
	});

	result.errors.forEach((error) => {
		addIssue(issues, "error", "csv.parse.error", error.message, [
			fileName,
			(error.row ?? 0) + 2,
		]);
	});

	const fields = result.meta.fields?.map((field) => field.trim()) ?? [];
	const missingHeaders = requiredHeaders.filter(
		(header) => !fields.includes(header),
	);

	if (missingHeaders.length > 0) {
		addIssue(
			issues,
			"error",
			"csv.headers.missing",
			`Missing required header${missingHeaders.length === 1 ? "" : "s"}: ${missingHeaders.join(", ")}.`,
			[fileName],
		);
	}
	const allowedHeaderSet = allowedHeaders ? new Set(allowedHeaders) : null;
	const unexpectedHeaders = allowedHeaderSet
		? fields.filter((header) => !allowedHeaderSet.has(header))
		: [];
	if (unexpectedHeaders.length > 0) {
		addIssue(
			issues,
			"error",
			"csv.headers.unexpected",
			`Unexpected header${unexpectedHeaders.length === 1 ? "" : "s"}: ${unexpectedHeaders.join(", ")}.`,
			[fileName],
		);
	}

	const rows: TRow[] = [];
	let hasFatalIssue =
		result.errors.length > 0 ||
		missingHeaders.length > 0 ||
		unexpectedHeaders.length > 0;

	result.data.forEach((row, index) => {
		const parsedRow = rowSchema.safeParse(row);

		if (!parsedRow.success) {
			hasFatalIssue = true;
			parsedRow.error.issues.forEach((issue) => {
				addIssue(issues, "error", "csv.row.invalid", issue.message, [
					fileName,
					index + 2,
					...issue.path.map((segment) =>
						typeof segment === "number" ? segment : String(segment),
					),
				]);
			});
			return;
		}

		rows.push(parsedRow.data);
	});

	return {
		rows,
		issues,
		hasFatalIssue,
	};
}

export function parseCsvFinancialModel(
	csvFiles: ModelFileContents,
	options: Pick<CsvFinancialModelOptions, "basePath"> = {},
): CsvFinancialModelParseResult {
	const accountsResult = parseRows(
		CSV_MODEL_FILE_NAMES.accounts,
		csvFiles.accounts,
		csvAccountsHeaders,
		csvAccountSchema,
	);
	const postingsResult = parseRows(
		CSV_MODEL_FILE_NAMES.postings,
		csvFiles.postings,
		csvPostingsHeaders,
		csvPostingSchema,
		csvPostingsHeaders,
	);
	const checkpointsResult = parseRows(
		CSV_MODEL_FILE_NAMES.checkpoints,
		csvFiles.checkpoints,
		csvCheckpointsHeaders,
		csvCheckpointSchema,
		csvCheckpointsHeaders,
	);
	const financialIndependenceResult = parseRows(
		CSV_BEHAVIOR_FILE_NAMES.financialIndependence,
		csvFiles.behaviors.financialIndependence,
		csvFinancialIndependenceRequiredHeaders,
		csvFinancialIndependenceSchema,
	);
	const netWorthThresholdResult = parseRows(
		CSV_BEHAVIOR_FILE_NAMES.netWorthThreshold,
		csvFiles.behaviors.netWorthThreshold,
		csvNetWorthThresholdHeaders,
		csvNetWorthThresholdSchema,
	);
	const postingFulfillmentResult = parseRows(
		CSV_BEHAVIOR_FILE_NAMES.postingFulfillment,
		csvFiles.behaviors.postingFulfillment,
		csvPostingFulfillmentHeaders,
		csvPostingFulfillmentSchema,
	);

	const issues = [
		...accountsResult.issues,
		...checkpointsResult.issues,
		...financialIndependenceResult.issues,
		...netWorthThresholdResult.issues,
		...postingFulfillmentResult.issues,
		...postingsResult.issues,
	];

	if (
		accountsResult.hasFatalIssue ||
		checkpointsResult.hasFatalIssue ||
		financialIndependenceResult.hasFatalIssue ||
		netWorthThresholdResult.hasFatalIssue ||
		postingFulfillmentResult.hasFatalIssue ||
		postingsResult.hasFatalIssue
	) {
		return { data: null, issues };
	}

	const evaluations = {
		financialIndependence: financialIndependenceResult.rows.map(
			({
				instanceId,
				label,
				enabled,
				annualExpenseTargetBasis,
				...config
			}) => ({
				instanceId,
				label,
				enabled,
				config: {
					...config,
					annualExpenseTargetBasis:
						annualExpenseTargetBasis || "projection-start-purchasing-power",
				},
			}),
		),
		netWorthThreshold: netWorthThresholdResult.rows.map(
			({ instanceId, label, enabled, ...config }) => ({
				instanceId,
				label,
				enabled,
				config,
			}),
		),
		postingFulfillment: postingFulfillmentResult.rows.map(
			({ instanceId, label, enabled, ...config }) => ({
				instanceId,
				label,
				enabled,
				config,
			}),
		),
	};
	const document: FinancialModelDocument = {
		sourcePath: options.basePath ?? CSV_MODEL_PUBLIC_PATH,
		accounts: accountsResult.rows,
		checkpoints: checkpointsResult.rows,
		evaluations,
		postings: postingsResult.rows.filter(
			(posting) =>
				!isGeneratedCheckpointSurrogate(posting, checkpointsResult.rows),
		),
	};

	return {
		data: document,
		issues: [...issues, ...validateCsvFinancialModel(document)],
	};
}
