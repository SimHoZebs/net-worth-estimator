import Papa from "papaparse";
import type { ZodType } from "zod";
import {
  csvAccountSchema,
  csvAccountsHeaders,
  csvBudgetItemSchema,
  csvBudgetItemsHeaders,
  csvCheckpointSchema,
  csvCheckpointsHeaders,
  csvContributionPlanSchema,
  csvContributionPlansHeaders,
  csvScenarioSettingsSchema,
  csvScenarioHeaders,
  csvTransferSchema,
  csvTransfersHeaders,
} from "./csvSchema";
import {
  CSV_SCENARIO_FILE_NAMES,
  CSV_SCENARIO_MODEL_VERSION,
  CSV_SCENARIO_PUBLIC_PATH,
  type CsvAccount,
  type CsvBudgetItem,
  type CsvCheckpoint,
  type CsvContributionPlan,
  type CsvScenarioCollectionKey,
  type CsvScenarioFileContents,
  type CsvScenarioPack,
  type CsvScenarioSettings,
  type CsvTransfer,
} from "./csvTypes";
import { validateCsvScenarioPack } from "./csvValidation";
import type { ScenarioPath, ScenarioValidationIssue } from "./validationTypes";

export interface CsvScenarioParseResult {
  data: CsvScenarioPack | null;
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

function addIssue(
  issues: ScenarioValidationIssue[],
  code: string,
  message: string,
  path: ScenarioPath
) {
  issues.push({ severity: "error", code, message, path });
}

function parseRows<TRow>(
  fileName: string,
  csvText: string,
  requiredHeaders: readonly string[],
  rowSchema: ZodType<TRow>
): ParsedRowsResult<TRow> {
  const issues: ScenarioValidationIssue[] = [];
  const result = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  result.errors.forEach((error) => {
    addIssue(issues, "csv.parse.error", error.message, [fileName, (error.row ?? 0) + 2]);
  });

  const fields = result.meta.fields?.map((field) => field.trim()) ?? [];
  const missingHeaders = requiredHeaders.filter((header) => !fields.includes(header));

  if (missingHeaders.length > 0) {
    addIssue(
      issues,
      "csv.headers.missing",
      `Missing required header${missingHeaders.length === 1 ? "" : "s"}: ${missingHeaders.join(", ")}.`,
      [fileName]
    );
  }

  const rows: TRow[] = [];
  let hasFatalIssue = result.errors.length > 0 || missingHeaders.length > 0;

  result.data.forEach((row, index) => {
    const parsedRow = rowSchema.safeParse(row);

    if (!parsedRow.success) {
      hasFatalIssue = true;
      parsedRow.error.issues.forEach((issue) => {
        addIssue(
          issues,
          "csv.row.invalid",
          issue.message,
          [fileName, index + 2, ...issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment)))]
        );
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

function parseScenarioSettings(csvText: string) {
  const result = parseRows(CSV_SCENARIO_FILE_NAMES.scenario, csvText, csvScenarioHeaders, csvScenarioSettingsSchema);
  let scenario: CsvScenarioSettings | null = null;

  if (result.rows.length === 0) {
    addIssue(
      result.issues,
      "csv.scenario.rowCount.invalid",
      "scenario.csv must contain exactly one data row.",
      [CSV_SCENARIO_FILE_NAMES.scenario]
    );
    result.hasFatalIssue = true;
  } else {
    scenario = result.rows[0];

    if (result.rows.length > 1) {
      addIssue(
        result.issues,
        "csv.scenario.rowCount.invalid",
        "scenario.csv must contain exactly one data row.",
        [CSV_SCENARIO_FILE_NAMES.scenario]
      );
      result.hasFatalIssue = true;
    }
  }

  return {
    scenario,
    issues: result.issues,
    hasFatalIssue: result.hasFatalIssue,
  };
}

export function parseCsvScenarioPack(
  csvFiles: CsvScenarioFileContents,
  options: Pick<CsvScenarioLoadOptions, "basePath"> = {}
): CsvScenarioParseResult {
  const scenarioResult = parseScenarioSettings(csvFiles.scenario);
  const accountsResult = parseRows(CSV_SCENARIO_FILE_NAMES.accounts, csvFiles.accounts, csvAccountsHeaders, csvAccountSchema);
  const checkpointsResult = parseRows(CSV_SCENARIO_FILE_NAMES.checkpoints, csvFiles.checkpoints, csvCheckpointsHeaders, csvCheckpointSchema);
  const budgetItemsResult = parseRows(CSV_SCENARIO_FILE_NAMES.budgetItems, csvFiles.budgetItems, csvBudgetItemsHeaders, csvBudgetItemSchema);
  const contributionPlansResult = parseRows(
    CSV_SCENARIO_FILE_NAMES.contributionPlans,
    csvFiles.contributionPlans,
    csvContributionPlansHeaders,
    csvContributionPlanSchema
  );
  const transfersResult = parseRows(CSV_SCENARIO_FILE_NAMES.transfers, csvFiles.transfers, csvTransfersHeaders, csvTransferSchema);

  const issues = [
    ...scenarioResult.issues,
    ...accountsResult.issues,
    ...checkpointsResult.issues,
    ...budgetItemsResult.issues,
    ...contributionPlansResult.issues,
    ...transfersResult.issues,
  ];

  if (
    scenarioResult.hasFatalIssue ||
    accountsResult.hasFatalIssue ||
    checkpointsResult.hasFatalIssue ||
    budgetItemsResult.hasFatalIssue ||
    contributionPlansResult.hasFatalIssue ||
    transfersResult.hasFatalIssue ||
    scenarioResult.scenario === null
  ) {
    return { data: null, issues };
  }

  const pack: CsvScenarioPack = {
    version: CSV_SCENARIO_MODEL_VERSION,
    sourcePath: options.basePath ?? CSV_SCENARIO_PUBLIC_PATH,
    scenario: scenarioResult.scenario,
    accounts: accountsResult.rows,
    checkpoints: checkpointsResult.rows,
    budgetItems: budgetItemsResult.rows,
    contributionPlans: contributionPlansResult.rows,
    transfers: transfersResult.rows,
  };

  return {
    data: pack,
    issues: [...issues, ...validateCsvScenarioPack(pack)],
  };
}

export async function fetchCsvScenarioFiles(options: CsvScenarioLoadOptions = {}): Promise<CsvScenarioFileContents> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const basePath = normalizeBasePath(options.basePath ?? CSV_SCENARIO_PUBLIC_PATH);

  const entries = await Promise.all(
    (Object.entries(CSV_SCENARIO_FILE_NAMES) as Array<[CsvScenarioCollectionKey, string]>).map(async ([key, fileName]) => {
      const response = await fetchImpl(`${basePath}/${fileName}`);

      if (!response.ok) {
        throw new Error(`Could not load ${fileName} from ${basePath} (${response.status} ${response.statusText}).`);
      }

      return [key, await response.text()] as const;
    })
  );

  const fileMap = Object.fromEntries(entries) as Record<CsvScenarioCollectionKey, string>;

  return {
    scenario: fileMap.scenario,
    accounts: fileMap.accounts,
    checkpoints: fileMap.checkpoints,
    budgetItems: fileMap.budgetItems,
    contributionPlans: fileMap.contributionPlans,
    transfers: fileMap.transfers,
  };
}

export async function loadCsvScenarioPack(options: CsvScenarioLoadOptions = {}): Promise<CsvScenarioParseResult> {
  const csvFiles = await fetchCsvScenarioFiles(options);
  return parseCsvScenarioPack(csvFiles, { basePath: options.basePath ?? CSV_SCENARIO_PUBLIC_PATH });
}
