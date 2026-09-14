import { z } from "zod";
import type {
	Checkpoint,
	FinancialIndependenceSource,
	FinancialModelDocument,
	Posting,
} from "../../types/model";
import { csvDateSchema } from "./csvSchema";

const finiteNumber = z.number().finite();
const checkpointSchema = z
	.object({
		Date: csvDateSchema,
		AccountId: z.string().trim().min(1),
		Balance: finiteNumber,
		source: z.string().trim().min(1).nullish(),
	})
	.strict() satisfies z.ZodType<Checkpoint>;
const amountBindingSchema = z.discriminatedUnion("source", [
	z.object({ source: z.literal("literal"), value: z.json() }).strict(),
	z
		.object({
			source: z.literal("provider"),
			provider: z.string(),
			arguments: z.record(z.string(), z.json()),
		})
		.strict(),
]);
const postingAmountSchema = z
	.object({
		resolver: z.string(),
		config: z.record(z.string(), z.json()),
		inputs: z.record(z.string(), amountBindingSchema),
	})
	.strict();
const postingSchema = z
	.object({
		id: z.string().trim().min(1),
		label: z.string().trim().min(1),
		sourceAccountId: z.string().trim().min(1).nullable(),
		destinations: z.array(z.string().trim().min(1)).nullable(),
		amount: postingAmountSchema,
		frequency: z.enum([
			"once",
			"daily",
			"weekly",
			"monthly",
			"quarterly",
			"annual",
		]),
		annualRate: finiteNumber,
		annualGrowthRate: finiteNumber,
		volatility: finiteNumber,
		startDate: csvDateSchema,
		endDate: csvDateSchema.nullable(),
		annualCap: finiteNumber.nullable(),
		priority: finiteNumber.int().min(1),
		enabled: z.boolean(),
		source: z.string().trim().min(1).nullish(),
	})
	.strict() satisfies z.ZodType<Posting>;
const evaluationFields = {
	instanceId: z.string().trim().min(1),
	label: z.string().trim().min(1),
	enabled: z.boolean(),
};
const financialIndependenceSourceSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("cashflow"),
			postingId: z.string(),
			included: z.boolean(),
		})
		.strict(),
	z
		.object({
			type: z.literal("asset"),
			accountId: z.string(),
			included: z.boolean(),
			withdrawalRateOverride: finiteNumber.optional(),
		})
		.strict(),
]) satisfies z.ZodType<FinancialIndependenceSource>;
export const financialModelDocumentSchema = z
	.object({
		sourcePath: z.string(),
		accounts: z.array(
			z
				.object({
					id: z.string().trim().min(1),
					label: z.string().trim().min(1),
					minBalance: finiteNumber,
					maxBalance: finiteNumber,
					color: z.string().trim().min(1).nullable(),
					enabled: z.boolean(),
				})
				.strict(),
		),
		checkpoints: z.array(checkpointSchema).default([]),
		evaluations: z
			.object({
				financialIndependence: z.array(
					z
						.object({
							...evaluationFields,
							config: z
								.object({
									minimumNetWorth: finiteNumber,
									annualExpenseTarget: finiteNumber,
									annualExpenseTargetBasis: z
										.enum([
											"projection-start-purchasing-power",
											"fi-date-dollars",
										])
										.default("projection-start-purchasing-power"),
									annualExpenseGrowthRate: finiteNumber,
									withdrawalRate: finiteNumber,
									evaluationYears: finiteNumber,
									requiredConfidence: finiteNumber,
									sources: z.array(financialIndependenceSourceSchema),
									continuingPostingIds: z.array(z.string()),
									principalPolicy: z.enum([
										"allow-drawdown",
										"preserve-nominal-principal",
										"preserve-real-principal",
									]),
								})
								.strict(),
						})
						.strict(),
				),
				netWorthThreshold: z.array(
					z
						.object({
							...evaluationFields,
							config: z.object({ target: finiteNumber }).strict(),
						})
						.strict(),
				),
				postingFulfillment: z.array(
					z
						.object({
							...evaluationFields,
							config: z
								.object({ postingIds: z.array(z.string()).nullable() })
								.strict(),
						})
						.strict(),
				),
			})
			.strict(),
		postings: z.array(postingSchema),
	})
	.strict() satisfies z.ZodType<FinancialModelDocument>;

export function parseFinancialModelDocument(
	value: unknown,
): FinancialModelDocument | null {
	const result = financialModelDocumentSchema.safeParse(value);
	return result.success ? result.data : null;
}
