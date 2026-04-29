import { createEvent } from "./eventGenerators";
import { MODEL } from "./model";
import { buildAnnualTaxPlan, createTaxEvents } from "./taxes";
import type {
  AnnualTaxPlanYear,
  EmploymentIncomeModule,
  EquityGrantSeriesModule,
  ProjectionEvent,
  ProjectionPlan,
  RecurringFlowModule,
  RetirementPlanModule,
  RuntimeOperation,
  RuntimeRateRule,
  ScenarioDefinition,
  ScenarioModule,
  TaxModule,
} from "./types";

interface SalaryFact {
  month: number;
  annualBaseSalary: number;
}

const EMPTY_CONTRIBUTION_SUMMARY: ProjectionPlan["contributionSummary"] = {
  annualEmployee401k: 0,
  annualEmployer401k: 0,
  monthlyEmployee401k: 0,
  monthlyEmployer401k: 0,
};

function getAnnualBaseSalary(module: EmploymentIncomeModule, month: number): number {
  return module.annualBaseSalary * Math.pow(1 + module.annualRaiseRate, Math.floor(month / 12));
}

function getModulesByType<Type extends ScenarioModule["type"]>(scenario: ScenarioDefinition, type: Type): Array<Extract<ScenarioModule, { type: Type }>> {
  return scenario.modules.filter((candidate): candidate is Extract<ScenarioModule, { type: Type }> => candidate.type === type);
}

