import { DEFAULT_REFRESHER_PCT_OF_BASE, MODEL } from "../model";
import { createEvent } from "../utils";
import type { EquityGrantSeriesModule, ProjectionEvent, RuntimeOperation } from "../types";
import type { BuiltInModulePlugin } from "./base";
import { createId, getFirstAssetAccountId, getFirstNonCashAccountId } from "./base";

function getFallbackAnnualBaseSalary(module: EquityGrantSeriesModule, month: number): number {
  return module.annualBaseSalary * Math.pow(1 + module.annualRaiseRate, Math.floor(month / 12));
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
  vestingSchedule: Array<{ monthOffset: number; pct: number }>;
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

function buildGrossVestEvents(module: EquityGrantSeriesModule, annualBaseSalaryByMonth: number[], horizonMonths: number): ProjectionEvent[] {
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
      ? (annualBaseSalaryByMonth[grantMonth] || getFallbackAnnualBaseSalary(module, grantMonth)) * (module.salaryLinkedRefreshPctOfBase || DEFAULT_REFRESHER_PCT_OF_BASE)
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

export const equityGrantSeriesModule: BuiltInModulePlugin<EquityGrantSeriesModule> = {
  definition: {
    type: "equityGrantSeries",
    title: "Equity grant series",
    description: "Initial equity grant, refreshers, and a configurable vesting schedule.",
    singleton: false,
    createDefault: ({ scenario }) => ({
      id: createId("equity-grants", scenario.modules.map((currentModule) => currentModule.id)),
      type: "equityGrantSeries",
      destinationAccountId: getFirstAssetAccountId(scenario.accounts) ?? getFirstNonCashAccountId(scenario.accounts) ?? scenario.accounts[0]?.id ?? "cash",
      employeeMonthsAtProjectionStart: 0,
      initialGrantValue: 0,
      refreshGrantValue: 0,
      firstRefreshGrantMonth: 12,
      refreshFrequencyMonths: 12,
      useSalaryGrowthForRefreshers: false,
      annualRaiseRate: 0.03,
      annualBaseSalary: 120000,
      salaryLinkedRefreshPctOfBase: 0.25,
      vestingSchedule: [
        { monthOffset: 12, pct: 0.25 },
        { monthOffset: 24, pct: 0.25 },
        { monthOffset: 36, pct: 0.25 },
        { monthOffset: 48, pct: 0.25 },
      ],
    }),
  },
  validate: (module, { moduleIndex, accountMap }) => {
    const issues = [];
    const destinationAccount = accountMap.get(module.destinationAccountId);

    if (!destinationAccount) {
      issues.push({ code: "module.equity.destination.missing", message: `Equity destination account '${module.destinationAccountId}' does not exist.`, path: ["modules", moduleIndex, "destinationAccountId"], severity: "error" as const });
    } else if (destinationAccount.kind === "liability") {
      issues.push({ code: "module.equity.destination.kind", message: "Equity destination must not be a liability account.", path: ["modules", moduleIndex, "destinationAccountId"], severity: "error" as const });
    }

    if (module.vestingSchedule.length === 0) {
      issues.push({ code: "module.equity.vesting.empty", message: "Equity grant series requires at least one vesting row.", path: ["modules", moduleIndex, "vestingSchedule"], severity: "error" as const });
    }

    const vestingPctSum = module.vestingSchedule.reduce((sum: number, row: { monthOffset: number; pct: number }) => sum + row.pct, 0);
    if (vestingPctSum <= 0) {
      issues.push({ code: "module.equity.vesting.zero", message: "Vesting schedule percentages must sum to more than zero.", path: ["modules", moduleIndex, "vestingSchedule"], severity: "error" as const });
    }
    if (vestingPctSum > 1.001) {
      issues.push({ code: "module.equity.vesting.sum", message: "Vesting schedule percentages sum to more than 100% of the grant.", path: ["modules", moduleIndex, "vestingSchedule"], severity: "warning" as const });
    }

    return issues;
  },
  compile: (module, context) => {
    const grossVestEvents = buildGrossVestEvents(module, context.facts.annualBaseSalaryByMonth, context.horizonMonths);

    switch (context.stage) {
      case "events":
        return { externalEvents: grossVestEvents };
      case "runtime": {
        const rsuTaxRateByYear = context.annualTaxPlan.map((year) => (year.rsuIncome > 0 ? year.taxAllocatedToRsus / year.rsuIncome : 0));

        return {
          scheduledOperations: grossVestEvents.map<RuntimeOperation>((event) => {
            const month = event.month ?? 0;
            const rsuTax = event.amount * (rsuTaxRateByYear[Math.floor(month / 12)] ?? 0);
            const netRsuAdded = Math.max(0, event.amount - rsuTax);

            return {
              month,
              amount: netRsuAdded,
              emitEvent: true,
              type: "vest",
              source: "after-tax-rsu-shares",
              destination: module.destinationAccountId,
              taxTreatment: "after-tax",
              meta: { grossRsuVested: event.amount, rsuTax },
              effects: [{ accountId: module.destinationAccountId, delta: netRsuAdded }],
            };
          }),
        };
      }
      default:
        return {};
    }
  },
};
