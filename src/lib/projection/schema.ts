import { z } from "zod";
import type { CheckpointEntry, ScenarioDefinition, ScenarioDocument } from "./types";

function currentMonthLabel() {
  return new Date().toISOString().slice(0, 7);
}

const monthLabelSchema = z.string().regex(/^\d{4}-\d{2}$/u, "Expected YYYY-MM month label.");
const finiteNumber = z.number().finite();

const scenarioAccountDefinitionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string(),
  kind: z.enum(["cash", "asset", "liability"]),
  openingBalance: finiteNumber,
  annualRate: finiteNumber.optional(),
  color: z.string().optional(),
  minBalance: finiteNumber.optional(),
});

const employmentIncomeModuleSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("employmentIncome"),
  annualBaseSalary: finiteNumber,
  annualRaiseRate: finiteNumber,
  firstMonthActualPaycheck: z.object({
    enabled: z.boolean(),
    regularGross: finiteNumber,
    signingBonus: finiteNumber,
    takeHome: finiteNumber,
  }),
});

const retirementPlanModuleSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("retirementPlan"),
  destinationAccountId: z.string().trim().min(1),
  annualEmployeeLimit: finiteNumber,
  employeeContributionRate: finiteNumber,
  employerMatchRate: finiteNumber,
  employerMatchLimitRate: finiteNumber,
  firstMonthOverride: z.object({
    enabled: z.boolean(),
    employeeContribution: finiteNumber,
    employerContribution: finiteNumber,
  }),
});

const recurringFlowModuleSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("recurringFlow"),
  label: z.string(),
  amount: finiteNumber,
  startMonth: finiteNumber,
  endMonth: finiteNumber.nullable(),
  eventType: z.enum(["ordinary_income", "pre_tax_deduction", "employer_contribution", "tax", "expense", "transfer", "vest", "shortfall", "debt_payment", "interest"]),
  source: z.string(),
  taxTreatment: z.string(),
  skipWhenActualFirstMonthPaycheck: z.boolean().optional(),
});

const oneTimeFlowModuleSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("oneTimeFlow"),
  label: z.string(),
  amount: finiteNumber,
  month: finiteNumber,
  eventType: z.enum(["ordinary_income", "expense"]),
  source: z.string(),
  taxTreatment: z.string(),
});

const scheduledTransferModuleSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("scheduledTransfer"),
  label: z.string(),
  sourceAccountId: z.string().trim().min(1),
  destinationAccountId: z.string().trim().min(1),
  amount: finiteNumber,
  startMonth: finiteNumber,
  endMonth: finiteNumber.nullable(),
  frequencyMonths: finiteNumber,
  destinationDeltaSign: z.union([z.literal(1), z.literal(-1)]),
  eventType: z.enum(["transfer", "debt_payment"]),
  taxTreatment: z.string(),
});

const equityGrantSeriesModuleSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("equityGrantSeries"),
  destinationAccountId: z.string().trim().min(1),
  employeeMonthsAtProjectionStart: finiteNumber,
  initialGrantValue: finiteNumber,
  refreshGrantValue: finiteNumber,
  firstRefreshGrantMonth: finiteNumber,
  refreshFrequencyMonths: finiteNumber,
  useSalaryGrowthForRefreshers: z.boolean(),
  annualRaiseRate: finiteNumber,
  annualBaseSalary: finiteNumber,
  salaryLinkedRefreshPctOfBase: finiteNumber,
  vestingSchedule: z.array(z.object({
    monthOffset: finiteNumber,
    pct: finiteNumber,
  })),
});

const taxModuleSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("tax"),
});

const scenarioModuleSchema = z.discriminatedUnion("type", [
  employmentIncomeModuleSchema,
  retirementPlanModuleSchema,
  recurringFlowModuleSchema,
  oneTimeFlowModuleSchema,
  scheduledTransferModuleSchema,
  equityGrantSeriesModuleSchema,
  taxModuleSchema,
]);

const allocationOverrideStepSchema = z.object({
  destinationAccountId: z.string().trim().min(1),
  destinationDeltaSign: z.union([z.literal(1), z.literal(-1)]),
  amount: finiteNumber,
});

const allocationPolicyStepSchema = z.object({
  destinationAccountId: z.string().trim().min(1),
  destinationDeltaSign: z.union([z.literal(1), z.literal(-1)]),
  mode: z.enum(["allRemaining", "reduceToZero"]),
});

export const scenarioDefinitionSchema = z.object({
  version: z.literal(2).default(2),
  name: z.string(),
  startDate: monthLabelSchema.default(currentMonthLabel()),
  horizonMonths: finiteNumber,
  targetNetWorth: finiteNumber,
  accounts: z.array(scenarioAccountDefinitionSchema),
  modules: z.array(scenarioModuleSchema),
  allocationPolicies: z.array(z.object({
    id: z.string().trim().min(1),
    sourceAccountId: z.string().trim().min(1),
    rateOfAvailable: finiteNumber,
    sweepRemainderFromSource: z.boolean(),
    steps: z.array(allocationPolicyStepSchema),
    overrides: z.array(z.object({
      month: finiteNumber,
      steps: z.array(allocationOverrideStepSchema),
    })),
  })),
}) satisfies z.ZodType<ScenarioDefinition>;

export const scenarioDocumentSchema = z.object({
  version: z.literal(2),
  exportedAt: z.string().datetime({ offset: true }),
  scenario: scenarioDefinitionSchema,
}) satisfies z.ZodType<ScenarioDocument>;

export const checkpointEntrySchema = z.object({
  Date: z.string().trim().refine((value) => !Number.isNaN(new Date(value).getTime()), "Expected a valid date."),
  AccountId: z.string().trim().min(1),
  Balance: z.coerce.number().finite(),
}) satisfies z.ZodType<CheckpointEntry>;

export const checkpointEntriesSchema = z.array(checkpointEntrySchema);
