import {
  getAnnual401kEmployeeForMonth,
  getAnnual401kEmployerForMonth,
  getBaseSalaryForMonth,
  getFutureRefreshGrantValueForMonth,
  getMonthlyBaseSalary,
} from "./calculations";
import { EVENT_TYPES, RSU_PLANS } from "./model";
import type {
  ActualMonthlyOverride,
  EventType,
  ProjectionEvent,
  ProjectionInput,
  RsuPlanKey,
} from "./types";

interface EventInput {
  month: number | null;
  type: EventType;
  amount: number;
  source?: string;
  destination?: string;
  taxTreatment?: string;
  meta?: Record<string, unknown>;
}

export interface ContributionEventModel {
  annualEmployee401k: number;
  annualEmployer401k: number;
  monthlyEmployee401k: number;
  monthlyEmployer401k: number;
  events: ProjectionEvent[];
}

export function createEvent({ month, type, amount, source, destination, taxTreatment, meta = {} }: EventInput): ProjectionEvent {
  return {
    month,
    type,
    amount: Math.max(0, amount || 0),
    source,
    destination,
    taxTreatment,
    meta,
  };
}

function createRecurringMonthlyEvents({
  projectionLastMonth,
  amount,
  type,
  source,
  destination,
  taxTreatment,
  meta,
}: {
  projectionLastMonth: number;
  amount: number;
  type: EventType;
  source?: string;
  destination?: string;
  taxTreatment?: string;
  meta?: Record<string, unknown>;
}): ProjectionEvent[] {
  return Array.from({ length: projectionLastMonth + 1 }, (_, month) =>
    createEvent({ month, amount, type, source, destination, taxTreatment, meta })
  );
}

function createSalaryEvents(input: ProjectionInput, projectionLastMonth: number): ProjectionEvent[] {
  return Array.from({ length: projectionLastMonth + 1 }, (_, month) => {
    const amount = month === 0 && input.overrides.firstMonth.useActualPaycheck
      ? input.overrides.firstMonth.regularGross
      : getMonthlyBaseSalary(input, month);

    return createEvent({
      month,
      amount,
      type: EVENT_TYPES.ORDINARY_INCOME,
      source: "base-salary",
      taxTreatment: "ordinary-income",
      meta: {
        bucket: "salary",
        annualBaseSalary: getBaseSalaryForMonth(input, month),
        actualFirstMonthOverride: month === 0 && input.overrides.firstMonth.useActualPaycheck,
      },
    });
  });
}

function createSigningBonusEvents(input: ProjectionInput): ProjectionEvent[] {
  if (!input.overrides.firstMonth.useActualPaycheck || input.overrides.firstMonth.signingBonus <= 0) return [];

  return [
    createEvent({
      month: 0,
      amount: input.overrides.firstMonth.signingBonus,
      type: EVENT_TYPES.ORDINARY_INCOME,
      source: "signing-bonus",
      taxTreatment: "ordinary-income",
      meta: { bucket: "salary", label: "Signing bonus" },
    }),
  ];
}

export function create401kEvents(input: ProjectionInput, projectionLastMonth: number): ContributionEventModel {
  const events: ProjectionEvent[] = [];
  let firstMonthEmployee = 0;
  let firstMonthEmployer = 0;
  let firstYearEmployee = 0;
  let firstYearEmployer = 0;

  for (let month = 0; month <= projectionLastMonth; month += 1) {
    const monthly401kEmployee = month === 0 && input.overrides.firstMonth.useActualPaycheck
      ? input.overrides.firstMonth.employee401k
      : getAnnual401kEmployeeForMonth(input, month) / 12;
    const monthly401kEmployer = month === 0 && input.overrides.firstMonth.useActualPaycheck
      ? input.overrides.firstMonth.employer401k
      : getAnnual401kEmployerForMonth(input, month) / 12;

    if (month === 0) {
      firstMonthEmployee = monthly401kEmployee;
      firstMonthEmployer = monthly401kEmployer;
    }

    if (month < 12) {
      firstYearEmployee += monthly401kEmployee;
      firstYearEmployer += monthly401kEmployer;
    }

    events.push(
      createEvent({
        month,
        amount: monthly401kEmployee,
        type: EVENT_TYPES.PRE_TAX_DEDUCTION,
        source: "employee-401k",
        destination: "k401",
        taxTreatment: "pre-tax",
      })
    );
    events.push(
      createEvent({
        month,
        amount: monthly401kEmployer,
        type: EVENT_TYPES.EMPLOYER_CONTRIBUTION,
        source: "employer-match",
        destination: "k401",
        taxTreatment: "not-taxed-now",
      })
    );
  }

  return {
    annualEmployee401k: firstYearEmployee,
    annualEmployer401k: firstYearEmployer,
    monthlyEmployee401k: firstMonthEmployee,
    monthlyEmployer401k: firstMonthEmployer,
    events,
  };
}

