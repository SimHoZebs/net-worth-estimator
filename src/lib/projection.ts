const ACCOUNT_CONFIG = {
  k401: { label: "401(k)", color: "#2563eb", annualReturnSource: "fundAnnualReturn" },
  taxableFund: { label: "Taxable fund", color: "#f59e0b", annualReturnSource: "fundAnnualReturn" },
  studentLoan: { label: "Student loan", color: "#dc2626", annualReturnSource: "studentLoanInterestRate" },
  amazonStock: { label: "Amazon stock", color: "#7c3aed", annualReturnSource: "amazonStockAnnualReturn" },
} as const;

const RSU_PLANS = {
  amazonInitial: {
    label: "Amazon initial RSU grant",
    events: [
      { month: 12, pct: 0.05 },
      { month: 24, pct: 0.15 },
      { month: 30, pct: 0.2 },
      { month: 36, pct: 0.2 },
      { month: 42, pct: 0.2 },
      { month: 48, pct: 0.2 },
    ],
  },
  amazonAnnualRefresher: {
    label: "Modeled Amazon annual refresher",
    events: [
      { month: 12, pct: 0.05 },
      { month: 24, pct: 0.15 },
      { month: 30, pct: 0.2 },
      { month: 36, pct: 0.2 },
      { month: 42, pct: 0.2 },
      { month: 48, pct: 0.2 },
    ],
  },
} as const;

