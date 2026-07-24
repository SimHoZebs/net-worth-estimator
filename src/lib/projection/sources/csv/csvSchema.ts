import { z } from "zod";
import { NO_CEILING, NO_FLOOR } from "../../constants";
import { isJsonValue } from "../../evaluation/json";
import type {
	Account,
	Checkpoint,
	ConfiguredEvaluation,
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
export const csvBehaviorHeaders = [
	"order",
	"instanceId",
	"label",
	"enabled",
	"config",
] as const;

export interface CsvBehaviorRow
	extends Omit<ConfiguredEvaluation, "definitionId"> {
	order: number;
}
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

const jsonValueSchema = z
	.string()
	.trim()
	.min(1)
	.transform((value, context) => {
		try {
			const parsed: unknown = JSON.parse(value);
			if (isJsonValue(parsed)) return parsed;
		} catch {
			// Report one stable CSV validation issue below.
		}

		context.addIssue({
			code: "custom",
			message: "Expected valid JSON configuration.",
		});
		return z.NEVER;
	});

export const csvBehaviorSchema = z.object({
	order: positiveInteger,
	instanceId: trimmedString,
	label: trimmedString,
	enabled: csvBoolean,
	config: jsonValueSchema,
}) satisfies z.ZodType<CsvBehaviorRow>;

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
