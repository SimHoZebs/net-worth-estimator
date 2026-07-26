import { z } from "zod";
import { NO_CEILING, NO_FLOOR } from "../../constants";
import type {
	Account,
	Checkpoint,
	FinancialIndependenceEvaluation,
	FinancialIndependencePlan,
	NetWorthThresholdEvaluation,
	PostingFulfillmentEvaluation,
} from "../../types/model";

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

function parseNoFloor(value: unknown): number {
	if (value === null || value === undefined) {
		return Number.NaN;
	}

	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return Number.NaN;
		}
		if (trimmed === "-Infinity") {
			return NO_FLOOR;
		}
	}

	const n = typeof value === "number" ? value : Number(value);
	return Number.isNaN(n) || !Number.isFinite(n) ? Number.NaN : n;
}

function parseNoCeiling(value: unknown): number {
	if (value === null || value === undefined) {
		return Number.NaN;
	}

	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return Number.NaN;
		}
		if (trimmed === "Infinity") {
			return NO_CEILING;
		}
	}

	const n = typeof value === "number" ? value : Number(value);
	return Number.isNaN(n) || !Number.isFinite(n) ? Number.NaN : n;
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

function parseJson(value: unknown) {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

function parseDestinationsArray(value: unknown): string[] | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed === "-") {
		return null;
	}

	return trimmed
		.split(";")
		.map((segment) => segment.trim())
		.filter(Boolean);
}

const finiteNumber = z.preprocess(parseNumber, z.number().finite());
const _nullableNumber = z.preprocess(
	parseOptionalNumber,
	z.number().finite().nullable(),
);
const nonNullableNoFloor = z.preprocess(parseNoFloor, z.number().finite());
const nonNullableNoCeiling = z.preprocess(parseNoCeiling, z.number().finite());
const nonNegativeNumber = z.preprocess(parseNumber, z.number().finite().min(0));
const nullableNonNegativeNumber = z.preprocess(
	parseOptionalNumber,
	z.number().finite().min(0).nullable(),
);
const positiveInteger = z.preprocess(parseNumber, z.number().int().min(1));
const csvBoolean = z.preprocess(parseBoolean, z.boolean());
const trimmedString = z.string().trim().min(1);
const nullableTrimmedString = z.preprocess(
	parseNullableString,
	z.string().trim().min(1).nullable(),
);

export const csvDateSchema = z
	.string()
	.trim()
	.regex(
		/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u,
		"Expected YYYY-MM-DD date.",
	)
	.refine(
		(value) => !Number.isNaN(new Date(value).getTime()),
		"Expected a valid date.",
	);

export const csvAccountsHeaders = [
	"id",
	"label",
	"minBalance",
	"maxBalance",
	"color",
	"enabled",
] as const;
export const csvCheckpointsHeaders = ["Date", "AccountId", "Balance"] as const;
const csvEvaluationHeaders = ["instanceId", "label", "enabled"] as const;

export const csvFinancialIndependenceHeaders = [
	...csvEvaluationHeaders,
	"minimumNetWorth",
	"annualExpenseTarget",
	"annualExpenseGrowthRate",
	"withdrawalRate",
	"evaluationYears",
	"requiredConfidence",
	"sources",
	"continuingPostingIds",
	"principalPolicy",
] as const;
export const csvNetWorthThresholdHeaders = [
	...csvEvaluationHeaders,
	"target",
] as const;
export const csvPostingFulfillmentHeaders = [
	...csvEvaluationHeaders,
	"postingIds",
] as const;

export type CsvFinancialIndependenceRow = Omit<
	FinancialIndependenceEvaluation,
	"config"
> &
	FinancialIndependencePlan;
export type CsvNetWorthThresholdRow = Omit<
	NetWorthThresholdEvaluation,
	"config"
> &
	NetWorthThresholdEvaluation["config"];
export type CsvPostingFulfillmentRow = Omit<
	PostingFulfillmentEvaluation,
	"config"
> &
	PostingFulfillmentEvaluation["config"];
export const csvPostingsHeaders = [
	"id",
	"label",
	"sourceAccountId",
	"destinations",
	"arithmetic",
	"frequency",
	"annualRate",
	"annualGrowthRate",
	"volatility",
	"startDate",
	"endDate",
	"annualCap",
	"priority",
	"enabled",
] as const;

export const csvAccountSchema = z.object({
	id: trimmedString,
	label: trimmedString,
	minBalance: nonNullableNoFloor,
	maxBalance: nonNullableNoCeiling,
	color: nullableTrimmedString,
	enabled: csvBoolean,
}) satisfies z.ZodType<Account>;

export const csvCheckpointSchema = z.object({
	Date: csvDateSchema,
	AccountId: trimmedString,
	Balance: finiteNumber,
}) satisfies z.ZodType<Checkpoint>;

const evaluationFields = {
	instanceId: trimmedString,
	label: trimmedString,
	enabled: csvBoolean,
};

const financialIndependenceSourceSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("cashflow"),
		postingId: trimmedString,
		included: z.boolean(),
		laborDependent: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("asset"),
		accountId: trimmedString,
		included: z.boolean(),
		withdrawalRateOverride: z.number().finite().optional(),
	}),
]);

export const csvFinancialIndependenceSchema = z.object({
	...evaluationFields,
	minimumNetWorth: finiteNumber,
	annualExpenseTarget: finiteNumber,
	annualExpenseGrowthRate: finiteNumber,
	withdrawalRate: finiteNumber,
	evaluationYears: finiteNumber,
	requiredConfidence: finiteNumber,
	sources: z.preprocess(parseJson, z.array(financialIndependenceSourceSchema)),
	continuingPostingIds: z.preprocess(parseJson, z.array(trimmedString)),
	principalPolicy: z.enum([
		"allow-drawdown",
		"preserve-nominal-principal",
		"preserve-real-principal",
	]),
}) satisfies z.ZodType<CsvFinancialIndependenceRow>;

export const csvNetWorthThresholdSchema = z.object({
	...evaluationFields,
	target: finiteNumber,
}) satisfies z.ZodType<CsvNetWorthThresholdRow>;

export const csvPostingFulfillmentSchema = z.object({
	...evaluationFields,
	postingIds: z.preprocess(parseJson, z.array(trimmedString).nullable()),
}) satisfies z.ZodType<CsvPostingFulfillmentRow>;

const postingFrequencySchema = z.enum([
	"daily",
	"weekly",
	"monthly",
	"quarterly",
	"annual",
]);

export const csvPostingSchema = z.object({
	id: trimmedString,
	label: trimmedString,
	sourceAccountId: nullableTrimmedString,
	destinations: z.preprocess(
		parseDestinationsArray,
		z.array(trimmedString).nullable(),
	),
	arithmetic: trimmedString,
	frequency: postingFrequencySchema,
	annualRate: finiteNumber,
	annualGrowthRate: finiteNumber,
	volatility: nonNegativeNumber,
	startDate: csvDateSchema,
	endDate: z.preprocess(parseNullableString, csvDateSchema.nullable()),
	annualCap: nullableNonNegativeNumber,
	priority: positiveInteger,
	enabled: csvBoolean,
});