export const MODEL = {
  taxYear: 2026,
  targetNetWorth: 1_000_000,
  taxProfile: {
    standardDeduction: 32_200,
    stateIncomeTaxRate: 0,
    brackets: [
      { upTo: 24_800, rate: 0.1 },
      { upTo: 100_800, rate: 0.12 },
      { upTo: 211_400, rate: 0.22 },
      { upTo: 403_550, rate: 0.24 },
      { upTo: 512_450, rate: 0.32 },
      { upTo: 768_700, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    socialSecurityWageBase: 184_500,
    socialSecurityRate: 0.062,
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
    additionalMedicareThreshold: 250_000,
  },
  accounts: ACCOUNT_CONFIG,
  rsuPlans: RSU_PLANS,
} as const;

export const EVENT_TYPES = {
  ORDINARY_INCOME: "ordinary_income",
  PRE_TAX_DEDUCTION: "pre_tax_deduction",
  EMPLOYER_CONTRIBUTION: "employer_contribution",
  TAX: "tax",
  EXPENSE: "expense",
  TRANSFER: "transfer",
  VEST: "vest",
  SHORTFALL: "shortfall",
  DEBT_PAYMENT: "debt_payment",
  INTEREST: "interest",
} as const;

export const DEFAULT_REFRESHER_PCT_OF_BASE = 0.25;

const EMPLOYEE_401K_LIMIT_2026 = 24_500;

export type AccountKey = keyof typeof ACCOUNT_CONFIG;
export type RsuPlanKey = keyof typeof RSU_PLANS;
export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

export interface ProjectionFormState {
  baseSalary: number;
  initialRsuGrantValue: number;
  monthsAtAmazon: number;
  futureAnnualRefreshGrantValue: number;
  annualRaisePct: number;
  useSalaryGrowthForRefreshers: boolean;
  currentNetWorth: number;
  current401kBalance: number;
  currentAmazonStockBalance: number;
  extraInvestmentPct: number;
  fundAnnualReturnPct: number;
  amazonStockAnnualReturnPct: number;
  k401ContributionPctInput: number;
  employerMatchPct: number;
  employerMatchLimitPct: number;
  maxYears: number;
  monthlyRent: number;
  monthlyParking: number;
  monthlyHealthDentalBenefits: number;
  otherMonthlyFixedExpenses: number;
  studentLoanBalance: number;
  studentLoanInterestRatePct: number;
  payStudentLoanBeforeInvesting: boolean;
  useActualFirstMonthPaycheck: boolean;
  firstMonthRegularGross: number;
  firstMonthSigningBonus: number;
  firstMonthTakeHome: number;
  firstMonthEmployee401k: number;
  firstMonthEmployer401k: number;
  useActualFirstMonthContributionAllocation: boolean;
  firstMonthActualStudentLoanPayment: number;
  firstMonthActualTaxableFundContribution: number;
}

export interface ProjectionAssumptions {
  baseSalary: number;
  initialRsuGrantValue: number;
  monthsAtAmazon: number;
  futureAnnualRefreshGrantValue: number;
  annualRaisePct: number;
  useSalaryGrowthForRefreshers: boolean;
  currentNetWorth: number;
  current401kBalance: number;
  currentAmazonStockBalance: number;
  extraInvestmentPct: number;
  fundAnnualReturn: number;
  amazonStockAnnualReturn: number;
  k401ContributionPct: number;
  employerMatchPct: number;
  employerMatchLimitPct: number;
  maxYears: number;
  monthlyRent: number;
  monthlyParking: number;
  monthlyHealthDentalBenefits: number;
  otherMonthlyFixedExpenses: number;
  studentLoanBalance: number;
  studentLoanInterestRate: number;
  payStudentLoanBeforeInvesting: boolean;
  useActualFirstMonthPaycheck: boolean;
  firstMonthRegularGross: number;
  firstMonthSigningBonus: number;
  firstMonthTakeHome: number;
  firstMonthEmployee401k: number;
  firstMonthEmployer401k: number;
  actualMonthlyOverrides: ActualMonthlyOverride[];
}

interface ActualMonthlyOverride {
  month: number;
  label: string;
  useActualContributionAllocation: boolean;
  studentLoanPayment: number;
  taxableFundContribution: number;
}

export interface ProjectionEvent {
  month: number | null;
  type: EventType;
  amount: number;
  source?: string;
  destination?: string;
  taxTreatment?: string;
  meta?: Record<string, unknown>;
}

export interface AnnualTaxes {
  federalTaxableIncome: number;
  federalIncomeTax: number;
  socialSecurityTax: number;
  medicareTax: number;
  stateIncomeTax: number;
  totalTax: number;
}

interface AnnualTaxPlanYear {
  yearIndex: number;
  label: string;
  startMonth: number;
  endMonth: number;
  salaryIncome: number;
  rsuIncome: number;
  ordinaryIncome: number;
  preTax401kContribution: number;
  taxes: AnnualTaxes;
  taxAllocatedToSalary: number;
  taxAllocatedToRsus: number;
}

export interface AnnualTaxPlanDisplayRow extends Omit<AnnualTaxPlanYear, "taxes"> {
  totalTax: number;
  netRsu: number;
}

export interface ProjectionRow {
  month: number;
  date: string;
  netWorth: number;
  k401: number;
  taxableFund: number;
  amazonStock: number;
  studentLoan: number;
  grossRsuVested: number;
  netRsuAdded: number;
  taxPaid: number;
  fixedExpenses: number;
  fixedExpensesForCashFlow: number;
  maxExtraFundContribution: number;
  taxableFundContribution: number;
  contributionMode: string;
  requestedExtraContribution: number;
  modeledAvailableExtraContribution: number;
  studentLoanPayment: number;
  studentLoanBalance: number;
  studentLoanInterest: number;
  cashShortfall: number;
}

export interface EventSummaryRow {
  type: EventType;
  label: string;
  count: number;
  amount: number;
}

export interface ProjectionResult {
  rows: ProjectionRow[];
  monthlyRows: ProjectionRow[];
  annualTaxPlan: AnnualTaxPlanDisplayRow[];
  allEvents: ProjectionEvent[];
  externalEvents: ProjectionEvent[];
  generatedEvents: ProjectionEvent[];
  rsuVestEvents: ProjectionEvent[];
  hitMonth: number | null;
  annual401kEmployee: number;
  annual401kEmployer: number;
  monthly401kEmployee: number;
  monthly401kEmployer: number;
  firstYearTaxEstimate: AnnualTaxes;
  firstYearOrdinaryIncome: number;
  firstYearFederalTaxableIncome: number;
  firstYearTotalTax: number;
  firstYearSalaryTax: number;
  firstYearRsuTax: number;
  totalTaxPaid: number;
  totalGrossRsuVested: number;
  totalNetRsuAdded: number;
  totalFundContributions: number;
  totalStudentLoanPayments: number;
  totalStudentLoanInterest: number;
  studentLoanPaidOffMonth: number | null;
  totalUninvestedCash: number;
  totalFixedExpenses: number;
  totalCashShortfall: number;
  monthlyFixedExpenses: number;
  firstMonthAfterTaxCashAfter401k: number;
  firstMonthMaxExtraFundContribution: number;
  firstMonthMaxExtraFundPct: number;
}

interface Balances {
  k401: number;
  taxableFund: number;
  studentLoan: number;
  amazonStock: number;
}

interface EventInput {
  month: number | null;
  type: EventType;
  amount: number;
  source?: string;
  destination?: string;
  taxTreatment?: string;
  meta?: Record<string, unknown>;
}

interface ProcessMonthResult {
  generatedEvents: ProjectionEvent[];
  metrics: MonthlyMetrics;
}

interface MonthlyMetrics {
  salaryGross: number;
  preTax401k: number;
  employer401k: number;
  fixedExpenses: number;
  fixedExpensesForCashFlow: number;
  salaryTax: number;
  rsuTax: number;
  taxPaid: number;
  grossRsuVested: number;
  netRsuAdded: number;
  afterTaxCashAfter401k: number;
  maxExtraFundContribution: number;
  maxExtraFundPct: number;
  taxableFundContribution: number;
  contributionMode: string;
  requestedExtraContribution: number;
  modeledAvailableExtraContribution: number;
  studentLoanPayment: number;
  studentLoanBalance: number;
  studentLoanInterest: number;
  uninvestedCash: number;
  cashShortfall: number;
  netWorth: number;
}

export const DEFAULT_FORM_STATE: ProjectionFormState = {
  baseSalary: 129000,
  initialRsuGrantValue: 140000,
  monthsAtAmazon: 24,
  futureAnnualRefreshGrantValue: Math.round(129000 * DEFAULT_REFRESHER_PCT_OF_BASE),
  annualRaisePct: 3,
  useSalaryGrowthForRefreshers: true,
  currentNetWorth: 50000,
  current401kBalance: 10000,
  currentAmazonStockBalance: 0,
  extraInvestmentPct: 15,
  fundAnnualReturnPct: 5,
  amazonStockAnnualReturnPct: 5,
  k401ContributionPctInput: 4,
  employerMatchPct: 50,
  employerMatchLimitPct: 4,
  maxYears: 50,
  monthlyRent: 2578,
  monthlyParking: 275,
  monthlyHealthDentalBenefits: 500,
  otherMonthlyFixedExpenses: 0,
  studentLoanBalance: 60000,
  studentLoanInterestRatePct: 13,
  payStudentLoanBeforeInvesting: true,
  useActualFirstMonthPaycheck: true,
  firstMonthRegularGross: 9283.83,
  firstMonthSigningBonus: 50100,
  firstMonthTakeHome: 41330.61,
  firstMonthEmployee401k: 0,
  firstMonthEmployer401k: 0,
  useActualFirstMonthContributionAllocation: false,
  firstMonthActualStudentLoanPayment: 0,
  firstMonthActualTaxableFundContribution: 0,
};

function clampNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function monthLabel(monthsFromNow: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() + monthsFromNow);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function yearLabel(monthsFromNow: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() + monthsFromNow);
  return String(date.getFullYear());
}

function getYearIndex(month: number): number {
  return Math.floor(month / 12);
}

function getProjectionLastMonth(maxYears: number): number {
  return Math.max(0, Math.floor(maxYears * 12) - 1);
}

function getAnnualReturn(accountKey: AccountKey, assumptions: ProjectionAssumptions): number {
  switch (ACCOUNT_CONFIG[accountKey].annualReturnSource) {
    case "amazonStockAnnualReturn":
      return assumptions.amazonStockAnnualReturn;
    case "studentLoanInterestRate":
      return assumptions.studentLoanInterestRate;
    case "fundAnnualReturn":
    default:
      return assumptions.fundAnnualReturn;
  }
}

export function getBaseSalaryForMonth(assumptions: ProjectionAssumptions, month: number): number {
  return assumptions.baseSalary * Math.pow(1 + assumptions.annualRaisePct, getYearIndex(month));
}

function getMonthlyBaseSalary(assumptions: ProjectionAssumptions, month: number): number {
  return getBaseSalaryForMonth(assumptions, month) / 12;
}

function getAnnual401kEmployeeForMonth(assumptions: ProjectionAssumptions, month: number): number {
  return Math.min(getBaseSalaryForMonth(assumptions, month) * assumptions.k401ContributionPct, EMPLOYEE_401K_LIMIT_2026);
}

function getAnnual401kEmployerForMonth(assumptions: ProjectionAssumptions, month: number): number {
  return getBaseSalaryForMonth(assumptions, month) * Math.min(assumptions.k401ContributionPct, assumptions.employerMatchLimitPct) * assumptions.employerMatchPct;
}

function getFutureRefreshGrantValueForMonth(assumptions: ProjectionAssumptions, month: number): number {
  if (!assumptions.useSalaryGrowthForRefreshers) return assumptions.futureAnnualRefreshGrantValue;
  return getBaseSalaryForMonth(assumptions, month) * DEFAULT_REFRESHER_PCT_OF_BASE;
}

function createEvent({ month, type, amount, source, destination, taxTreatment, meta = {} }: EventInput): ProjectionEvent {
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

function getActualMonthOverride(assumptions: ProjectionAssumptions, month: number): ActualMonthlyOverride | null {
  return assumptions.actualMonthlyOverrides.find((override) => override.month === month) ?? null;
}

function calculateProgressiveTax(taxableIncome: number, brackets: ReadonlyArray<{ upTo: number; rate: number }>): number {
  let tax = 0;
  let previous = 0;

  for (const bracket of brackets) {
    if (taxableIncome <= previous) break;
    const amountInBracket = Math.min(taxableIncome, bracket.upTo) - previous;
    tax += amountInBracket * bracket.rate;
    previous = bracket.upTo;
  }

  return tax;
}

function estimateAnnualTaxes({ ordinaryIncome, preTax401kContribution }: { ordinaryIncome: number; preTax401kContribution: number }): AnnualTaxes {
  const taxProfile = MODEL.taxProfile;
  const federalTaxableIncome = Math.max(0, ordinaryIncome - preTax401kContribution - taxProfile.standardDeduction);
  const federalIncomeTax = calculateProgressiveTax(federalTaxableIncome, taxProfile.brackets);
  const socialSecurityTax = Math.min(ordinaryIncome, taxProfile.socialSecurityWageBase) * taxProfile.socialSecurityRate;
  const medicareTax = ordinaryIncome * taxProfile.medicareRate + Math.max(0, ordinaryIncome - taxProfile.additionalMedicareThreshold) * taxProfile.additionalMedicareRate;
  const stateIncomeTax = ordinaryIncome * taxProfile.stateIncomeTaxRate;
  const totalTax = federalIncomeTax + socialSecurityTax + medicareTax + stateIncomeTax;

  return {
    federalTaxableIncome,
    federalIncomeTax,
    socialSecurityTax,
    medicareTax,
    stateIncomeTax,
    totalTax,
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

function createSalaryEvents(assumptions: ProjectionAssumptions, projectionLastMonth: number): ProjectionEvent[] {
  return Array.from({ length: projectionLastMonth + 1 }, (_, month) => {
    const amount = month === 0 && assumptions.useActualFirstMonthPaycheck
      ? assumptions.firstMonthRegularGross
      : getMonthlyBaseSalary(assumptions, month);

    return createEvent({
      month,
      amount,
      type: EVENT_TYPES.ORDINARY_INCOME,
      source: "base-salary",
      taxTreatment: "ordinary-income",
      meta: {
        bucket: "salary",
        annualBaseSalary: getBaseSalaryForMonth(assumptions, month),
        actualFirstMonthOverride: month === 0 && assumptions.useActualFirstMonthPaycheck,
      },
    });
  });
}

function createSigningBonusEvents(assumptions: ProjectionAssumptions): ProjectionEvent[] {
  if (!assumptions.useActualFirstMonthPaycheck || assumptions.firstMonthSigningBonus <= 0) return [];

  return [
    createEvent({
      month: 0,
      amount: assumptions.firstMonthSigningBonus,
      type: EVENT_TYPES.ORDINARY_INCOME,
      source: "signing-bonus",
      taxTreatment: "ordinary-income",
      meta: { bucket: "salary", label: "Signing bonus" },
    }),
  ];
}

function create401kEvents(assumptions: ProjectionAssumptions, projectionLastMonth: number) {
  const events: ProjectionEvent[] = [];
  let firstMonthEmployee = 0;
  let firstMonthEmployer = 0;
  let firstYearEmployee = 0;
  let firstYearEmployer = 0;

  for (let month = 0; month <= projectionLastMonth; month += 1) {
    const monthly401kEmployee = month === 0 && assumptions.useActualFirstMonthPaycheck
      ? assumptions.firstMonthEmployee401k
      : getAnnual401kEmployeeForMonth(assumptions, month) / 12;
    const monthly401kEmployer = month === 0 && assumptions.useActualFirstMonthPaycheck
      ? assumptions.firstMonthEmployer401k
      : getAnnual401kEmployerForMonth(assumptions, month) / 12;

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
    annual401kEmployee: firstYearEmployee,
    annual401kEmployer: firstYearEmployer,
    monthly401kEmployee: firstMonthEmployee,
    monthly401kEmployer: firstMonthEmployer,
    events,
  };
}

function createExpenseEvents(assumptions: ProjectionAssumptions, projectionLastMonth: number): ProjectionEvent[] {
  const items = [
    { source: "rent", amount: assumptions.monthlyRent },
    { source: "parking", amount: assumptions.monthlyParking },
    { source: "health-dental-benefits", amount: assumptions.monthlyHealthDentalBenefits },
    { source: "other-fixed-expenses", amount: assumptions.otherMonthlyFixedExpenses },
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

function createAnnualRefreshRsuEvents(assumptions: ProjectionAssumptions, projectionLastMonth: number): ProjectionEvent[] {
  const events: ProjectionEvent[] = [];
  const firstRefreshGrantMonth = Math.max(24, assumptions.monthsAtAmazon + 12);

  for (let grantMonth = firstRefreshGrantMonth; grantMonth <= projectionLastMonth; grantMonth += 12) {
    const grantValue = getFutureRefreshGrantValueForMonth(assumptions, grantMonth);
    if (grantValue <= 0) continue;

    events.push(
      ...createRsuVestEvents({
        grantValue,
        planKey: "amazonAnnualRefresher",
        grantStartMonth: grantMonth,
        employeeMonthAtProjectionStart: assumptions.monthsAtAmazon,
      })
    );
  }

  return events.filter((event) => (event.month ?? -1) <= projectionLastMonth);
}

function createCompensationEvents(assumptions: ProjectionAssumptions, projectionLastMonth: number): ProjectionEvent[] {
  return [
    ...createSalaryEvents(assumptions, projectionLastMonth),
    ...createSigningBonusEvents(assumptions),
    ...createRsuVestEvents({
      grantValue: assumptions.initialRsuGrantValue,
      planKey: "amazonInitial",
      grantStartMonth: 0,
      employeeMonthAtProjectionStart: assumptions.monthsAtAmazon,
    }),
    ...createAnnualRefreshRsuEvents(assumptions, projectionLastMonth),
  ];
}

function groupEventsByMonth(events: ProjectionEvent[]): Map<number, ProjectionEvent[]> {
  const byMonth = new Map<number, ProjectionEvent[]>();
  for (const event of events) {
    if (event.month === null) continue;
    if (!byMonth.has(event.month)) byMonth.set(event.month, []);
    byMonth.get(event.month)?.push(event);
  }
  return byMonth;
}

function sumEvents(events: ProjectionEvent[], predicate: (event: ProjectionEvent) => boolean): number {
  return events.reduce((sum, event) => (predicate(event) ? sum + event.amount : sum), 0);
}

function buildAnnualTaxPlan(ledgerEvents: ProjectionEvent[], projectionLastMonth: number): AnnualTaxPlanYear[] {
  const yearCount = Math.ceil((projectionLastMonth + 1) / 12);
  const annualPlan: AnnualTaxPlanYear[] = [];

  for (let yearIndex = 0; yearIndex < yearCount; yearIndex += 1) {
    const startMonth = yearIndex * 12;
    const endMonth = Math.min(projectionLastMonth, startMonth + 11);
    const yearEvents = ledgerEvents.filter((event) => event.month !== null && event.month >= startMonth && event.month <= endMonth);
    const salaryIncome = sumEvents(yearEvents, (event) => event.type === EVENT_TYPES.ORDINARY_INCOME && event.meta?.bucket === "salary");
    const rsuIncome = sumEvents(yearEvents, (event) => event.type === EVENT_TYPES.VEST && event.taxTreatment === "ordinary-income");
    const preTax401kContribution = sumEvents(yearEvents, (event) => event.type === EVENT_TYPES.PRE_TAX_DEDUCTION && event.destination === "k401");
    const ordinaryIncome = salaryIncome + rsuIncome;
    const taxes = estimateAnnualTaxes({ ordinaryIncome, preTax401kContribution });
    const totalIncomeForAllocation = Math.max(1, ordinaryIncome);

    annualPlan.push({
      yearIndex,
      label: yearLabel(startMonth),
      startMonth,
      endMonth,
      salaryIncome,
      rsuIncome,
      ordinaryIncome,
      preTax401kContribution,
      taxes,
      taxAllocatedToSalary: taxes.totalTax * (salaryIncome / totalIncomeForAllocation),
      taxAllocatedToRsus: taxes.totalTax * (rsuIncome / totalIncomeForAllocation),
    });
  }

  return annualPlan;
}

function createTaxEvents(annualTaxPlan: AnnualTaxPlanYear[]): ProjectionEvent[] {
  return annualTaxPlan.flatMap((year) => {
    const events: ProjectionEvent[] = [];
    const activeMonths = year.endMonth - year.startMonth + 1;
    const monthlySalaryTax = year.taxAllocatedToSalary / activeMonths;
    const monthlyRsuTax = year.taxAllocatedToRsus / activeMonths;

    for (let month = year.startMonth; month <= year.endMonth; month += 1) {
      events.push(
        createEvent({
          month,
          type: EVENT_TYPES.TAX,
          amount: monthlySalaryTax,
          source: "estimated-salary-tax",
          taxTreatment: "tax-liability",
          meta: { bucket: "salary" },
        })
      );
      events.push(
        createEvent({
          month,
          type: EVENT_TYPES.TAX,
          amount: monthlyRsuTax,
          source: "estimated-rsu-tax",
          taxTreatment: "tax-liability",
          meta: { bucket: "rsu" },
        })
      );
    }

    return events;
  });
}

function applyMonthlyReturns(balances: Balances, assumptions: ProjectionAssumptions): ProjectionEvent[] {
  const interestEvents: ProjectionEvent[] = [];

  (Object.keys(ACCOUNT_CONFIG) as AccountKey[]).forEach((accountKey) => {
    const monthlyReturn = Math.pow(1 + getAnnualReturn(accountKey, assumptions), 1 / 12) - 1;

    if (accountKey === "studentLoan") {
      const currentDebt = Math.max(0, -balances.studentLoan);
      const interest = currentDebt * monthlyReturn;
      balances.studentLoan -= interest;

      if (interest > 0) {
        interestEvents.push(
          createEvent({
            month: null,
            type: EVENT_TYPES.INTEREST,
            amount: interest,
            source: "student-loan-interest",
            destination: "studentLoan",
            taxTreatment: "after-tax",
          })
        );
      }

      return;
    }

    balances[accountKey] *= 1 + monthlyReturn;
  });

  return interestEvents;
}

function processMonth({
  month,
  events,
  balances,
  assumptions,
  annualTaxPlan,
}: {
  month: number;
  events: ProjectionEvent[];
  balances: Balances;
  assumptions: ProjectionAssumptions;
  annualTaxPlan: AnnualTaxPlanYear[];
}): ProcessMonthResult {
  const yearPlan = annualTaxPlan[Math.floor(month / 12)];

  const salaryGross = sumEvents(events, (event) => event.type === EVENT_TYPES.ORDINARY_INCOME && event.meta?.bucket === "salary");
  const preTax401k = sumEvents(events, (event) => event.type === EVENT_TYPES.PRE_TAX_DEDUCTION && event.destination === "k401");
  const employer401k = sumEvents(events, (event) => event.type === EVENT_TYPES.EMPLOYER_CONTRIBUTION && event.destination === "k401");
  const fixedExpenses = sumEvents(events, (event) => event.type === EVENT_TYPES.EXPENSE);
  const fixedExpensesForCashFlow = month === 0 && assumptions.useActualFirstMonthPaycheck
    ? Math.max(0, fixedExpenses - assumptions.monthlyHealthDentalBenefits)
    : fixedExpenses;
  const salaryTax = sumEvents(events, (event) => event.type === EVENT_TYPES.TAX && event.meta?.bucket === "salary");
  const grossRsuVested = sumEvents(events, (event) => event.type === EVENT_TYPES.VEST && event.destination === "amazonStock");
  const rsuTaxRateForYear = yearPlan?.rsuIncome ? yearPlan.taxAllocatedToRsus / yearPlan.rsuIncome : 0;
  const rsuTax = grossRsuVested * rsuTaxRateForYear;
  const netRsuAdded = Math.max(0, grossRsuVested - rsuTax);

  const afterTaxCashAfter401k = month === 0 && assumptions.useActualFirstMonthPaycheck
    ? assumptions.firstMonthTakeHome
    : Math.max(0, salaryGross - preTax401k - salaryTax);
  const cashAfterFixedExpenses = afterTaxCashAfter401k - fixedExpensesForCashFlow;
  const maxExtraFundContribution = Math.max(0, cashAfterFixedExpenses);
  const maxExtraFundPct = afterTaxCashAfter401k > 0 ? maxExtraFundContribution / afterTaxCashAfter401k : 0;
  const requestedExtraContribution = afterTaxCashAfter401k * assumptions.extraInvestmentPct;
  const modeledAvailableExtraContribution = Math.min(requestedExtraContribution, maxExtraFundContribution);

  const interestEvents = applyMonthlyReturns(balances, assumptions).map((event) => ({ ...event, month }));
  const studentLoanDebtBeforePayment = Math.max(0, -balances.studentLoan);
  const actualOverride = getActualMonthOverride(assumptions, month);

  let studentLoanPayment: number;
  let taxableFundContribution: number;
  let contributionMode: string;

  if (actualOverride?.useActualContributionAllocation) {
    studentLoanPayment = Math.min(
      Math.max(0, actualOverride.studentLoanPayment ?? 0),
      studentLoanDebtBeforePayment,
      maxExtraFundContribution
    );
    taxableFundContribution = Math.min(
      Math.max(0, actualOverride.taxableFundContribution ?? 0),
      Math.max(0, maxExtraFundContribution - studentLoanPayment)
    );
    contributionMode = "actual";
  } else {
    studentLoanPayment = assumptions.payStudentLoanBeforeInvesting
      ? Math.min(modeledAvailableExtraContribution, studentLoanDebtBeforePayment)
      : 0;
    taxableFundContribution = modeledAvailableExtraContribution - studentLoanPayment;
    contributionMode = "projected";
  }

  const totalActualOrModeledExtraContribution = studentLoanPayment + taxableFundContribution;
  const uninvestedCash = Math.max(0, cashAfterFixedExpenses - totalActualOrModeledExtraContribution);
  const cashShortfall = Math.max(0, -cashAfterFixedExpenses);

  balances.k401 += preTax401k + employer401k;
  balances.taxableFund += taxableFundContribution;
  balances.amazonStock += netRsuAdded;
  balances.studentLoan += studentLoanPayment;

  const generatedEvents: ProjectionEvent[] = [
    ...interestEvents,
    createEvent({
      month,
      type: EVENT_TYPES.DEBT_PAYMENT,
      amount: studentLoanPayment,
      source: "after-tax-cash",
      destination: "studentLoan",
      taxTreatment: "after-tax",
    }),
    createEvent({
      month,
      type: EVENT_TYPES.TRANSFER,
      amount: taxableFundContribution,
      source: "after-tax-cash",
      destination: "taxableFund",
      taxTreatment: "after-tax",
    }),
    createEvent({
      month,
      type: EVENT_TYPES.VEST,
      amount: netRsuAdded,
      source: "after-tax-rsu-shares",
      destination: "amazonStock",
      taxTreatment: "after-tax",
      meta: { grossRsuVested, rsuTax },
    }),
  ];

  if (cashShortfall > 0) {
    generatedEvents.push(
      createEvent({
        month,
        type: EVENT_TYPES.SHORTFALL,
        amount: cashShortfall,
        source: "cash-flow-shortfall",
        taxTreatment: "after-tax",
      })
    );
  }

  const netWorth = (Object.keys(ACCOUNT_CONFIG) as AccountKey[]).reduce((sum, key) => sum + balances[key], 0);
  const studentLoanBalance = Math.max(0, -balances.studentLoan);

  return {
    generatedEvents,
    metrics: {
      salaryGross,
      preTax401k,
      employer401k,
      fixedExpenses,
      fixedExpensesForCashFlow,
      salaryTax,
      rsuTax,
      taxPaid: salaryTax + rsuTax,
      grossRsuVested,
      netRsuAdded,
      afterTaxCashAfter401k,
      maxExtraFundContribution,
      maxExtraFundPct,
      taxableFundContribution,
      contributionMode,
      requestedExtraContribution,
      modeledAvailableExtraContribution,
      studentLoanPayment,
      studentLoanBalance,
      studentLoanInterest: interestEvents.reduce((sum, event) => sum + event.amount, 0),
      uninvestedCash,
      cashShortfall,
      netWorth,
    },
  };
}

export function project(assumptions: ProjectionAssumptions): ProjectionResult {
  const projectionLastMonth = getProjectionLastMonth(assumptions.maxYears);
  const balances: Balances = {
    k401: assumptions.current401kBalance,
    amazonStock: assumptions.currentAmazonStockBalance,
    taxableFund: Math.max(0, assumptions.currentNetWorth - assumptions.current401kBalance - assumptions.currentAmazonStockBalance),
    studentLoan: -Math.max(0, assumptions.studentLoanBalance),
  };

  const compensationEvents = createCompensationEvents(assumptions, projectionLastMonth);
  const expenseEvents = createExpenseEvents(assumptions, projectionLastMonth);
  const k401Model = create401kEvents(assumptions, projectionLastMonth);
  const preTaxLedgerEvents = [...compensationEvents, ...expenseEvents, ...k401Model.events];
  const annualTaxPlan = buildAnnualTaxPlan(preTaxLedgerEvents, projectionLastMonth);
  const taxEvents = createTaxEvents(annualTaxPlan);
  const externalEvents = [...preTaxLedgerEvents, ...taxEvents];
  const eventsByMonth = groupEventsByMonth(externalEvents);

  const rows: ProjectionRow[] = [];
  const monthlyRows: ProjectionRow[] = [];
  const generatedEvents: ProjectionEvent[] = [];
  let hitMonth: number | null = null;
  let totalTaxPaid = 0;
  let totalGrossRsuVested = 0;
  let totalNetRsuAdded = 0;
  let totalFundContributions = 0;
  let totalStudentLoanPayments = 0;
  let totalStudentLoanInterest = 0;
  let studentLoanPaidOffMonth: number | null = null;
  let totalUninvestedCash = 0;
  let totalFixedExpenses = 0;
  let totalCashShortfall = 0;
  let firstMonthAfterTaxCashAfter401k = 0;
  let firstMonthMaxExtraFundContribution = 0;
  let firstMonthMaxExtraFundPct = 0;

  for (let month = 0; month <= projectionLastMonth; month += 1) {
    const events = eventsByMonth.get(month) ?? [];
    const { generatedEvents: monthGeneratedEvents, metrics } = processMonth({
      month,
      events,
      balances,
      assumptions,
      annualTaxPlan,
    });

    generatedEvents.push(...monthGeneratedEvents);

    if (month === 0) {
      firstMonthAfterTaxCashAfter401k = metrics.afterTaxCashAfter401k;
      firstMonthMaxExtraFundContribution = metrics.maxExtraFundContribution;
      firstMonthMaxExtraFundPct = metrics.maxExtraFundPct;
    }

    totalTaxPaid += metrics.taxPaid;
    totalGrossRsuVested += metrics.grossRsuVested;
    totalNetRsuAdded += metrics.netRsuAdded;
    totalFundContributions += metrics.taxableFundContribution;
    totalStudentLoanPayments += metrics.studentLoanPayment;
    totalStudentLoanInterest += metrics.studentLoanInterest;

    if (studentLoanPaidOffMonth === null && assumptions.studentLoanBalance > 0 && metrics.studentLoanBalance <= 0.01) {
      studentLoanPaidOffMonth = month;
    }

    totalUninvestedCash += metrics.uninvestedCash;
    totalFixedExpenses += metrics.fixedExpenses;
    totalCashShortfall += metrics.cashShortfall;

    const row: ProjectionRow = {
      month,
      date: monthLabel(month),
      netWorth: Math.round(metrics.netWorth),
      k401: Math.round(balances.k401),
      taxableFund: Math.round(balances.taxableFund),
      amazonStock: Math.round(balances.amazonStock),
      studentLoan: Math.round(balances.studentLoan),
      grossRsuVested: Math.round(metrics.grossRsuVested),
      netRsuAdded: Math.round(metrics.netRsuAdded),
      taxPaid: Math.round(metrics.taxPaid),
      fixedExpenses: Math.round(metrics.fixedExpenses),
      fixedExpensesForCashFlow: Math.round(metrics.fixedExpensesForCashFlow),
      maxExtraFundContribution: Math.round(metrics.maxExtraFundContribution),
      taxableFundContribution: Math.round(metrics.taxableFundContribution),
      contributionMode: metrics.contributionMode,
      requestedExtraContribution: Math.round(metrics.requestedExtraContribution),
      modeledAvailableExtraContribution: Math.round(metrics.modeledAvailableExtraContribution),
      studentLoanPayment: Math.round(metrics.studentLoanPayment),
      studentLoanBalance: Math.round(metrics.studentLoanBalance),
      studentLoanInterest: Math.round(metrics.studentLoanInterest),
      cashShortfall: Math.round(metrics.cashShortfall),
    };

    monthlyRows.push(row);

    const isQuarterBoundary = month % 3 === 0;
    const isLastMonth = month === projectionLastMonth;
    const hitTargetThisMonth = metrics.netWorth >= MODEL.targetNetWorth;

    if (isQuarterBoundary || isLastMonth || hitTargetThisMonth) {
      rows.push(row);
    }

    if (hitTargetThisMonth && hitMonth === null) {
      hitMonth = month;
      break;
    }
  }

  const displayedAnnualPlan: AnnualTaxPlanDisplayRow[] = annualTaxPlan.slice(0, Math.min(6, annualTaxPlan.length)).map((year) => ({
    ...year,
    salaryIncome: Math.round(year.salaryIncome),
    rsuIncome: Math.round(year.rsuIncome),
    ordinaryIncome: Math.round(year.ordinaryIncome),
    preTax401kContribution: Math.round(year.preTax401kContribution),
    taxAllocatedToSalary: Math.round(year.taxAllocatedToSalary),
    taxAllocatedToRsus: Math.round(year.taxAllocatedToRsus),
    totalTax: Math.round(year.taxes.totalTax),
    netRsu: Math.round(year.rsuIncome - year.taxAllocatedToRsus),
  }));

  const allEvents = [...externalEvents, ...generatedEvents];
  const firstYear = annualTaxPlan[0];

  return {
    rows,
    monthlyRows,
    annualTaxPlan: displayedAnnualPlan,
    allEvents,
    externalEvents,
    generatedEvents,
    rsuVestEvents: compensationEvents.filter((event) => event.type === EVENT_TYPES.VEST),
    hitMonth,
    annual401kEmployee: k401Model.annual401kEmployee,
    annual401kEmployer: k401Model.annual401kEmployer,
    monthly401kEmployee: k401Model.monthly401kEmployee,
    monthly401kEmployer: k401Model.monthly401kEmployer,
    firstYearTaxEstimate: firstYear?.taxes ?? estimateAnnualTaxes({ ordinaryIncome: 0, preTax401kContribution: 0 }),
    firstYearOrdinaryIncome: firstYear?.ordinaryIncome ?? 0,
    firstYearFederalTaxableIncome: firstYear?.taxes.federalTaxableIncome ?? 0,
    firstYearTotalTax: firstYear?.taxes.totalTax ?? 0,
    firstYearSalaryTax: firstYear?.taxAllocatedToSalary ?? 0,
    firstYearRsuTax: firstYear?.taxAllocatedToRsus ?? 0,
    totalTaxPaid,
    totalGrossRsuVested,
    totalNetRsuAdded,
    totalFundContributions,
    totalStudentLoanPayments,
    totalStudentLoanInterest,
    studentLoanPaidOffMonth,
    totalUninvestedCash,
    totalFixedExpenses,
    totalCashShortfall,
    monthlyFixedExpenses: assumptions.monthlyRent + assumptions.monthlyParking + assumptions.monthlyHealthDentalBenefits + assumptions.otherMonthlyFixedExpenses,
    firstMonthAfterTaxCashAfter401k,
    firstMonthMaxExtraFundContribution,
    firstMonthMaxExtraFundPct,
  };
}

export function summarizeEventsByType(events: ProjectionEvent[]): EventSummaryRow[] {
  return Object.values(EVENT_TYPES)
    .map((type) => ({
      type,
      label: type.replace(/_/g, " "),
      count: events.filter((event) => event.type === type).length,
      amount: events.reduce((sum, event) => (event.type === type ? sum + event.amount : sum), 0),
    }))
    .filter((row) => row.count > 0);
}

export function buildAssumptionsFromState(state: ProjectionFormState): ProjectionAssumptions {
  return {
    baseSalary: clampNumber(state.baseSalary),
    initialRsuGrantValue: clampNumber(state.initialRsuGrantValue),
    monthsAtAmazon: clampNumber(state.monthsAtAmazon),
    futureAnnualRefreshGrantValue: clampNumber(state.futureAnnualRefreshGrantValue),
    annualRaisePct: clampNumber(state.annualRaisePct) / 100,
    useSalaryGrowthForRefreshers: state.useSalaryGrowthForRefreshers,
    currentNetWorth: clampNumber(state.currentNetWorth),
    current401kBalance: clampNumber(state.current401kBalance),
    currentAmazonStockBalance: clampNumber(state.currentAmazonStockBalance),
    extraInvestmentPct: clampNumber(state.extraInvestmentPct) / 100,
    fundAnnualReturn: clampNumber(state.fundAnnualReturnPct) / 100,
    amazonStockAnnualReturn: clampNumber(state.amazonStockAnnualReturnPct) / 100,
    k401ContributionPct: clampNumber(state.k401ContributionPctInput) / 100,
    employerMatchPct: clampNumber(state.employerMatchPct) / 100,
    employerMatchLimitPct: clampNumber(state.employerMatchLimitPct) / 100,
    maxYears: clampNumber(state.maxYears, 50),
    monthlyRent: clampNumber(state.monthlyRent),
    monthlyParking: clampNumber(state.monthlyParking),
    monthlyHealthDentalBenefits: clampNumber(state.monthlyHealthDentalBenefits),
    otherMonthlyFixedExpenses: clampNumber(state.otherMonthlyFixedExpenses),
    studentLoanBalance: clampNumber(state.studentLoanBalance),
    studentLoanInterestRate: clampNumber(state.studentLoanInterestRatePct) / 100,
    payStudentLoanBeforeInvesting: state.payStudentLoanBeforeInvesting,
    useActualFirstMonthPaycheck: state.useActualFirstMonthPaycheck,
    firstMonthRegularGross: clampNumber(state.firstMonthRegularGross),
    firstMonthSigningBonus: clampNumber(state.firstMonthSigningBonus),
    firstMonthTakeHome: clampNumber(state.firstMonthTakeHome),
    firstMonthEmployee401k: clampNumber(state.firstMonthEmployee401k),
    firstMonthEmployer401k: clampNumber(state.firstMonthEmployer401k),
    actualMonthlyOverrides: [
      {
        month: 0,
        label: "Actual first month",
        useActualContributionAllocation: state.useActualFirstMonthContributionAllocation,
        studentLoanPayment: clampNumber(state.firstMonthActualStudentLoanPayment),
        taxableFundContribution: clampNumber(state.firstMonthActualTaxableFundContribution),
      },
    ],
  };
}
