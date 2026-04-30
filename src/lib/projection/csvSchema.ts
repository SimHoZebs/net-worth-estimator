import { z } from "zod";
import type {
  CsvAccount,
  CsvBudgetItem,
  CsvCheckpoint,
  CsvContributionPlan,
  CsvScenarioSettings,
  CsvTransfer,
} from "./csvTypes";

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? Number(trimmed) : Number.NaN;
  }

  return value;
}

function parseOptionalNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" && value.trim().length === 0) {
    return null;
  }

  return parseNumber(value);
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "y"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n"].includes(normalized)) {
      return false;
    }
  }

  return value;
}

function parseNullableString(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const finiteNumber = z.preprocess(parseNumber, z.number().finite());
const nullableNumber = z.preprocess(parseOptionalNumber, z.number().finite().nullable());
const nonNegativeNumber = z.preprocess(parseNumber, z.number().finite().min(0));
const nullableNonNegativeNumber = z.preprocess(parseOptionalNumber, z.number().finite().min(0).nullable());
const positiveInteger = z.preprocess(parseNumber, z.number().int().min(1));
const csvBoolean = z.preprocess(parseBoolean, z.boolean());
const trimmedString = z.string().trim().min(1);
const nullableTrimmedString = z.preprocess(parseNullableString, z.string().trim().min(1).nullable());

export const monthLabelSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/u, "Expected YYYY-MM month label.");

export const csvDateSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Expected a valid date.");

export const csvScenarioHeaders = ["name", "startDate", "horizonMonths", "targetNetWorth"] as const;
export const csvAccountsHeaders = ["id", "label", "balanceType", "category", "openingBalance", "annualRate", "color", "enabled"] as const;
export const csvCheckpointsHeaders = ["Date", "AccountId", "Balance"] as const;
export const csvBudgetItemsHeaders = [
  "id",
  "label",
  "direction",
  "parentBudgetItemId",
  "amountMode",
  "amount",
  "annualGrowthRate",
  "startMonth",
  "endMonth",
  "frequencyMonths",
  "category",
  "enabled",
] as const;
export const csvContributionPlansHeaders = [
  "id",
  "label",
  "targetAccountId",
  "calculationMode",
  "baseBudgetItemId",
  "amount",
  "startMonth",
  "endMonth",
  "frequencyMonths",
  "annualCap",
  "priority",
  "enabled",
] as const;
export const csvTransfersHeaders = [
  "id",
  "label",
  "sourceAccountId",
  "destinationAccountId",
  "amountMode",
  "amount",
  "startMonth",
  "endMonth",
  "frequencyMonths",
  "enabled",
] as const;

export const csvScenarioSettingsSchema = z.object({
  name: trimmedString,
  startDate: monthLabelSchema,
  horizonMonths: positiveInteger,
  targetNetWorth: nonNegativeNumber,
}) satisfies z.ZodType<CsvScenarioSettings>;

export const csvAccountSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  balanceType: z.enum(["asset", "liability"]),
  category: trimmedString,
  openingBalance: nonNegativeNumber,
  annualRate: finiteNumber,
  color: nullableTrimmedString,
  enabled: csvBoolean,
}) satisfies z.ZodType<CsvAccount>;

export const csvCheckpointSchema = z.object({
  Date: csvDateSchema,
  AccountId: trimmedString,
  Balance: nonNegativeNumber,
}) satisfies z.ZodType<CsvCheckpoint>;

export const csvBudgetItemSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  direction: z.enum(["in", "out"]),
  parentBudgetItemId: nullableTrimmedString,
  amountMode: z.enum(["fixed", "percent_of_parent"]),
  amount: nonNegativeNumber,
  annualGrowthRate: finiteNumber,
  startMonth: monthLabelSchema,
  endMonth: z.preprocess(parseNullableString, monthLabelSchema.nullable()),
  frequencyMonths: positiveInteger,
  category: trimmedString,
  enabled: csvBoolean,
}) satisfies z.ZodType<CsvBudgetItem>;

export const csvContributionPlanSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  targetAccountId: trimmedString,
  calculationMode: z.enum(["fixed", "percent_of_capacity", "percent_of_budget_item"]),
  baseBudgetItemId: nullableTrimmedString,
  amount: nonNegativeNumber,
  startMonth: monthLabelSchema,
  endMonth: z.preprocess(parseNullableString, monthLabelSchema.nullable()),
  frequencyMonths: positiveInteger,
  annualCap: nullableNonNegativeNumber,
  priority: positiveInteger,
  enabled: csvBoolean,
}) satisfies z.ZodType<CsvContributionPlan>;

export const csvTransferSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  sourceAccountId: trimmedString,
  destinationAccountId: trimmedString,
  amountMode: z.enum(["fixed"]),
  amount: nonNegativeNumber,
  startMonth: monthLabelSchema,
  endMonth: z.preprocess(parseNullableString, monthLabelSchema.nullable()),
  frequencyMonths: positiveInteger,
  enabled: csvBoolean,
}) satisfies z.ZodType<CsvTransfer>;
