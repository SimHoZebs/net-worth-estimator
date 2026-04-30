import { getBuiltInModuleDefinition, getBuiltInModulePlugin, isSingletonBuiltInModuleType } from "./modules";
import type {
  ScenarioAccountDefinition,
  ScenarioDefinition,
  ScenarioModule,
  ScenarioValidationIssue,
  ScenarioValidationSeverity,
} from "./types";

function addIssue(
  issues: ScenarioValidationIssue[],
  severity: ScenarioValidationSeverity,
  code: string,
  message: string,
  path: ScenarioValidationIssue["path"]
) {
  issues.push({ severity, code, message, path });
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function buildAccountMap(accounts: ScenarioDefinition["accounts"]): Map<string, ScenarioAccountDefinition> {
  return new Map(accounts.map((account) => [account.id, account]));
}

export function validateScenario(scenario: ScenarioDefinition): ScenarioValidationIssue[] {
  const issues: ScenarioValidationIssue[] = [];
  const accountMap = buildAccountMap(scenario.accounts);
  const cashAccounts = scenario.accounts.filter((account) => account.kind === "cash");
  const moduleTypeCounts = new Map<string, number>();
  const accountIdCounts = new Map<string, number>();
  const moduleIdCounts = new Map<string, number>();
  const policyIdCounts = new Map<string, number>();

  if (!isNonEmptyString(scenario.name)) {
    addIssue(issues, "warning", "scenario.name.empty", "Scenario name is empty.", ["name"]);
  }

  if (!Number.isFinite(scenario.horizonMonths) || scenario.horizonMonths < 1) {
    addIssue(issues, "error", "scenario.horizon.invalid", "Projection months must be at least 1.", ["horizonMonths"]);
  }

  if (!Number.isFinite(scenario.targetNetWorth) || scenario.targetNetWorth < 0) {
    addIssue(issues, "error", "scenario.target.invalid", "Target net worth must be zero or greater.", ["targetNetWorth"]);
  }

  if (cashAccounts.length === 0) {
    addIssue(issues, "error", "scenario.cash.missing", "At least one cash account is required.", ["accounts"]);
  }

  if (cashAccounts.length > 1) {
    addIssue(issues, "warning", "scenario.cash.multiple", "Multiple cash accounts are present. Allocation policies may be harder to reason about.", ["accounts"]);
  }

  scenario.accounts.forEach((account, accountIndex) => {
    accountIdCounts.set(account.id, (accountIdCounts.get(account.id) ?? 0) + 1);

    if (!isNonEmptyString(account.id)) {
      addIssue(issues, "error", "account.id.empty", "Account ID cannot be empty.", ["accounts", accountIndex, "id"]);
    }

    if (!isNonEmptyString(account.label)) {
      addIssue(issues, "warning", "account.label.empty", "Account label is empty.", ["accounts", accountIndex, "label"]);
    }

    if (!Number.isFinite(account.openingBalance) || account.openingBalance < 0) {
      addIssue(issues, "error", "account.openingBalance.invalid", "Opening balance must be zero or greater.", ["accounts", accountIndex, "openingBalance"]);
    }

    if (account.annualRate !== undefined && (!Number.isFinite(account.annualRate) || account.annualRate < 0)) {
      addIssue(issues, "error", "account.annualRate.invalid", "Annual rate must be zero or greater.", ["accounts", accountIndex, "annualRate"]);
    }

    if (account.minBalance !== undefined && (!Number.isFinite(account.minBalance) || account.minBalance < 0)) {
      addIssue(issues, "error", "account.minBalance.invalid", "Minimum balance must be zero or greater.", ["accounts", accountIndex, "minBalance"]);
    }
  });

  accountIdCounts.forEach((count, accountId) => {
    if (count > 1) {
      addIssue(issues, "error", "account.id.duplicate", `Account ID '${accountId}' is duplicated.`, ["accounts"]);
    }
  });

  scenario.modules.forEach((module, moduleIndex) => {
    moduleIdCounts.set(module.id, (moduleIdCounts.get(module.id) ?? 0) + 1);
    moduleTypeCounts.set(module.type, (moduleTypeCounts.get(module.type) ?? 0) + 1);

    if (!isNonEmptyString(module.id)) {
      addIssue(issues, "error", "module.id.empty", "Module ID cannot be empty.", ["modules", moduleIndex, "id"]);
    }

    issues.push(
      ...getBuiltInModulePlugin(module.type).validate(module as never, {
        scenario,
        moduleIndex,
        accountMap,
      })
    );
  });

  moduleIdCounts.forEach((count, moduleId) => {
    if (count > 1) {
      addIssue(issues, "error", "module.id.duplicate", `Module ID '${moduleId}' is duplicated.`, ["modules"]);
    }
  });

  moduleTypeCounts.forEach((count, moduleType) => {
    if (count > 1 && isSingletonBuiltInModuleType(moduleType as ScenarioModule["type"])) {
      addIssue(
        issues,
        "error",
        "module.singleton.duplicate",
        `${getBuiltInModuleDefinition(moduleType as ScenarioModule["type"]).title} can only appear once in a scenario.`,
        ["modules"]
      );
    }
  });

  scenario.allocationPolicies.forEach((policy, policyIndex) => {
    policyIdCounts.set(policy.id, (policyIdCounts.get(policy.id) ?? 0) + 1);

    if (!accountMap.has(policy.sourceAccountId)) {
      addIssue(issues, "error", "policy.source.missing", `Policy source account '${policy.sourceAccountId}' does not exist.`, ["allocationPolicies", policyIndex, "sourceAccountId"]);
    }

    if (policy.rateOfAvailable < 0 || policy.rateOfAvailable > 1) {
      addIssue(issues, "error", "policy.rate.invalid", "Policy rate of available cash must be between 0 and 1.", ["allocationPolicies", policyIndex, "rateOfAvailable"]);
    }

    if (policy.steps.length === 0) {
      addIssue(issues, "warning", "policy.steps.empty", "Policy has no steps and will never move any balances.", ["allocationPolicies", policyIndex, "steps"]);
    }

    policy.steps.forEach((step, stepIndex) => {
      if (!accountMap.has(step.destinationAccountId)) {
        addIssue(issues, "error", "policy.step.destination.missing", `Policy destination account '${step.destinationAccountId}' does not exist.`, ["allocationPolicies", policyIndex, "steps", stepIndex, "destinationAccountId"]);
      }
    });

    policy.overrides.forEach((override, overrideIndex) => {
      if (override.month < 0) {
        addIssue(issues, "error", "policy.override.month.invalid", "Override month must be zero or greater.", ["allocationPolicies", policyIndex, "overrides", overrideIndex, "month"]);
      }

      override.steps.forEach((step, stepIndex) => {
        if (!accountMap.has(step.destinationAccountId)) {
          addIssue(issues, "error", "policy.override.destination.missing", `Override destination account '${step.destinationAccountId}' does not exist.`, ["allocationPolicies", policyIndex, "overrides", overrideIndex, "steps", stepIndex, "destinationAccountId"]);
        }

        if (step.amount < 0) {
          addIssue(issues, "error", "policy.override.amount.invalid", "Override amount must be zero or greater.", ["allocationPolicies", policyIndex, "overrides", overrideIndex, "steps", stepIndex, "amount"]);
        }
      });
    });
  });

  policyIdCounts.forEach((count, policyId) => {
    if (count > 1) {
      addIssue(issues, "error", "policy.id.duplicate", `Policy ID '${policyId}' is duplicated.`, ["allocationPolicies"]);
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
