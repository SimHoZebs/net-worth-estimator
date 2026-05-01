import { CSV_SCENARIO_FILE_NAMES } from "./csvTypes";
import type { CsvPosting, CsvScenarioPack } from "./csvTypes";
import type { ScenarioPath, ScenarioValidationIssue, ScenarioValidationSeverity } from "./validationTypes";

function addIssue(
  issues: ScenarioValidationIssue[],
  severity: ScenarioValidationSeverity,
  code: string,
  message: string,
  path: ScenarioPath
) {
  issues.push({ severity, code, message, path });
}

function rowPath(fileName: string, rowNumber?: number, field?: string): ScenarioPath {
  const path: Array<string | number> = [fileName];

  if (rowNumber !== undefined) {
    path.push(rowNumber);
  }

  if (field !== undefined) {
    path.push(field);
  }

  return path;
}

function hasInvalidDateRange(startDate: string, endDate: string | null): boolean {
  return endDate !== null && Date.parse(endDate) < Date.parse(startDate);
}

function validateUniqueIds(
  issues: ScenarioValidationIssue[],
  fileName: string,
  codePrefix: string,
  rows: Array<{ id: string }>
) {
  const firstSeenRowById = new Map<string, number>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const firstSeenRow = firstSeenRowById.get(row.id);

    if (firstSeenRow !== undefined) {
      addIssue(
        issues,
        "error",
        `${codePrefix}.duplicate`,
        `ID '${row.id}' is duplicated. First seen on row ${firstSeenRow}.`,
        rowPath(fileName, rowNumber, "id")
      );
      return;
    }

    firstSeenRowById.set(row.id, rowNumber);
  });
}

function validatePostingBaseChains(issues: ScenarioValidationIssue[], postings: CsvPosting[], accountIds: Set<string>) {
  const postingById = new Map(postings.map((posting) => [posting.id, posting]));

  postings.forEach((posting, index) => {
    const rowNumber = index + 2;

    if (posting.amountMode === "percent_of_base" && posting.basePostingId === null) {
      addIssue(
        issues,
        "error",
        "posting.base.required",
        "Postings in percent_of_base mode must set basePostingId.",
        rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber, "basePostingId")
      );
    }

    if (posting.amountMode === "fixed" && posting.basePostingId !== null) {
      addIssue(
        issues,
        "error",
        "posting.base.unexpected",
        "Postings in fixed mode must leave basePostingId blank.",
        rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber, "basePostingId")
      );
    }

    if (posting.basePostingId === null) {
      return;
    }

    if (accountIds.has(posting.basePostingId)) {
      return;
    }

    if (!postingById.has(posting.basePostingId)) {
      addIssue(
        issues,
        "error",
        "posting.base.missing",
        `Base posting '${posting.basePostingId}' does not exist.`,
        rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber, "basePostingId")
      );
      return;
    }

    const visitedIds = new Set<string>([posting.id]);
    let currentBaseId: string | null = posting.basePostingId;

    while (currentBaseId !== null) {
      if (accountIds.has(currentBaseId)) {
        break;
      }

      if (visitedIds.has(currentBaseId)) {
        addIssue(
          issues,
          "error",
          "posting.base.circular",
          `Base posting chain for '${posting.id}' is circular.`,
          rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber, "basePostingId")
        );
        return;
      }

      visitedIds.add(currentBaseId);
      currentBaseId = postingById.get(currentBaseId)?.basePostingId ?? null;
    }
  });
}

function validatePostings(issues: ScenarioValidationIssue[], postings: CsvPosting[], accountIds: Set<string>) {
  postings.forEach((posting, index) => {
    const rowNumber = index + 2;

    if (posting.sourceAccountId !== null && !accountIds.has(posting.sourceAccountId)) {
      addIssue(
        issues,
        "error",
        "posting.source.missing",
        `Posting source account '${posting.sourceAccountId}' does not exist.`,
        rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber, "sourceAccountId")
      );
    }

    if (posting.destinations !== null) {
      const seenIds = new Set<string>();

      posting.destinations.forEach((destinationId, destIndex) => {
        if (!accountIds.has(destinationId)) {
          addIssue(
            issues,
            "error",
            "posting.destination.missing",
            `Posting destination account '${destinationId}' does not exist.`,
            rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber, "destinations")
          );
        }

        if (seenIds.has(destinationId)) {
          addIssue(
            issues,
            "error",
            "posting.destinations.duplicate",
            `Destination account '${destinationId}' appears more than once.`,
            rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber, "destinations")
          );
        }

        seenIds.add(destinationId);
      });
    }

    if (posting.sourceAccountId === null && posting.destinations === null) {
      addIssue(
        issues,
        "error",
        "posting.accounts.empty",
        "Postings must set sourceAccountId, destinations, or both.",
        rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber)
      );
    }

    if (
      posting.sourceAccountId !== null &&
      posting.destinations !== null &&
      posting.destinations.includes(posting.sourceAccountId)
    ) {
      addIssue(
        issues,
        "error",
        "posting.accounts.same",
        "Posting sourceAccountId must not appear in destinations.",
        rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber)
      );
    }

    if (hasInvalidDateRange(posting.startDate, posting.endDate)) {
      addIssue(
        issues,
        "error",
        "posting.schedule.invalid",
        "Posting endDate must be the same as or later than startDate.",
        rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber, "endDate")
      );
    }
  });
}

export function validateCsvScenarioPack(pack: CsvScenarioPack): ScenarioValidationIssue[] {
  const issues: ScenarioValidationIssue[] = [];
  const accountIds = new Set(pack.accounts.map((account) => account.id));
  const postingIds = new Set(pack.postings.map((posting) => posting.id));

  validateUniqueIds(issues, CSV_SCENARIO_FILE_NAMES.accounts, "account.id", pack.accounts);
  validateUniqueIds(issues, CSV_SCENARIO_FILE_NAMES.postings, "posting.id", pack.postings);

  pack.accounts.forEach((account, index) => {
    if (postingIds.has(account.id)) {
      addIssue(
        issues,
        "error",
        "account.id.collision",
        `Account ID '${account.id}' collides with a posting ID. IDs must be unique across accounts and postings.`,
        rowPath(CSV_SCENARIO_FILE_NAMES.accounts, index + 2, "id")
      );
    }
  });

  pack.checkpoints.forEach((checkpoint, index) => {
    if (!accountIds.has(checkpoint.AccountId)) {
      addIssue(
        issues,
        "error",
        "checkpoint.account.missing",
        `Checkpoint account '${checkpoint.AccountId}' does not exist.`,
        rowPath(CSV_SCENARIO_FILE_NAMES.checkpoints, index + 2, "AccountId")
      );
    }
  });

  validatePostingBaseChains(issues, pack.postings, accountIds);
  validatePostings(issues, pack.postings, accountIds);

  pack.accounts.forEach((account, index) => {
    if (account.minBalance !== null && account.maxBalance !== null && account.minBalance > account.maxBalance) {
      addIssue(
        issues,
        "error",
        "account.balance.bounds",
        `minBalance (${account.minBalance}) must not exceed maxBalance (${account.maxBalance}).`,
        rowPath(CSV_SCENARIO_FILE_NAMES.accounts, index + 2)
      );
    }
  });

  return issues;
}

export function summarizeValidationIssues(issues: ScenarioValidationIssue[]) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return {
    issues,
    errors,
    warnings,
    isValid: errors.length === 0,
  };
}
