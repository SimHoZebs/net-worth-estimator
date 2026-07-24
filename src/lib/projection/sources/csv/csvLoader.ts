import Papa from "papaparse";
import type { ZodType } from "zod";
import { NO_CEILING, NO_FLOOR } from "../../constants";
import {
	type BehaviorCollectionKey,
	CSV_BEHAVIOR_DEFINITION_IDS,
	CSV_BEHAVIOR_FILE_NAMES,
	CSV_MODEL_FILE_NAMES,
	CSV_MODEL_PUBLIC_PATH,
	FINANCIAL_MODEL_DOCUMENT_VERSION,
	type FinancialModelDocument,
	type ModelCollectionKey,
	type ModelFileContents,
} from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";
import { addIssue } from "../../utils/validation";
import {
	type CsvBehaviorRow,
	csvAccountSchema,
	csvAccountsHeaders,
	csvBehaviorHeaders,
	csvBehaviorSchema,
	csvCheckpointSchema,
	csvCheckpointsHeaders,
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
	fetchImpl?: typeof fetch;
}

interface ParsedRowsResult<TRow> {
	rows: TRow[];
	issues: ModelValidationIssue[];
	hasFatalIssue: boolean;
}

function normalizeBasePath(basePath: string): string {
	return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
}

function parseRows<TRow>(
	fileName: string,
	csvText: string,
	requiredHeaders: readonly string[],
	rowSchema: ZodType<TRow>,
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

	const rows: TRow[] = [];
	let hasFatalIssue = result.errors.length > 0 || missingHeaders.length > 0;

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
	const checkpointsResult = parseRows(
		CSV_MODEL_FILE_NAMES.checkpoints,
		csvFiles.checkpoints,
		csvCheckpointsHeaders,
		csvCheckpointSchema,
	);
	const postingsResult = parseRows(
		CSV_MODEL_FILE_NAMES.postings,
		csvFiles.postings,
		csvPostingsHeaders,
		csvPostingSchema,
	);
	const behaviorResults = (
		Object.keys(CSV_BEHAVIOR_FILE_NAMES) as BehaviorCollectionKey[]
	).map((key) => ({
		definitionId: CSV_BEHAVIOR_DEFINITION_IDS[key],
		fileName: CSV_BEHAVIOR_FILE_NAMES[key],
		result: parseRows(
			CSV_BEHAVIOR_FILE_NAMES[key],
			csvFiles.behaviors[key],
			csvBehaviorHeaders,
			csvBehaviorSchema,
		),
	}));

	const issues = [
		...accountsResult.issues,
		...checkpointsResult.issues,
		...behaviorResults.flatMap(({ result }) => result.issues),
		...postingsResult.issues,
	];
	const firstOrderLocation = new Map<
		number,
		{ fileName: string; rowNumber: number }
	>();
	behaviorResults.forEach(({ fileName, result }) => {
		result.rows.forEach((row, rowIndex) => {
			const firstSeen = firstOrderLocation.get(row.order);
			if (firstSeen) {
				addIssue(
					issues,
					"error",
					"behavior.order.duplicate",
					`Order '${row.order}' is duplicated. First seen in ${firstSeen.fileName} on row ${firstSeen.rowNumber}.`,
					[fileName, rowIndex + 2, "order"],
				);
				return;
			}
			firstOrderLocation.set(row.order, { fileName, rowNumber: rowIndex + 2 });
		});
	});

	if (
		accountsResult.hasFatalIssue ||
		checkpointsResult.hasFatalIssue ||
		behaviorResults.some(({ result }) => result.hasFatalIssue) ||
		postingsResult.hasFatalIssue
	) {
		return { data: null, issues };
	}

	const evaluations = behaviorResults
		.flatMap(({ definitionId, result }) =>
			result.rows.map(({ order, ...evaluation }) => ({
				definitionId,
				evaluation,
				order,
			})),
		)
		.sort((a, b) => a.order - b.order)
		.map(({ evaluation, definitionId }) => ({ ...evaluation, definitionId }));
	const document: FinancialModelDocument = {
		version: FINANCIAL_MODEL_DOCUMENT_VERSION,
		sourcePath: options.basePath ?? CSV_MODEL_PUBLIC_PATH,
		accounts: accountsResult.rows,
		checkpoints: checkpointsResult.rows,
		evaluations,
		postings: postingsResult.rows,
	};

	return {
		data: document,
		issues: [...issues, ...validateCsvFinancialModel(document)],
	};
}

export async function fetchCsvFinancialModelFiles(
	options: CsvFinancialModelOptions = {},
): Promise<ModelFileContents> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const basePath = normalizeBasePath(options.basePath ?? CSV_MODEL_PUBLIC_PATH);

	const modelEntries = await Promise.all(
		(
			Object.entries(CSV_MODEL_FILE_NAMES) as Array<
				[ModelCollectionKey, string]
			>
		).map(async ([key, fileName]) => {
			const response = await fetchImpl(`${basePath}/${fileName}`);

			if (!response.ok) {
				throw new Error(
					`Could not load ${fileName} from ${basePath} (${response.status} ${response.statusText}).`,
				);
			}

			return [key, await response.text()] as const;
		}),
	);
	const behaviorEntries = await Promise.all(
		(
			Object.entries(CSV_BEHAVIOR_FILE_NAMES) as Array<
				[BehaviorCollectionKey, string]
			>
		).map(async ([key, fileName]) => {
			const response = await fetchImpl(`${basePath}/${fileName}`);

			if (!response.ok) {
				throw new Error(
					`Could not load ${fileName} from ${basePath} (${response.status} ${response.statusText}).`,
				);
			}

			return [key, await response.text()] as const;
		}),
	);

	const fileMap = Object.fromEntries(modelEntries) as Record<
		ModelCollectionKey,
		string
	>;
	const behaviorFileMap = Object.fromEntries(behaviorEntries) as Record<
		BehaviorCollectionKey,
		string
	>;

	return {
		accounts: fileMap.accounts,
		checkpoints: fileMap.checkpoints,
		behaviors: behaviorFileMap,
		postings: fileMap.postings,
	};
}

