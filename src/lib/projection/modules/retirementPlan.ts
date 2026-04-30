import { createEvent } from "../utils";
import type { ProjectionPlan, RetirementPlanModule, RuntimeOperation } from "../types";
import type { BuiltInModulePlugin } from "./base";
import { createId, getFirstAssetAccountId, getFirstNonCashAccountId } from "./base";

function buildRetirementContributions(module: RetirementPlanModule, annualBaseSalaryByMonth: number[]): Array<{ month: number; employeeContribution: number; employerContribution: number }> {
  return annualBaseSalaryByMonth.map((annualBaseSalary, month) => ({
    month,
    employeeContribution: month === 0 && module.firstMonthOverride.enabled
      ? module.firstMonthOverride.employeeContribution
      : Math.min(annualBaseSalary * module.employeeContributionRate, module.annualEmployeeLimit) / 12,
    employerContribution: month === 0 && module.firstMonthOverride.enabled
      ? module.firstMonthOverride.employerContribution
      : annualBaseSalary * Math.min(module.employeeContributionRate, module.employerMatchLimitRate) * module.employerMatchRate / 12,
  }));
}

function buildContributionSummary(contributions: Array<{ month: number; employeeContribution: number; employerContribution: number }>): ProjectionPlan["contributionSummary"] {
  return contributions.reduce<ProjectionPlan["contributionSummary"]>((summary, contribution) => ({
    annualEmployee401k: summary.annualEmployee401k + (contribution.month < 12 ? contribution.employeeContribution : 0),
    annualEmployer401k: summary.annualEmployer401k + (contribution.month < 12 ? contribution.employerContribution : 0),
    monthlyEmployee401k: contribution.month === 0 ? contribution.employeeContribution : summary.monthlyEmployee401k,
    monthlyEmployer401k: contribution.month === 0 ? contribution.employerContribution : summary.monthlyEmployer401k,
  }), {
    annualEmployee401k: 0,
    annualEmployer401k: 0,
    monthlyEmployee401k: 0,
    monthlyEmployer401k: 0,
  });
}

export const retirementPlanModule: BuiltInModulePlugin<RetirementPlanModule> = {
  definition: {
    type: "retirementPlan",
    title: "Retirement plan",
    description: "Pre-tax employee contributions, employer match, and first-month overrides.",
    singleton: true,
    createDefault: ({ scenario }) => ({
      id: createId("retirement-plan", scenario.modules.map((currentModule) => currentModule.id)),
      type: "retirementPlan",
      destinationAccountId: getFirstAssetAccountId(scenario.accounts) ?? getFirstNonCashAccountId(scenario.accounts) ?? scenario.accounts[0]?.id ?? "cash",
      annualEmployeeLimit: 24500,
      employeeContributionRate: 0.04,
      employerMatchRate: 0.5,
      employerMatchLimitRate: 0.04,
      firstMonthOverride: {
        enabled: false,
        employeeContribution: 0,
        employerContribution: 0,
      },
    }),
  },
  validate: (module, { moduleIndex, accountMap }) => {
    const issues = [];
    const destinationAccount = accountMap.get(module.destinationAccountId);

    if (!destinationAccount) {
      issues.push({ code: "module.retirement.destination.missing", message: `Retirement destination account '${module.destinationAccountId}' does not exist.`, path: ["modules", moduleIndex, "destinationAccountId"], severity: "error" as const });
    } else if (destinationAccount.kind === "liability") {
      issues.push({ code: "module.retirement.destination.kind", message: "Retirement plan destination must not be a liability account.", path: ["modules", moduleIndex, "destinationAccountId"], severity: "error" as const });
    }

    if (module.annualEmployeeLimit < 0) {
      issues.push({ code: "module.retirement.limit.invalid", message: "Annual employee limit must be zero or greater.", path: ["modules", moduleIndex, "annualEmployeeLimit"], severity: "error" as const });
    }

    ([
      [module.employeeContributionRate, "employeeContributionRate"],
      [module.employerMatchRate, "employerMatchRate"],
      [module.employerMatchLimitRate, "employerMatchLimitRate"],
    ] as Array<[number, string]>).forEach(([value, key]) => {
      if (!Number.isFinite(value) || value < 0) {
        issues.push({ code: `module.retirement.${key}.invalid`, message: "Retirement rates must be zero or greater.", path: ["modules", moduleIndex, key], severity: "error" as const });
      }
    });

    return issues;
  },
  compile: (module, context) => {
    const contributions = buildRetirementContributions(module, context.facts.annualBaseSalaryByMonth);

    switch (context.stage) {
      case "events": {
        return {
          externalEvents: contributions.flatMap(({ month, employeeContribution, employerContribution }) => [
            createEvent({
              month,
              amount: employeeContribution,
              type: "pre_tax_deduction",
              source: "employee-401k",
              destination: module.destinationAccountId,
              taxTreatment: "pre-tax",
            }),
            createEvent({
              month,
              amount: employerContribution,
              type: "employer_contribution",
              source: "employer-match",
              destination: module.destinationAccountId,
              taxTreatment: "not-taxed-now",
            }),
          ]),
          contributionSummaryDelta: buildContributionSummary(contributions),
        };
      }
      case "runtime": {
        return {
          scheduledOperations: contributions.flatMap(({ month, employeeContribution, employerContribution }) => {
            const operations: RuntimeOperation[] = [];

            if (employeeContribution > 0) {
              operations.push({
                month,
                amount: employeeContribution,
                emitEvent: false,
                type: "pre_tax_deduction",
                source: "employee-401k",
                destination: module.destinationAccountId,
                taxTreatment: "pre-tax",
                effects: [{ accountId: module.destinationAccountId, delta: employeeContribution }],
              });
            }

            if (employerContribution > 0) {
              operations.push({
                month,
                amount: employerContribution,
                emitEvent: false,
                type: "employer_contribution",
                source: "employer-match",
                destination: module.destinationAccountId,
                taxTreatment: "not-taxed-now",
                effects: [{ accountId: module.destinationAccountId, delta: employerContribution }],
              });
            }

            return operations;
          }),
        };
      }
      default:
        return {};
    }
  },
};
