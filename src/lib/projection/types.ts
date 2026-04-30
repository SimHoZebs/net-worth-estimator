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

export type AllocationMode = "actual" | "projected";

export type ScenarioPath = readonly (string | number)[];

export type ScenarioValidationSeverity = "error" | "warning";

export interface ScenarioValidationIssue {
  code: string;
  message: string;
  path: ScenarioPath;
  severity: ScenarioValidationSeverity;
}

export type ScenarioAccountKind = "cash" | "asset" | "liability";

export interface ScenarioAccountDefinition {
  id: string;
  label: string;
  kind: ScenarioAccountKind;
  openingBalance: number;
  annualRate?: number;
  color?: string;
  minBalance?: number;
}

export interface EmploymentIncomeModule {
  id: string;
  type: "employmentIncome";
  annualBaseSalary: number;
  annualRaiseRate: number;
  firstMonthActualPaycheck: {
    enabled: boolean;
    regularGross: number;
    signingBonus: number;
    takeHome: number;
  };
}

export interface RetirementPlanModule {
  id: string;
  type: "retirementPlan";
  destinationAccountId: string;
  annualEmployeeLimit: number;
  employeeContributionRate: number;
  employerMatchRate: number;
  employerMatchLimitRate: number;
  firstMonthOverride: {
    enabled: boolean;
    employeeContribution: number;
    employerContribution: number;
  };
}

export interface RecurringFlowModule {
  id: string;
  type: "recurringFlow";
  label: string;
  amount: number;
  startMonth: number;
  endMonth: number | null;
  eventType: EventType;
  source: string;
  taxTreatment: string;
  skipWhenActualFirstMonthPaycheck?: boolean;
}

export interface OneTimeFlowModule {
  id: string;
  type: "oneTimeFlow";
  label: string;
  amount: number;
  month: number;
  eventType: "ordinary_income" | "expense";
  source: string;
  taxTreatment: string;
}

export interface ScheduledTransferModule {
  id: string;
  type: "scheduledTransfer";
  label: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  startMonth: number;
  endMonth: number | null;
  frequencyMonths: number;
  destinationDeltaSign: 1 | -1;
  eventType: "transfer" | "debt_payment";
  taxTreatment: string;
}

export interface EquityGrantSeriesModule {
  id: string;
  type: "equityGrantSeries";
  destinationAccountId: string;
  employeeMonthsAtProjectionStart: number;
  initialGrantValue: number;
  refreshGrantValue: number;
  firstRefreshGrantMonth: number;
  refreshFrequencyMonths: number;
  useSalaryGrowthForRefreshers: boolean;
  annualRaiseRate: number;
  annualBaseSalary: number;
  salaryLinkedRefreshPctOfBase: number;
  vestingSchedule: Array<{ monthOffset: number; pct: number }>;
}

export interface TaxModule {
  id: string;
  type: "tax";
}

export type ScenarioModule =
  | EmploymentIncomeModule
  | RetirementPlanModule
  | RecurringFlowModule
  | OneTimeFlowModule
  | ScheduledTransferModule
  | EquityGrantSeriesModule
  | TaxModule;

export type ScenarioModuleType = ScenarioModule["type"];

export interface AllocationOverrideStep {
  destinationAccountId: string;
  destinationDeltaSign: 1 | -1;
  amount: number;
}

export interface AllocationPolicyStep {
  destinationAccountId: string;
  destinationDeltaSign: 1 | -1;
  mode: "allRemaining" | "reduceToZero";
}

export interface AllocationPolicyDefinition {
  id: string;
  sourceAccountId: string;
  rateOfAvailable: number;
  sweepRemainderFromSource: boolean;
  steps: AllocationPolicyStep[];
  overrides: Array<{
    month: number;
    steps: AllocationOverrideStep[];
  }>;
}

export interface ScenarioDefinition {
  version: 2;
  name: string;
  startDate: string;
  horizonMonths: number;
  targetNetWorth: number;
  accounts: ScenarioAccountDefinition[];
  modules: ScenarioModule[];
  allocationPolicies: AllocationPolicyDefinition[];
}

export interface RuntimeEffect {
  accountId: string;
  delta: number;
}