export async function loadCsvFinancialModel(
	options: CsvFinancialModelOptions = {},
): Promise<CsvFinancialModelParseResult> {
	const csvFiles = await fetchCsvFinancialModelFiles(options);
	return parseCsvFinancialModel(csvFiles, {
		basePath: options.basePath ?? CSV_MODEL_PUBLIC_PATH,
	});
}

export function serializeCsvFinancialModel(
	document: FinancialModelDocument,
): ModelFileContents {
	const accountsHeader = "id,label,minBalance,maxBalance,color,enabled";
	const postingsHeader =
		"id,label,sourceAccountId,destinations,arithmetic,frequency,annualRate,annualGrowthRate,volatility,startDate,endDate,annualCap,priority,enabled";
	const checkpointsHeader = "Date,AccountId,Balance";
	const knownDefinitionIds = new Set<string>(
		Object.values(CSV_BEHAVIOR_DEFINITION_IDS),
	);
	const unknownEvaluation = document.evaluations.find(
		(evaluation) => !knownDefinitionIds.has(evaluation.definitionId),
	);
	if (unknownEvaluation) {
		throw new Error(
			`Cannot serialize unknown evaluation definition '${unknownEvaluation.definitionId}'.`,
		);
	}

	const serializeBehavior = (definitionId: string) => {
		const evaluations = document.evaluations.flatMap((evaluation, index) =>
			evaluation.definitionId === definitionId
				? [{ evaluation, order: index + 1 }]
				: [],
		);
		if (evaluations.length === 0) return csvBehaviorHeaders.join(",");

		return Papa.unparse(
			evaluations.map(
				({
					evaluation: { instanceId, label, enabled, config },
					order,
				}): CsvBehaviorRow => ({
					order,
					instanceId,
					label,
					enabled,
					config: JSON.stringify(config),
				}),
			),
			{ columns: [...csvBehaviorHeaders], newline: "\n" },
		);
	};

	return {
		accounts: [accountsHeader]
			.concat(
				document.accounts.map(
					(a) =>
						`${a.id},${a.label},${a.minBalance === NO_FLOOR ? "-Infinity" : a.minBalance},${a.maxBalance === NO_CEILING ? "Infinity" : a.maxBalance},${a.color ?? ""},${a.enabled}`,
				),
			)
			.join("\n"),
		postings: [postingsHeader]
			.concat(
				document.postings.map(
					(p) =>
						`${p.id},${p.label},${p.sourceAccountId ?? ""},${p.destinations?.join(";") ?? ""},${p.arithmetic},${p.frequency},${p.annualRate},${p.annualGrowthRate},${p.volatility},${p.startDate},${p.endDate ?? ""},${p.annualCap ?? ""},${p.priority},${p.enabled}`,
				),
			)
			.join("\n"),
		checkpoints: [checkpointsHeader]
			.concat(
				document.checkpoints.map(
					(c) => `${c.Date},${c.AccountId},${c.Balance}`,
				),
			)
			.join("\n"),
		behaviors: Object.fromEntries(
			(
				Object.entries(CSV_BEHAVIOR_DEFINITION_IDS) as Array<
					[BehaviorCollectionKey, string]
				>
			).map(([key, definitionId]) => [key, serializeBehavior(definitionId)]),
		) as Record<BehaviorCollectionKey, string>,
	};
}

/**
 * @deprecated Use CsvFinancialModelParseResult. Remove after downstream
 * consumers migrate to the canonical API and the compatibility window closes.
 */
export type CsvScenarioParseResult = CsvFinancialModelParseResult;
/**
 * @deprecated Use CsvFinancialModelOptions. Remove after downstream consumers
 * migrate to the canonical API and the compatibility window closes.
 */
export type CsvScenarioLoadOptions = CsvFinancialModelOptions;
/**
 * @deprecated Use parseCsvFinancialModel. Remove after downstream consumers
 * migrate to the canonical API and the compatibility window closes.
 */
export const parseCsvScenarioPack = parseCsvFinancialModel;
/**
 * @deprecated Use fetchCsvFinancialModelFiles. Remove after downstream consumers
 * migrate to the canonical API and the compatibility window closes.
 */
export const fetchCsvScenarioFiles = fetchCsvFinancialModelFiles;
/**
 * @deprecated Use loadCsvFinancialModel. Remove after downstream consumers
 * migrate to the canonical API and the compatibility window closes.
 */
export const loadCsvScenarioPack = loadCsvFinancialModel;
/**
 * @deprecated Use serializeCsvFinancialModel. Remove after downstream consumers
 * migrate to the canonical API and the compatibility window closes.
 */
export const serializeCsvScenarioPack = serializeCsvFinancialModel;
