import { z } from "zod";
import type {
  CsvAccount,
  CsvCheckpoint,
  CsvPosting,
} from "../types/csv";

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

function parseDestinationsArray(value: unknown): string[] | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "-") {
    return null;
  }

  return trimmed.split(";").map((segment) => segment.trim()).filter(Boolean);
}

const finiteNumber = z.preprocess(parseNumber, z.number().finite());
const nullableNumber = z.preprocess(parseOptionalNumber, z.number().finite().nullable());
const nonNegativeNumber = z.preprocess(parseNumber, z.number().finite().min(0));
const nullableNonNegativeNumber = z.preprocess(parseOptionalNumber, z.number().finite().min(0).nullable());
const positiveInteger = z.preprocess(parseNumber, z.number().int().min(1));
const csvBoolean = z.preprocess(parseBoolean, z.boolean());
const trimmedString = z.string().trim().min(1);
const nullableTrimmedString = z.preprocess(parseNullableString, z.string().trim().min(1).nullable());
export function trimmedEnum<T extends [string, ...string[]]>(values: T) {
  return z.enum(values);
}

export const csvDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u, "Expected YYYY-MM-DD date.")
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Expected a valid date.");

export const csvAccountsHeaders = ["id", "label", "category", "openingBalance", "annualRate", "volatility", "minBalance", "maxBalance", "color", "enabled"] as const;
export const csvCheckpointsHeaders = ["Date", "AccountId", "Balance"] as const;
export const csvPostingsHeaders = [
  "id",
  "label",
  "sourceAccountId",
  "destinations",
  "amountMode",
  "basePostingId",
  "absBase",
  "amount",
  "annualGrowthRate",
  "startDate",
  "endDate",
  "annualCap",
  "priority",
  "enabled",
] as const;

export const csvAccountSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  category: trimmedString,
  openingBalance: finiteNumber,
  annualRate: finiteNumber,
  volatility: nonNegativeNumber,
  minBalance: nullableNumber,
  maxBalance: nullableNumber,
  color: nullableTrimmedString,
  enabled: csvBoolean,
}) satisfies z.ZodType<CsvAccount>;

export const csvCheckpointSchema = z.object({
  Date: csvDateSchema,
  AccountId: trimmedString,
  Balance: finiteNumber,
}) satisfies z.ZodType<CsvCheckpoint>;

export const csvPostingSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  sourceAccountId: nullableTrimmedString,
  destinations: z.preprocess(parseDestinationsArray, z.array(trimmedString).nullable()),
  amountMode: trimmedEnum(["fixed", "percent_of_base"] as const),
  basePostingId: nullableTrimmedString,
  absBase: csvBoolean,
  amount: nonNegativeNumber,
  annualGrowthRate: finiteNumber,
  startDate: csvDateSchema,
  endDate: z.preprocess(parseNullableString, csvDateSchema.nullable()),
  annualCap: nullableNonNegativeNumber,
  priority: positiveInteger,
  enabled: csvBoolean,
});
