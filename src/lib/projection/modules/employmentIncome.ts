import { createEvent } from "../utils";
import type { EmploymentIncomeModule, ProjectionEvent, RuntimeOperation } from "../types";
import type { BuiltInModulePlugin } from "./base";
import { createId } from "./base";

function buildAnnualBaseSalaryByMonth(annualBaseSalary: number, annualRaiseRate: number, horizonMonths: number): number[] {
  return Array.from({ length: horizonMonths }, (_, month) => annualBaseSalary * Math.pow(1 + annualRaiseRate, Math.floor(month / 12)));
}

function buildEmploymentEvents(module: EmploymentIncomeModule, horizonMonths: number): ProjectionEvent[] {
  const annualBaseSalaryByMonth = buildAnnualBaseSalaryByMonth(module.annualBaseSalary, module.annualRaiseRate, horizonMonths);
  const events = annualBaseSalaryByMonth.map((annualBaseSalary, month) =>
    createEvent({
      month,
      amount: month === 0 && module.firstMonthActualPaycheck.enabled ? module.firstMonthActualPaycheck.regularGross : annualBaseSalary / 12,
      type: "ordinary_income",
      source: "base-salary",
      taxTreatment: "ordinary-income",
      meta: {
        bucket: "salary",
        annualBaseSalary,
        actualFirstMonthOverride: month === 0 && module.firstMonthActualPaycheck.enabled,
      },
    })
  );

  if (module.firstMonthActualPaycheck.enabled && module.firstMonthActualPaycheck.signingBonus > 0) {
    events.push(
      createEvent({
        month: 0,
        amount: module.firstMonthActualPaycheck.signingBonus,
        type: "ordinary_income",
        source: "signing-bonus",
        taxTreatment: "ordinary-income",
        meta: { bucket: "salary", label: "Signing bonus" },
      })
    );
  }

  return events;
}

function sumEventsByMonth(events: ProjectionEvent[], horizonMonths: number, predicate: (event: ProjectionEvent) => boolean): number[] {
  const values = Array.from({ length: horizonMonths }, () => 0);

  events.forEach((event) => {
    if (event.month === null || event.month < 0 || event.month >= horizonMonths) return;
    if (!predicate(event)) return;
    values[event.month] += event.amount;
  });

  return values;
}

function buildSalaryCashOperations({
  module,
  externalEvents,
  horizonMonths,
}: {
  module: EmploymentIncomeModule;
  externalEvents: ProjectionEvent[];
  horizonMonths: number;
}): RuntimeOperation[] {
  const salaryGrossByMonth = sumEventsByMonth(
    externalEvents,
    horizonMonths,
    (event) => event.type === "ordinary_income" && event.meta?.bucket === "salary"
  );
  const preTaxContributionByMonth = sumEventsByMonth(
    externalEvents,
    horizonMonths,
    (event) => event.type === "pre_tax_deduction"
  );
  const salaryTaxByMonth = sumEventsByMonth(
    externalEvents,
    horizonMonths,
    (event) => event.type === "tax" && event.meta?.bucket === "salary"
  );

  const operations: RuntimeOperation[] = [];

  for (let month = 0; month < horizonMonths; month += 1) {
    const amount = month === 0 && module.firstMonthActualPaycheck.enabled
      ? module.firstMonthActualPaycheck.takeHome
      : Math.max(0, salaryGrossByMonth[month] - preTaxContributionByMonth[month] - salaryTaxByMonth[month]);

    if (amount <= 0) continue;

    operations.push({
      month,
      amount,
      emitEvent: false,
      type: "ordinary_income",
      source: "after-tax-salary-cash",
      destination: "cash",
      taxTreatment: "after-tax",
      meta: { bucket: "salary-cash" },
      effects: [{ accountId: "cash", delta: amount }],
    });
  }

  return operations;
}

export const employmentIncomeModule: BuiltInModulePlugin<EmploymentIncomeModule> = {
  definition: {
    type: "employmentIncome",
    title: "Employment income",
    description: "Salary growth and optional first-month actual paycheck override.",
    singleton: true,
    createDefault: ({ scenario }) => ({
      id: createId("employment", scenario.modules.map((currentModule) => currentModule.id)),
      type: "employmentIncome",
      annualBaseSalary: 120000,
      annualRaiseRate: 0.03,
      firstMonthActualPaycheck: {
        enabled: false,
        regularGross: 0,
        signingBonus: 0,
        takeHome: 0,
      },
    }),
  },
  validate: (module, { moduleIndex }) => {
    const issues = [];

    if (module.annualBaseSalary < 0) {
      issues.push({ code: "module.employment.salary.invalid", message: "Annual base salary must be zero or greater.", path: ["modules", moduleIndex, "annualBaseSalary"], severity: "error" as const });
    }

    if (module.annualRaiseRate < 0) {
      issues.push({ code: "module.employment.raise.invalid", message: "Annual raise rate must be zero or greater.", path: ["modules", moduleIndex, "annualRaiseRate"], severity: "error" as const });
    }

    return issues;
  },
  compile: (module, context) => {
    switch (context.stage) {
      case "facts":
        return {
          facts: {
            annualBaseSalaryByMonth: buildAnnualBaseSalaryByMonth(module.annualBaseSalary, module.annualRaiseRate, context.horizonMonths),
            usesActualFirstMonthPaycheck: module.firstMonthActualPaycheck.enabled,
          },
        };
      case "events":
        return {
          externalEvents: buildEmploymentEvents(module, context.horizonMonths),
        };
      case "runtime":
        return {
          scheduledOperations: buildSalaryCashOperations({
            module,
            externalEvents: context.externalEvents,
            horizonMonths: context.horizonMonths,
          }),
        };
      default:
        return {};
    }
  },
};
