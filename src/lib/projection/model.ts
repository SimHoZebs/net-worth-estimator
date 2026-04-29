import type { AccountKey, EventType, RsuPlanKey } from "./types";

export const ACCOUNT_CONFIG: Record<
  AccountKey,
  {
    label: string;
    color: string;
    annualReturnSource: "fundAnnualReturn" | "studentLoanInterestRate" | "amazonStockAnnualReturn";
  }
> = {
  k401: { label: "401(k)", color: "#2563eb", annualReturnSource: "fundAnnualReturn" },
  taxableFund: { label: "Taxable fund", color: "#f59e0b", annualReturnSource: "fundAnnualReturn" },
  studentLoan: { label: "Student loan", color: "#dc2626", annualReturnSource: "studentLoanInterestRate" },
  amazonStock: { label: "Amazon stock", color: "#7c3aed", annualReturnSource: "amazonStockAnnualReturn" },
};

export const RSU_PLANS: Record<
  RsuPlanKey,
  {
    label: string;
    events: Array<{ month: number; pct: number }>;
  }
> = {
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
};

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

export const EVENT_TYPES: Record<string, EventType> = {
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
};

export const DEFAULT_REFRESHER_PCT_OF_BASE = 0.25;
export const EMPLOYEE_401K_LIMIT_2026 = 24_500;