export function createExpenseEvents(input: ProjectionInput, projectionLastMonth: number): ProjectionEvent[] {
  const items = [
    { source: "rent", amount: input.expenses.monthlyRent },
    { source: "parking", amount: input.expenses.monthlyParking },
    { source: "health-dental-benefits", amount: input.expenses.monthlyHealthDentalBenefits },
    { source: "other-fixed-expenses", amount: input.expenses.otherMonthlyFixedExpenses },
  ];

  return items.flatMap((item) =>
    createRecurringMonthlyEvents({
      projectionLastMonth,
      amount: item.amount,
      type: EVENT_TYPES.EXPENSE,
      source: item.source,
      taxTreatment: "after-tax",
    })
  );
}

function createRsuVestEvents({
  grantValue,
  planKey,
  grantStartMonth = 0,
  employeeMonthAtProjectionStart = 0,
}: {
  grantValue: number;
  planKey: RsuPlanKey;
  grantStartMonth?: number;
  employeeMonthAtProjectionStart?: number;
}): ProjectionEvent[] {
  const plan = RSU_PLANS[planKey];
  if (grantValue <= 0) return [];

  return plan.events
    .map((event) =>
      createEvent({
        month: grantStartMonth + event.month - employeeMonthAtProjectionStart,
        amount: grantValue * event.pct,
        type: EVENT_TYPES.VEST,
        source: planKey,
        destination: "amazonStock",
        taxTreatment: "ordinary-income",
        meta: { label: plan.label, planKey },
      })
    )
    .filter((event) => (event.month ?? -1) >= 0);
}

function createAnnualRefreshRsuEvents(input: ProjectionInput, projectionLastMonth: number): ProjectionEvent[] {
  const events: ProjectionEvent[] = [];
  const firstRefreshGrantMonth = Math.max(24, input.compensation.monthsAtAmazon + 12);

  for (let grantMonth = firstRefreshGrantMonth; grantMonth <= projectionLastMonth; grantMonth += 12) {
    const grantValue = getFutureRefreshGrantValueForMonth(input, grantMonth);
    if (grantValue <= 0) continue;

    events.push(
      ...createRsuVestEvents({
        grantValue,
        planKey: "amazonAnnualRefresher",
        grantStartMonth: grantMonth,
        employeeMonthAtProjectionStart: input.compensation.monthsAtAmazon,
      })
    );
  }

  return events.filter((event) => (event.month ?? -1) <= projectionLastMonth);
}

export function createCompensationEvents(input: ProjectionInput, projectionLastMonth: number): ProjectionEvent[] {
  return [
    ...createSalaryEvents(input, projectionLastMonth),
    ...createSigningBonusEvents(input),
    ...createRsuVestEvents({
      grantValue: input.compensation.initialRsuGrantValue,
      planKey: "amazonInitial",
      grantStartMonth: 0,
      employeeMonthAtProjectionStart: input.compensation.monthsAtAmazon,
    }),
    ...createAnnualRefreshRsuEvents(input, projectionLastMonth),
  ];
}

export function groupEventsByMonth(events: ProjectionEvent[]): Map<number, ProjectionEvent[]> {
  const byMonth = new Map<number, ProjectionEvent[]>();
  for (const event of events) {
    if (event.month === null) continue;
    if (!byMonth.has(event.month)) byMonth.set(event.month, []);
    byMonth.get(event.month)?.push(event);
  }
  return byMonth;
}

export function sumEvents(events: ProjectionEvent[], predicate: (event: ProjectionEvent) => boolean): number {
  return events.reduce((sum, event) => (predicate(event) ? sum + event.amount : sum), 0);
}

export function getActualMonthOverride(input: ProjectionInput, month: number): ActualMonthlyOverride | null {
  return input.overrides.actualMonthlyOverrides.find((override) => override.month === month) ?? null;
}
