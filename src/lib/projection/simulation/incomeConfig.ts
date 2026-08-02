import { z } from "zod";
import type { IncomeAmountConfig } from "../types/model";

const resolverStepSchema = z
	.object({
		resolver: z.string().trim().min(1),
		config: z.record(z.string(), z.json()),
		destinationAccountId: z.string().trim().min(1).nullable(),
		employerMatchRate: z.number().finite().min(0).max(1).optional(),
	})
	.strict();

export const incomeAmountConfigSchema = z
	.object({
		incomeSourceId: z.string().trim().min(1),
		resolvers: z.array(resolverStepSchema),
	})
	.strict();

export const percentageStepSchema = z
	.object({
		rate: z.number().finite().min(0).max(1),
		annualCap: z.number().finite().min(0).nullable().optional(),
	})
	.strict();
export const taxStepSchema = z
	.object({ profileId: z.string().trim().min(1) })
	.strict();

export interface IncomeAmountReferenceContext {
	accountIds: ReadonlySet<string>;
	incomeSourceIds?: ReadonlySet<string>;
	taxProfileIds?: ReadonlySet<string>;
}

export class IncomeResolutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IncomeResolutionError";
	}
}

function parseConfig<T>(
	schema: z.ZodType<T>,
	value: unknown,
	label: string,
): T {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new IncomeResolutionError(
			`${label}: ${result.error.issues.map((issue) => issue.message).join(" ")}`,
		);
	}
	return result.data;
}

export function parseIncomeAmountConfig(value: unknown): IncomeAmountConfig {
	return parseConfig(incomeAmountConfigSchema, value, "Invalid income config");
}

export function validateIncomeAmountConfig(
	value: unknown,
	references?: IncomeAmountReferenceContext,
): void {
	const config = parseIncomeAmountConfig(value);
	if (
		references?.incomeSourceIds &&
		!references.incomeSourceIds.has(config.incomeSourceId)
	) {
		throw new IncomeResolutionError(
			`Income source '${config.incomeSourceId}' does not exist.`,
		);
	}
	for (const [index, step] of config.resolvers.entries()) {
		if (
			step.destinationAccountId &&
			references &&
			!references.accountIds.has(step.destinationAccountId)
		) {
			throw new IncomeResolutionError(
				`Income step ${index + 1} destination account '${step.destinationAccountId}' does not exist.`,
			);
		}
		if (step.employerMatchRate !== undefined && !step.destinationAccountId) {
			throw new IncomeResolutionError(
				`Income step ${index + 1} employer match requires a destination account.`,
			);
		}
		switch (step.resolver) {
			case "percentage":
				parseConfig(
					percentageStepSchema,
					step.config,
					`Invalid income step ${index + 1}`,
				);
				break;
			case "progressive-bracket": {
				const taxConfig = parseConfig(
					taxStepSchema,
					step.config,
					`Invalid income step ${index + 1}`,
				);
				if (
					references?.taxProfileIds &&
					!references.taxProfileIds.has(taxConfig.profileId)
				) {
					throw new IncomeResolutionError(
						`Tax profile '${taxConfig.profileId}' does not exist.`,
					);
				}
				break;
			}
			default:
				throw new IncomeResolutionError(
					`Unknown income resolver '${step.resolver}' at step ${index + 1}.`,
				);
		}
	}
}

export function parseStepConfig<T>(
	schema: z.ZodType<T>,
	value: unknown,
	label: string,
): T {
	return parseConfig(schema, value, label);
}