function compileEmploymentIncomeModule(module: EmploymentIncomeModule, horizonMonths: number): {
  events: ProjectionEvent[];
  salaryFacts: SalaryFact[];
} {
  const events: ProjectionEvent[] = [];
  const salaryFacts: SalaryFact[] = [];

  for (let month = 0; month < horizonMonths; month += 1) {
    const annualBaseSalary = getAnnualBaseSalary(module, month);
    const amount = month === 0 && module.firstMonthActualPaycheck.enabled
      ? module.firstMonthActualPaycheck.regularGross
      : annualBaseSalary / 12;

    salaryFacts.push({ month, annualBaseSalary });
    events.push(
      createEvent({
        month,
        amount,
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
  }

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

  return { events, salaryFacts };
}

function compileRecurringFlowModule(module: RecurringFlowModule, horizonMonths: number): ProjectionEvent[] {
  const events: ProjectionEvent[] = [];
  const endMonth = module.endMonth ?? horizonMonths - 1;

  for (let month = module.startMonth; month <= Math.min(endMonth, horizonMonths - 1); month += 1) {
    events.push(
      createEvent({
        month,
        amount: module.amount,
        type: module.eventType,
        source: module.source,
        taxTreatment: module.taxTreatment,
      })
    );
  }

  return events;
}

function compileRetirementPlanModule(module: RetirementPlanModule, salaryFacts: SalaryFact[]): {
  events: ProjectionEvent[];
  summary: ProjectionPlan["contributionSummary"];
} {
  const events: ProjectionEvent[] = [];
  let annualEmployee401k = 0;
  let annualEmployer401k = 0;
  let monthlyEmployee401k = 0;
  let monthlyEmployer401k = 0;

  salaryFacts.forEach(({ month, annualBaseSalary }) => {
    const employeeContribution = month === 0 && module.firstMonthOverride.enabled
      ? module.firstMonthOverride.employeeContribution
      : Math.min(annualBaseSalary * module.employeeContributionRate, module.annualEmployeeLimit) / 12;
    const employerContribution = month === 0 && module.firstMonthOverride.enabled
      ? module.firstMonthOverride.employerContribution
      : annualBaseSalary * Math.min(module.employeeContributionRate, module.employerMatchLimitRate) * module.employerMatchRate / 12;

    if (month === 0) {
      monthlyEmployee401k = employeeContribution;
      monthlyEmployer401k = employerContribution;
    }

    if (month < 12) {
      annualEmployee401k += employeeContribution;
      annualEmployer401k += employerContribution;
    }

    events.push(
      createEvent({
        month,
        amount: employeeContribution,
        type: "pre_tax_deduction",
        source: "employee-401k",
        destination: module.destinationAccountId,
        taxTreatment: "pre-tax",
      })
    );
    events.push(
      createEvent({
        month,
        amount: employerContribution,
        type: "employer_contribution",
        source: "employer-match",
        destination: module.destinationAccountId,
        taxTreatment: "not-taxed-now",
      })
    );
  });

  return {
    events,
    summary: {
      annualEmployee401k,
      annualEmployer401k,
      monthlyEmployee401k,
      monthlyEmployer401k,
    },
  };
}

function createGrantVestEvents({
  grantLabel,
  grantValue,
  grantMonth,
  destinationAccountId,
  employeeMonthsAtProjectionStart,
  vestingSchedule,
  horizonMonths,
}: {
  grantLabel: string;
  grantValue: number;
  grantMonth: number;
  destinationAccountId: string;
  employeeMonthsAtProjectionStart: number;
  vestingSchedule: EquityGrantSeriesModule["vestingSchedule"];
  horizonMonths: number;
}): ProjectionEvent[] {
  if (grantValue <= 0) return [];

  return vestingSchedule
    .map((event) =>
      createEvent({
        month: grantMonth + event.monthOffset - employeeMonthsAtProjectionStart,
        amount: grantValue * event.pct,
        type: "vest",
        source: grantLabel,
        destination: destinationAccountId,
        taxTreatment: "ordinary-income",
        meta: { label: grantLabel },
      })
    )
    .filter((event) => event.month !== null && event.month >= 0 && event.month < horizonMonths);
}

function compileEquityGrantSeriesModule(module: EquityGrantSeriesModule, horizonMonths: number): ProjectionEvent[] {
  const events = createGrantVestEvents({
    grantLabel: MODEL.rsuPlans.amazonInitial.label,
    grantValue: module.initialGrantValue,
    grantMonth: 0,
    destinationAccountId: module.destinationAccountId,
    employeeMonthsAtProjectionStart: module.employeeMonthsAtProjectionStart,
    vestingSchedule: module.vestingSchedule,
    horizonMonths,
  });

  for (let grantMonth = module.firstRefreshGrantMonth; grantMonth < horizonMonths; grantMonth += module.refreshFrequencyMonths) {
    const grantValue = module.useSalaryGrowthForRefreshers
      ? getAnnualBaseSalary(
          {
            id: "refresh-salary-link",
            type: "employmentIncome",
            annualBaseSalary: module.annualBaseSalary,
            annualRaiseRate: module.annualRaiseRate,
            firstMonthActualPaycheck: { enabled: false, regularGross: 0, signingBonus: 0, takeHome: 0 },
          },
          grantMonth
        ) * module.salaryLinkedRefreshPctOfBase
      : module.refreshGrantValue;

    events.push(
      ...createGrantVestEvents({
        grantLabel: MODEL.rsuPlans.amazonAnnualRefresher.label,
        grantValue,
        grantMonth,
        destinationAccountId: module.destinationAccountId,
        employeeMonthsAtProjectionStart: module.employeeMonthsAtProjectionStart,
        vestingSchedule: module.vestingSchedule,
        horizonMonths,
      })
    );
  }

  return events;
}

function sumAmountsByMonth(events: ProjectionEvent[], predicate: (event: ProjectionEvent) => boolean, horizonMonths: number): number[] {
  const values = Array.from({ length: horizonMonths }, () => 0);

  events.forEach((event) => {
    if (event.month === null || event.month < 0 || event.month >= horizonMonths) return;
    if (!predicate(event)) return;
    values[event.month] += event.amount;
  });

  return values;
}

function buildScheduledOperations({
  scenario,
  externalEvents,
  annualTaxPlan,
}: {
  scenario: ScenarioDefinition;
  externalEvents: ProjectionEvent[];
  annualTaxPlan: AnnualTaxPlanYear[];
}): {
  scheduledOperations: RuntimeOperation[];
  rateRules: RuntimeRateRule[];
} {
  const horizonMonths = scenario.horizonMonths;
  const employmentModule = getModulesByType(scenario, "employmentIncome")[0];
  const recurringModules = scenario.modules.filter((module): module is RecurringFlowModule => module.type === "recurringFlow");
  const salaryGrossByMonth = sumAmountsByMonth(
    externalEvents,
    (event) => event.type === "ordinary_income" && event.meta?.bucket === "salary",
    horizonMonths
  );
  const employee401kByMonth = sumAmountsByMonth(
    externalEvents,
    (event) => event.type === "pre_tax_deduction",
    horizonMonths
  );
  const employer401kByMonth = sumAmountsByMonth(
    externalEvents,
    (event) => event.type === "employer_contribution",
    horizonMonths
  );
  const salaryTaxByMonth = sumAmountsByMonth(
    externalEvents,
    (event) => event.type === "tax" && event.meta?.bucket === "salary",
    horizonMonths
  );
  const expenseEvents = externalEvents.filter((event) => event.type === "expense" && event.month !== null && event.month >= 0 && event.month < horizonMonths);
  const rsuTaxRateByYear = annualTaxPlan.map((year) => (year.rsuIncome > 0 ? year.taxAllocatedToRsus / year.rsuIncome : 0));
  const retirementDestinations = new Set(
    getModulesByType(scenario, "retirementPlan").map((module) => module.destinationAccountId)
  );

  const scheduledOperations: RuntimeOperation[] = [];

  for (let month = 0; month < horizonMonths; month += 1) {
    const salaryCashAmount = month === 0 && employmentModule?.firstMonthActualPaycheck.enabled
      ? employmentModule.firstMonthActualPaycheck.takeHome
      : Math.max(0, salaryGrossByMonth[month] - employee401kByMonth[month] - salaryTaxByMonth[month]);

    if (salaryCashAmount > 0) {
      scheduledOperations.push({
        month,
        amount: salaryCashAmount,
        emitEvent: false,
        type: "ordinary_income",
        source: "after-tax-salary-cash",
        destination: "cash",
        taxTreatment: "after-tax",
        meta: { bucket: "salary-cash" },
        effects: [{ accountId: "cash", delta: salaryCashAmount }],
      });
    }

    externalEvents
      .filter((event) => event.month === month && event.type === "pre_tax_deduction" && Boolean(event.destination) && retirementDestinations.has(event.destination ?? ""))
      .forEach((event) => {
        scheduledOperations.push({
          month,
          amount: event.amount,
          emitEvent: false,
          type: event.type,
          source: event.source,
          destination: event.destination,
          taxTreatment: event.taxTreatment,
          effects: [{ accountId: event.destination ?? "", delta: event.amount }],
        });
      });

    externalEvents
      .filter((event) => event.month === month && event.type === "employer_contribution" && Boolean(event.destination) && retirementDestinations.has(event.destination ?? ""))
      .forEach((event) => {
        scheduledOperations.push({
          month,
          amount: event.amount,
          emitEvent: false,
          type: event.type,
          source: event.source,
          destination: event.destination,
          taxTreatment: event.taxTreatment,
          effects: [{ accountId: event.destination ?? "", delta: event.amount }],
        });
      });

    externalEvents
      .filter((event) => event.month === month && event.type === "vest" && event.taxTreatment === "ordinary-income" && Boolean(event.destination))
      .forEach((event) => {
        const rsuTax = event.amount * (rsuTaxRateByYear[Math.floor(month / 12)] ?? 0);
        const netRsuAdded = Math.max(0, event.amount - rsuTax);

        scheduledOperations.push({
          month,
          amount: netRsuAdded,
          emitEvent: true,
          type: "vest",
          source: "after-tax-rsu-shares",
          destination: event.destination,
          taxTreatment: "after-tax",
          meta: { grossRsuVested: event.amount, rsuTax },
          effects: [{ accountId: event.destination ?? "", delta: netRsuAdded }],
        });
      });
  }

  expenseEvents.forEach((event) => {
    const recurringModule = recurringModules.find((module) => module.source === event.source);
    const shouldSkipCashFlow = recurringModule?.skipWhenActualFirstMonthPaycheck && employmentModule?.firstMonthActualPaycheck.enabled && event.month === 0;

    if (shouldSkipCashFlow || event.month === null) return;

    scheduledOperations.push({
      month: event.month,
      amount: event.amount,
      emitEvent: false,
      type: event.type,
      source: event.source,
      taxTreatment: event.taxTreatment,
      effects: [{ accountId: "cash", delta: -event.amount }],
    });
  });

  const rateRules: RuntimeRateRule[] = scenario.accounts
    .filter((account) => (account.annualRate ?? 0) > 0)
    .map((account) => ({
      accountId: account.id,
      startMonth: 0,
      endMonth: horizonMonths - 1,
      monthlyRate: Math.pow(1 + (account.annualRate ?? 0), 1 / 12) - 1,
      type: "interest",
      source: account.kind === "liability" ? `${account.id}-interest` : undefined,
      destination: account.id,
      taxTreatment: "after-tax",
      emitEvent: account.kind === "liability",
      meta: { accountKind: account.kind },
    }));

  scheduledOperations.sort((a, b) => a.month - b.month);

  return { scheduledOperations, rateRules };
}

export function compileProjectionPlan(scenario: ScenarioDefinition): ProjectionPlan {
  const employmentModules = getModulesByType(scenario, "employmentIncome");
  const retirementModules = getModulesByType(scenario, "retirementPlan");
  const equityModules = getModulesByType(scenario, "equityGrantSeries");
  const recurringModules = getModulesByType(scenario, "recurringFlow");
  const taxModules = getModulesByType(scenario, "tax") as TaxModule[];

  const employmentCompilation = employmentModules.map((module) => compileEmploymentIncomeModule(module, scenario.horizonMonths));
  const employmentEvents = employmentCompilation.flatMap((compilation) => compilation.events);
  const salaryFacts = employmentCompilation.flatMap((compilation) => compilation.salaryFacts);
  const recurringEvents = recurringModules.flatMap((module) => compileRecurringFlowModule(module, scenario.horizonMonths));
  const retirementCompilations = retirementModules.map((module) => compileRetirementPlanModule(module, salaryFacts));
  const equityEvents = equityModules.flatMap((module) => compileEquityGrantSeriesModule(module, scenario.horizonMonths));
  const contributionSummary = retirementCompilations.reduce<ProjectionPlan["contributionSummary"]>((summary, compilation) => ({
    annualEmployee401k: summary.annualEmployee401k + compilation.summary.annualEmployee401k,
    annualEmployer401k: summary.annualEmployer401k + compilation.summary.annualEmployer401k,
    monthlyEmployee401k: summary.monthlyEmployee401k + compilation.summary.monthlyEmployee401k,
    monthlyEmployer401k: summary.monthlyEmployer401k + compilation.summary.monthlyEmployer401k,
  }), EMPTY_CONTRIBUTION_SUMMARY);

  const projectionLastMonth = scenario.horizonMonths - 1;
  const preTaxLedgerEvents = [...employmentEvents, ...recurringEvents, ...retirementCompilations.flatMap((compilation) => compilation.events), ...equityEvents];
  const annualTaxPlan = taxModules.length > 0 ? buildAnnualTaxPlan(preTaxLedgerEvents, projectionLastMonth) : [];
  const taxEvents = taxModules.length > 0 ? createTaxEvents(annualTaxPlan) : [];
  const externalEvents = [...preTaxLedgerEvents, ...taxEvents];
  const { scheduledOperations, rateRules } = buildScheduledOperations({
    scenario,
    externalEvents,
    annualTaxPlan,
  });

  return {
    scenario,
    externalEvents,
    annualTaxPlan,
    scheduledOperations,
    rateRules,
    contributionSummary,
  };
}
