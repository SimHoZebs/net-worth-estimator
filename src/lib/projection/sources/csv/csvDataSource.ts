import { z } from "zod";
import type { DataSource, FinancialModelParseResult } from "../../dataSource";
import type {
	Checkpoint,
	FinancialIndependenceSource,
	FinancialModelDocument,
	Posting,
} from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";
import { csvDateSchema } from "./csvSchema";

const finiteNumber = z.number().finite();
const checkpointSchema = z
	.object({
		Date: csvDateSchema,
		AccountId: z.string().trim().min(1),
		Balance: finiteNumber,
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
const modelValidationIssueSchema = z.object({
	code: z.string(),
	message: z.string(),
	path: z.array(z.union([z.string(), z.number()])),
	severity: z.enum(["error", "warning"]),
}) satisfies z.ZodType<ModelValidationIssue>;
const financialModelParseResultSchema = z.object({
	document: financialModelDocumentSchema.nullable(),
	issues: z.array(modelValidationIssueSchema),
}) satisfies z.ZodType<FinancialModelParseResult>;

async function parseApiResponse(
	response: Response,
): Promise<FinancialModelParseResult> {
	let payload: unknown;

	try {
		payload = await response.json();
	} catch {
		throw new Error(
			"Invalid financial model API response: expected a valid FinancialModelParseResult payload.",
		);
	}

	const parsed = financialModelParseResultSchema.safeParse(payload);
	if (!parsed.success) {
		throw new Error(
			"Invalid financial model API response: expected a valid FinancialModelParseResult payload.",
		);
	}

	return parsed.data;
}

export class FinancialModelApiError extends Error {
	readonly status: number;
	readonly result: FinancialModelParseResult | null;

	constructor(
		status: number,
		message: string,
		result: FinancialModelParseResult | null,
	) {
		super(message);
		this.name = "FinancialModelApiError";
		this.status = status;
		this.result = result;
	}
}

async function requestFinancialModel(
	fetchImpl: typeof fetch,
	apiPath: string,
	init?: RequestInit,
): Promise<FinancialModelParseResult> {
	const response = init
		? await fetchImpl(apiPath, init)
		: await fetchImpl(apiPath);
	let result: FinancialModelParseResult | null = null;
	try {
		result = await parseApiResponse(response);
	} catch (error) {
		if (!response.ok) {
			throw new FinancialModelApiError(
				response.status,
				`Failed to access financial model (${response.status} ${response.statusText}).`,
				null,
			);
		}
		throw error;
	}
	if (!response.ok) {
		const message =
			result.issues.find((issue) => issue.severity === "error")?.message ??
			`Financial model request failed (${response.status} ${response.statusText}).`;
		throw new FinancialModelApiError(response.status, message, result);
	}
	return result;
}

export interface CsvDataSourceOptions {
	apiPath?: string;
	fetchImpl?: typeof fetch;
}

export function createCsvDataSource(
	options?: CsvDataSourceOptions,
): DataSource {
	const apiPath = options?.apiPath ?? "/api/financial-model";
	const fetchImpl = options?.fetchImpl ?? fetch;
	const loadDocument = async (): Promise<FinancialModelParseResult> => {
		return requestFinancialModel(fetchImpl, apiPath);
	};

	return {
		sourceType: "csv-api",
		label: "Repo CSV files",
		description:
			"Loaded through the Vite dev server; saved edits write back to public/configs/ in this checkout.",
		loadDocument,
		save: {
			label: "Save to CSV files",
			description:
				"Writes the edited model to public/configs/ through the local Vite dev server.",
			run: async (
				document: FinancialModelDocument,
			): Promise<FinancialModelParseResult> => {
				return requestFinancialModel(fetchImpl, apiPath, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(document),
				});
			},
		},
	};
}
