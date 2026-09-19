import { z } from "zod";
import type { IncomeDataLoadResult } from "../../incomeData";
import {
	INCOME_DATA_FILE_NAMES,
	type IncomeDataSnapshot,
	type IncomeSourceDefinition,
	type IncomeTaxProfile,
} from "../../types/income";
import type { ModelValidationIssue } from "../../types/validation";

const dateSchema = z
	.string()
	.trim()
	.regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u)
	.refine((value) => {
		const [year, month, day] = value.split("-").map(Number);
		const date = new Date(Date.UTC(year!, month! - 1, day!));
		return (
			date.getUTCFullYear() === year &&
			date.getUTCMonth() === month! - 1 &&
			date.getUTCDate() === day
		);
	}, "Expected a valid date.");
const incomeSourceSchema = z.object({
	id: z.string().trim().min(1),
	label: z.string().trim().min(1),
	effectiveFrom: dateSchema,
	effectiveTo: z.preprocess(
		(value) =>
			typeof value === "string" && value.trim() === "" ? null : value,
		dateSchema.nullable(),
	),
	annualGrossIncome: z.coerce.number().finite().positive(),
});
const taxProfileSchema = z.object({
	id: z.string().trim().min(1),
	label: z.string().trim().min(1),
	deduction: z.coerce.number().finite().min(0),
	brackets: z.array(
		z.object({
			upTo: z.number().finite().nullable(),
			rate: z.number().finite().min(0).max(1),
		}),
	),
	sourceUrl: z.preprocess(
		(value) =>
			typeof value === "string" && value.trim() === "" ? null : value,
		z.string().url().nullable(),
	),
});

function validateSnapshot(
	incomeSources: IncomeSourceDefinition[],
	taxProfiles: IncomeTaxProfile[],
	issues: ModelValidationIssue[],
): IncomeDataSnapshot | null {
	const sourcesById = new Map<string, IncomeSourceDefinition[]>();
	for (const source of incomeSources) {
		const sources = sourcesById.get(source.id) ?? [];
		sources.push(source);
		sourcesById.set(source.id, sources);
		if (
			source.effectiveTo !== null &&
			source.effectiveTo < source.effectiveFrom
		) {
			issues.push({
				severity: "error",
				code: "income-data.source.date-range",
				message: `Income source '${source.id}' has an invalid effective date range.`,
				path: [INCOME_DATA_FILE_NAMES.incomeSources],
			});
		}
	}
	for (const [id, sources] of sourcesById) {
		const ordered = [...sources].sort((left, right) =>
			left.effectiveFrom.localeCompare(right.effectiveFrom),
		);
		for (let index = 1; index < ordered.length; index += 1) {
			const previous = ordered[index - 1]!;
			const current = ordered[index]!;
			if (
				previous.effectiveTo === null ||
				current.effectiveFrom <= previous.effectiveTo
			) {
				issues.push({
					severity: "error",
					code: "income-data.source.overlap",
					message: `Income source '${id}' has overlapping effective date ranges.`,
					path: [INCOME_DATA_FILE_NAMES.incomeSources],
				});
				break;
			}
		}
	}
	const taxIds = new Set<string>();
	for (const profile of taxProfiles) {
		if (taxIds.has(profile.id)) {
			issues.push({
				severity: "error",
				code: "income-data.tax-profile.duplicate",
				message: `Tax profile '${profile.id}' is duplicated.`,
				path: [INCOME_DATA_FILE_NAMES.taxProfiles],
			});
		}
		taxIds.add(profile.id);
		if (
			profile.brackets.length === 0 ||
			profile.brackets[profile.brackets.length - 1]?.upTo !== null
		) {
			issues.push({
				severity: "error",
				code: "income-data.tax-profile.brackets",
				message: `Tax profile '${profile.id}' must end with an open-ended bracket.`,
				path: [INCOME_DATA_FILE_NAMES.taxProfiles],
			});
		}
		let previous = 0;
		for (const [index, bracket] of profile.brackets.entries()) {
			if (bracket.upTo === null && index !== profile.brackets.length - 1) {
				issues.push({
					severity: "error",
					code: "income-data.tax-profile.brackets",
					message: `Tax profile '${profile.id}' may only have an open-ended final bracket.`,
					path: [INCOME_DATA_FILE_NAMES.taxProfiles],
				});
				break;
			}
			if (bracket.upTo !== null && bracket.upTo <= previous) {
				issues.push({
					severity: "error",
					code: "income-data.tax-profile.order",
					message: `Tax profile '${profile.id}' bracket limits must be ascending.`,
					path: [INCOME_DATA_FILE_NAMES.taxProfiles],
				});
				break;
			}
			if (bracket.upTo !== null) previous = bracket.upTo;
		}
	}
	return issues.some((issue) => issue.severity === "error")
		? null
		: {
				incomeSources: [...incomeSources].sort(
					(left, right) =>
						left.id.localeCompare(right.id) ||
						left.effectiveFrom.localeCompare(right.effectiveFrom),
				),
				taxProfiles: [...taxProfiles].sort((left, right) =>
					left.id.localeCompare(right.id),
				),
			};
}

const incomeDataSnapshotSchema = z.object({
	incomeSources: z.array(z.unknown()),
	taxProfiles: z.array(z.unknown()),
});

function parseSnapshotRows<T>(
	fileName: string,
	rows: unknown[],
	schema: z.ZodType<T>,
): { rows: T[]; issues: ModelValidationIssue[] } {
	const issues: ModelValidationIssue[] = [];
	const parsed: T[] = [];
	rows.forEach((row, index) => {
		const result = schema.safeParse(row);
		if (!result.success) {
			for (const issue of result.error.issues) {
				issues.push({
					severity: "error",
					code: "income-data.row.invalid",
					message: issue.message,
					path: [fileName, index, ...issue.path.map(String)],
				});
			}
			return;
		}
		parsed.push(result.data);
	});
	return { rows: parsed, issues };
}

/**
 * Thin wire-shape parser for the backend income-data snapshot. Row shape and
 * snapshot consistency only; simulation semantics run server-side in Go.
 */
export function parseIncomeDataSnapshot(value: unknown): IncomeDataLoadResult {
	const parsed = incomeDataSnapshotSchema.safeParse(value);
	if (!parsed.success) {
		return {
			data: null,
			issues: [
				{
					severity: "error",
					code: "income-data.snapshot.invalid",
					message: "Income data snapshot is invalid.",
					path: [],
				},
			],
		};
	}
	const incomeResult = parseSnapshotRows(
		INCOME_DATA_FILE_NAMES.incomeSources,
		parsed.data.incomeSources,
		incomeSourceSchema,
	);
	const taxResult = parseSnapshotRows(
		INCOME_DATA_FILE_NAMES.taxProfiles,
		parsed.data.taxProfiles,
		taxProfileSchema,
	);
	const issues = [...incomeResult.issues, ...taxResult.issues];
	const data = validateSnapshot(
		incomeResult.rows,
		taxResult.rows as IncomeTaxProfile[],
		issues,
	);
	return { data, issues };
}