export interface RuntimeOperation {
  month: number;
  amount: number;
  type: EventType;
  emitEvent: boolean;
  source?: string;
  destination?: string;
  taxTreatment?: string;
  meta?: Record<string, unknown>;
  effects: RuntimeEffect[];
}

export interface RuntimeRateRule {
  accountId: string;
  startMonth: number;
  endMonth: number;
  monthlyRate: number;
  type: EventType;
  source?: string;
  destination?: string;
  taxTreatment?: string;
  emitEvent: boolean;
  meta?: Record<string, unknown>;
}

export interface RuntimeMonthState {
  month: number;
  balances: Record<string, number>;
  policyOperations: RuntimeOperation[];
  rateRuleOperations: RuntimeOperation[];
  shortfallOperations: RuntimeOperation[];
  baseOperations: RuntimeOperation[];
  availableCashBeforeAllocation: number;
  requestedAllocation: number;
  realizedAllocation: number;
  sweptRemainder: number;
  usedAllocationOverride: boolean;
}

export interface ProjectionPlan {
  scenario: ScenarioDefinition;
  externalEvents: ProjectionEvent[];
  annualTaxPlan: AnnualTaxPlanYear[];
  scheduledOperations: RuntimeOperation[];
  rateRules: RuntimeRateRule[];
  checkpointsByMonth: Map<number, Record<string, number>>;
  contributionSummary: {
    annualEmployee401k: number;
    annualEmployer401k: number;
    monthlyEmployee401k: number;
    monthlyEmployer401k: number;
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
  isHistorical: boolean;
  netWorth: number;
  accountBalances: Record<string, number>;
  taxPaid: number;
  fixedExpenses: number;
  fixedExpensesForCashFlow: number;
  availableCashBeforeAllocation: number;
  allocationMode: AllocationMode;
  requestedAllocationAmount: number;
  realizedAllocationAmount: number;
  sweptRemainder: number;
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
  };
  milestones: {
    hitTargetMonth: number | null;
    lastReconciledMonth: number | null;
    payoffMonthByLiabilityAccountId: Record<string, number | null>;
  };
  totals: {
    taxPaid: number;
    uninvestedCash: number;
    fixedExpenses: number;
    cashShortfall: number;
    monthlyFixedExpenses: number;
  };
  cashFlow: {
    firstMonthAvailableCashBeforeAllocation: number;
    firstMonthRequestedAllocationAmount: number;
    firstMonthRealizedAllocationAmount: number;
    firstMonthSweptRemainder: number;
  };
}

export interface EventSummaryRow {
  type: EventType;
  label: string;
  count: number;
  amount: number;
}

export interface DashboardViewModel {
  accountLabelsById: Record<string, string>;
  accountColorsById: Record<string, string>;
  assetAccountIds: string[];
  liabilityAccountIds: string[];
  hitText: string;
  hitDate: string;
  finalNetWorth: number;
  totalAccounts: number;
  totalModules: number;
  totalPolicies: number;
  effectiveTaxRate: number;
  endingBalanceRows: Array<{
    accountId: string;
    label: string;
    color: string;
    kind: ScenarioAccountKind;
    openingBalance: number;
    currentBalance: number;
    signedBalance: number;
  }>;
  liabilityRows: Array<{
    accountId: string;
    label: string;
    payoffMonth: number | null;
    payoffDate: string;
    currentBalance: number;
    totalInterest: number;
    totalDebtPayments: number;
  }>;
  retirementRows: Array<{
    accountId: string;
    label: string;
    annualEmployeeContribution: number;
    annualEmployerContribution: number;
    firstMonthEmployeeContribution: number;
    firstMonthEmployerContribution: number;
  }>;
  equityRows: Array<{
    accountId: string;
    label: string;
    grossVested: number;
    netAdded: number;
  }>;
  allocationRows: Array<{
    accountId: string;
    label: string;
    totalTransfersIn: number;
    totalDebtReduction: number;
  }>;
}

export interface ScenarioDocument {
  version: 2;
  exportedAt: string;
  scenario: ScenarioDefinition;
}

export interface CheckpointEntry {
  Date: string;
  AccountId: string;
  Balance: number;
}
