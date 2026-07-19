import Papa from "papaparse";
import type { ZodType } from "zod";
import { NO_CEILING, NO_FLOOR } from "../../constants";
import {
	type BehaviorCollectionKey,
	CSV_BEHAVIOR_DEFINITION_IDS,
	CSV_BEHAVIOR_FILE_NAMES,
	CSV_SCENARIO_FILE_NAMES,
	CSV_SCENARIO_PUBLIC_PATH,
	SCENARIO_MODEL_VERSION,
	type ScenarioCollectionKey,
	type ScenarioFileContents,
	type ScenarioPack,
} from "../../types/scenario";
import type { ScenarioValidationIssue } from "../../types/validation";
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
import { validateCsvScenarioPack } from "./csvValidation";

export interface CsvScenarioParseResult {
	data: ScenarioPack | null;
	issues: ScenarioValidationIssue[];
}

export interface CsvScenarioLoadOptions {
	basePath?: string;
	fetchImpl?: typeof fetch;
}

interface ParsedRowsResult<TRow> {
	rows: TRow[];
	issues: ScenarioValidationIssue[];
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
	const issues: ScenarioValidationIssue[] = [];
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

export function parseCsvScenarioPack(
	csvFiles: ScenarioFileContents,
	options: Pick<CsvScenarioLoadOptions, "basePath"> = {},
): CsvScenarioParseResult {
	const accountsResult = parseRows(
		CSV_SCENARIO_FILE_NAMES.accounts,
		csvFiles.accounts,
		csvAccountsHeaders,
		csvAccountSchema,
	);
	const checkpointsResult = parseRows(
		CSV_SCENARIO_FILE_NAMES.checkpoints,
		csvFiles.checkpoints,
		csvCheckpointsHeaders,
		csvCheckpointSchema,
	);
	const postingsResult = parseRows(
		CSV_SCENARIO_FILE_NAMES.postings,
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
	const pack: ScenarioPack = {
		version: SCENARIO_MODEL_VERSION,
		sourcePath: options.basePath ?? CSV_SCENARIO_PUBLIC_PATH,
		accounts: accountsResult.rows,
		checkpoints: checkpointsResult.rows,
		evaluations,
		postings: postingsResult.rows,
	};

	return {
		data: pack,
		issues: [...issues, ...validateCsvScenarioPack(pack)],
	};
}

export async function fetchCsvScenarioFiles(
	options: CsvScenarioLoadOptions = {},
): Promise<ScenarioFileContents> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const basePath = normalizeBasePath(
		options.basePath ?? CSV_SCENARIO_PUBLIC_PATH,
	);

	const scenarioEntries = await Promise.all(
		(
			Object.entries(CSV_SCENARIO_FILE_NAMES) as Array<
				[ScenarioCollectionKey, string]
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

	const fileMap = Object.fromEntries(scenarioEntries) as Record<
		ScenarioCollectionKey,
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

export async function loadCsvScenarioPack(
	options: CsvScenarioLoadOptions = {},
): Promise<CsvScenarioParseResult> {
	const csvFiles = await fetchCsvScenarioFiles(options);
	return parseCsvScenarioPack(csvFiles, {
		basePath: options.basePath ?? CSV_SCENARIO_PUBLIC_PATH,
	});
}

export function serializeCsvScenarioPack(
	pack: ScenarioPack,
): ScenarioFileContents {
	const accountsHeader = "id,label,minBalance,maxBalance,color,enabled";
	const postingsHeader =
		"id,label,sourceAccountId,destinations,arithmetic,frequency,annualRate,annualGrowthRate,volatility,startDate,endDate,annualCap,priority,enabled";
	const checkpointsHeader = "Date,AccountId,Balance";
	const knownDefinitionIds = new Set<string>(
		Object.values(CSV_BEHAVIOR_DEFINITION_IDS),
	);
	const unknownEvaluation = pack.evaluations.find(
		(evaluation) => !knownDefinitionIds.has(evaluation.definitionId),
	);
	if (unknownEvaluation) {
		throw new Error(
			`Cannot serialize unknown evaluation definition '${unknownEvaluation.definitionId}'.`,
		);
	}

	const serializeBehavior = (definitionId: string) => {
		const evaluations = pack.evaluations.flatMap((evaluation, index) =>
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
				pack.accounts.map(
					(a) =>
						`${a.id},${a.label},${a.minBalance === NO_FLOOR ? "-Infinity" : a.minBalance},${a.maxBalance === NO_CEILING ? "Infinity" : a.maxBalance},${a.color ?? ""},${a.enabled}`,
				),
			)
			.join("\n"),
		postings: [postingsHeader]
			.concat(
				pack.postings.map(
					(p) =>
						`${p.id},${p.label},${p.sourceAccountId ?? ""},${p.destinations?.join(";") ?? ""},${p.arithmetic},${p.frequency},${p.annualRate},${p.annualGrowthRate},${p.volatility},${p.startDate},${p.endDate ?? ""},${p.annualCap ?? ""},${p.priority},${p.enabled}`,
				),
			)
			.join("\n"),
		checkpoints: [checkpointsHeader]
			.concat(
				pack.checkpoints.map((c) => `${c.Date},${c.AccountId},${c.Balance}`),
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
