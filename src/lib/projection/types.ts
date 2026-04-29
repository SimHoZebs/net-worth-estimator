export type AccountKey = "k401" | "taxableFund" | "studentLoan" | "amazonStock";

export type RsuPlanKey = "amazonInitial" | "amazonAnnualRefresher";

export type EventType =
  | "ordinary_income"
  | "pre_tax_deduction"
  | "employer_contribution"
  | "tax"
  | "expense"
  | "transfer"
  | "vest"
  | "shortfall"
  | "debt_payment"
  | "interest";

export type ContributionMode = "actual" | "projected";

export type ScenarioPath = readonly string[];

export interface ProjectionScenario {
  compensation: {
    baseSalary: number;
    initialRsuGrantValue: number;
    monthsAtAmazon: number;
    futureAnnualRefreshGrantValue: number;
    annualRaisePct: number;
    useSalaryGrowthForRefreshers: boolean;
  };
  balances: {
    currentNetWorth: number;
    current401kBalance: number;
    currentAmazonStockBalance: number;
    studentLoanBalance: number;
  };
  strategy: {
    extraInvestmentPct: number;
    k401ContributionPct: number;
    employerMatchPct: number;
    employerMatchLimitPct: number;
    payStudentLoanBeforeInvesting: boolean;
  };
  market: {
    fundAnnualReturnPct: number;
    amazonStockAnnualReturnPct: number;
    studentLoanInterestRatePct: number;
  };
  expenses: {
    monthlyRent: number;
    monthlyParking: number;
    monthlyHealthDentalBenefits: number;
    otherMonthlyFixedExpenses: number;
  };
  projection: {
    maxYears: number;
  };
  overrides: {
    firstMonth: {
      useActualPaycheck: boolean;
      regularGross: number;
      signingBonus: number;
      takeHome: number;
      employee401k: number;
      employer401k: number;
      useActualContributionAllocation: boolean;
      studentLoanPayment: number;
      taxableFundContribution: number;
    };
  };
}

export interface ActualMonthlyOverride {
  month: number;
  label: string;
  useActualContributionAllocation: boolean;
  studentLoanPayment: number;
  taxableFundContribution: number;
}

export interface ProjectionInput {
  compensation: {
    baseSalary: number;
    initialRsuGrantValue: number;
    monthsAtAmazon: number;
    futureAnnualRefreshGrantValue: number;
    annualRaiseRate: number;
    useSalaryGrowthForRefreshers: boolean;
  };
  balances: {
    currentNetWorth: number;
    current401kBalance: number;
    currentAmazonStockBalance: number;
    studentLoanBalance: number;
  };
  strategy: {
    extraInvestmentRate: number;
    k401ContributionRate: number;
    employerMatchRate: number;
    employerMatchLimitRate: number;
    payStudentLoanBeforeInvesting: boolean;
  };
  market: {
    fundAnnualReturn: number;
    amazonStockAnnualReturn: number;
    studentLoanInterestRate: number;
  };
  expenses: {
    monthlyRent: number;
    monthlyParking: number;
    monthlyHealthDentalBenefits: number;
    otherMonthlyFixedExpenses: number;
  };
  projection: {
    maxYears: number;
    targetNetWorth: number;
  };
  overrides: {
    firstMonth: {
      useActualPaycheck: boolean;
      regularGross: number;
      signingBonus: number;
      takeHome: number;
      employee401k: number;
      employer401k: number;
    };
    actualMonthlyOverrides: ActualMonthlyOverride[];
  };
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

export interface AnnualTaxPlanYear {
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
  contributionMode: ContributionMode;
  requestedExtraContribution: number;
  modeledAvailableExtraContribution: number;
  studentLoanPayment: number;
  studentLoanBalance: number;
  studentLoanInterest: number;
  cashShortfall: number;
}

export interface ProjectionResult {
  timeline: {
    sampledRows: ProjectionRow[];
    monthlyRows: ProjectionRow[];
  };
  taxes: {
    annualPlan: AnnualTaxPlanYear[];
    firstYear: {
      estimate: AnnualTaxes;
      ordinaryIncome: number;
      federalTaxableIncome: number;
      totalTax: number;
      salaryTax: number;
      rsuTax: number;
    };
  };
  events: {
    all: ProjectionEvent[];
    external: ProjectionEvent[];
    generated: ProjectionEvent[];
    rsuVest: ProjectionEvent[];
  };
  contributions: {
    annualEmployee401k: number;
    annualEmployer401k: number;
    monthlyEmployee401k: number;
    monthlyEmployer401k: number;
  };
  milestones: {
    hitTargetMonth: number | null;
    studentLoanPaidOffMonth: number | null;
  };
  totals: {
    taxPaid: number;
    grossRsuVested: number;
    netRsuAdded: number;
    fundContributions: number;
    studentLoanPayments: number;
    studentLoanInterest: number;
    uninvestedCash: number;
    fixedExpenses: number;
    cashShortfall: number;
    monthlyFixedExpenses: number;
  };
  cashFlow: {
    firstMonthAfterTaxCashAfter401k: number;
    firstMonthMaxExtraFundContribution: number;
    firstMonthMaxExtraFundPct: number;
  };
}

export interface EventSummaryRow {
  type: EventType;
  label: string;
  count: number;
  amount: number;
}

export interface DashboardViewModel {
  chartLabelByKey: Record<AccountKey, string>;
  annualTaxPlan: AnnualTaxPlanDisplayRow[];
  hitText: string;
  hitDate: string;
  studentLoanPaidOffText: string;
  studentLoanPaidOffDate: string;
  effectiveTaxRate: number;
  finalNetWorth: number;
  extraContributionIsCapped: boolean;
}

export interface ScenarioDocument {
  version: 1;
  exportedAt: string;
  scenario: ProjectionScenario;
}
