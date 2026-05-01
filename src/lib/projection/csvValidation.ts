import { CSV_SCENARIO_FILE_NAMES } from "./csvTypes";
import type { CsvBudgetItem, CsvContributionPlan, CsvScenarioPack, CsvTransfer } from "./csvTypes";
import type { ScenarioPath, ScenarioValidationIssue, ScenarioValidationSeverity } from "./types";

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

function monthLabelToIndex(monthLabel: string): number {
  const [year, month] = monthLabel.split("-").map(Number);
  return year * 12 + (month - 1);
}

function hasInvalidDateRange(startMonth: string, endMonth: string | null): boolean {
  return endMonth !== null && monthLabelToIndex(endMonth) < monthLabelToIndex(startMonth);
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

function validateBudgetParentChains(issues: ScenarioValidationIssue[], budgetItems: CsvBudgetItem[]) {
  const budgetItemById = new Map(budgetItems.map((item, index) => [item.id, { item, rowNumber: index + 2 }]));

  budgetItems.forEach((budgetItem, index) => {
    const rowNumber = index + 2;

    if (budgetItem.amountMode === "percent_of_parent" && budgetItem.parentBudgetItemId === null) {
      addIssue(
        issues,
        "error",
        "budget.parent.required",
        "Budget items in percent_of_parent mode must set parentBudgetItemId.",
        rowPath(CSV_SCENARIO_FILE_NAMES.budgetItems, rowNumber, "parentBudgetItemId")
      );
    }

    if (budgetItem.parentBudgetItemId === null) {
      return;
    }

    const parent = budgetItemById.get(budgetItem.parentBudgetItemId);

    if (!parent) {
      addIssue(
        issues,
        "error",
        "budget.parent.missing",
        `Budget parent '${budgetItem.parentBudgetItemId}' does not exist.`,
        rowPath(CSV_SCENARIO_FILE_NAMES.budgetItems, rowNumber, "parentBudgetItemId")
      );
      return;
    }

    const visitedIds = new Set<string>([budgetItem.id]);
    let currentParentId: string | null = budgetItem.parentBudgetItemId;

    while (currentParentId !== null) {
      if (visitedIds.has(currentParentId)) {
        addIssue(
          issues,
          "error",
          "budget.parent.circular",
          `Budget parent chain for '${budgetItem.id}' is circular.`,
          rowPath(CSV_SCENARIO_FILE_NAMES.budgetItems, rowNumber, "parentBudgetItemId")
        );
        return;
      }

      visitedIds.add(currentParentId);
      currentParentId = budgetItemById.get(currentParentId)?.item.parentBudgetItemId ?? null;
    }
  });
}

function validateBudgetSchedules(issues: ScenarioValidationIssue[], budgetItems: CsvBudgetItem[]) {
  budgetItems.forEach((budgetItem, index) => {
    if (hasInvalidDateRange(budgetItem.startMonth, budgetItem.endMonth)) {
      addIssue(
        issues,
        "error",
        "budget.schedule.invalid",
        "Budget item endMonth must be the same as or later than startMonth.",
        rowPath(CSV_SCENARIO_FILE_NAMES.budgetItems, index + 2, "endMonth")
      );
    }
  });
}

function validateContributionPlans(
  issues: ScenarioValidationIssue[],
  contributionPlans: CsvContributionPlan[],
  accountIds: Set<string>,
  budgetItemIds: Set<string>
) {
  contributionPlans.forEach((plan, index) => {
    const rowNumber = index + 2;

    if (!accountIds.has(plan.targetAccountId)) {
      addIssue(
        issues,
        "error",
        "contribution.target.missing",
        `Contribution target account '${plan.targetAccountId}' does not exist.`,
        rowPath(CSV_SCENARIO_FILE_NAMES.contributionPlans, rowNumber, "targetAccountId")
      );
    }

    if (hasInvalidDateRange(plan.startMonth, plan.endMonth)) {
      addIssue(
        issues,
        "error",
        "contribution.schedule.invalid",
        "Contribution plan endMonth must be the same as or later than startMonth.",
        rowPath(CSV_SCENARIO_FILE_NAMES.contributionPlans, rowNumber, "endMonth")
      );
    }

    if (plan.calculationMode === "percent_of_budget_item") {
      if (plan.baseBudgetItemId === null) {
        addIssue(
          issues,
          "error",
          "contribution.baseBudgetItem.required",
          "Contribution plans in percent_of_budget_item mode must set baseBudgetItemId.",
          rowPath(CSV_SCENARIO_FILE_NAMES.contributionPlans, rowNumber, "baseBudgetItemId")
        );
      } else if (!budgetItemIds.has(plan.baseBudgetItemId)) {
        addIssue(
          issues,
          "error",
          "contribution.baseBudgetItem.missing",
          `Contribution base budget item '${plan.baseBudgetItemId}' does not exist.`,
          rowPath(CSV_SCENARIO_FILE_NAMES.contributionPlans, rowNumber, "baseBudgetItemId")
        );
      }
    }
  });
}

function validateTransfers(issues: ScenarioValidationIssue[], transfers: CsvTransfer[], accountIds: Set<string>) {
  transfers.forEach((transfer, index) => {
    const rowNumber = index + 2;

    if (!accountIds.has(transfer.sourceAccountId)) {
      addIssue(
        issues,
        "error",
        "transfer.source.missing",
        `Transfer source account '${transfer.sourceAccountId}' does not exist.`,
        rowPath(CSV_SCENARIO_FILE_NAMES.transfers, rowNumber, "sourceAccountId")
      );
    }

    if (!accountIds.has(transfer.destinationAccountId)) {
      addIssue(
        issues,
        "error",
        "transfer.destination.missing",
        `Transfer destination account '${transfer.destinationAccountId}' does not exist.`,
        rowPath(CSV_SCENARIO_FILE_NAMES.transfers, rowNumber, "destinationAccountId")
      );
    }

    if (transfer.sourceAccountId === transfer.destinationAccountId) {
      addIssue(
        issues,
        "error",
        "transfer.accounts.same",
        "Transfer sourceAccountId and destinationAccountId must differ.",
        rowPath(CSV_SCENARIO_FILE_NAMES.transfers, rowNumber)
      );
    }

    if (hasInvalidDateRange(transfer.startMonth, transfer.endMonth)) {
      addIssue(
        issues,
        "error",
        "transfer.schedule.invalid",
        "Transfer endMonth must be the same as or later than startMonth.",
        rowPath(CSV_SCENARIO_FILE_NAMES.transfers, rowNumber, "endMonth")
      );
    }
  });
}

export function validateCsvScenarioPack(pack: CsvScenarioPack): ScenarioValidationIssue[] {
  const issues: ScenarioValidationIssue[] = [];
  const accountIds = new Set(pack.accounts.map((account) => account.id));
  const budgetItemIds = new Set(pack.budgetItems.map((budgetItem) => budgetItem.id));

  if (pack.scenario.horizonMonths < 1) {
    addIssue(
      issues,
      "error",
      "scenario.horizon.invalid",
      "Scenario horizonMonths must be at least 1.",
      rowPath(CSV_SCENARIO_FILE_NAMES.scenario, 2, "horizonMonths")
    );
  }

  validateUniqueIds(issues, CSV_SCENARIO_FILE_NAMES.accounts, "account.id", pack.accounts);
  validateUniqueIds(issues, CSV_SCENARIO_FILE_NAMES.budgetItems, "budget.id", pack.budgetItems);
  validateUniqueIds(issues, CSV_SCENARIO_FILE_NAMES.contributionPlans, "contribution.id", pack.contributionPlans);
  validateUniqueIds(issues, CSV_SCENARIO_FILE_NAMES.transfers, "transfer.id", pack.transfers);

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

  validateBudgetParentChains(issues, pack.budgetItems);
  validateBudgetSchedules(issues, pack.budgetItems);
  validateContributionPlans(issues, pack.contributionPlans, accountIds, budgetItemIds);
  validateTransfers(issues, pack.transfers, accountIds);

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
