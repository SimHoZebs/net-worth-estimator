import { z } from "zod";
import type { DataSource, FinancialModelParseResult } from "../../dataSource";
import type {
	FinancialIndependenceSource,
	FinancialModelDocument,
} from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";

const finiteNumber = z.number().finite();
const evaluationFields = {
	instanceId: z.string(),
	label: z.string(),
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
					id: z.string(),
					label: z.string(),
					minBalance: finiteNumber,
					maxBalance: finiteNumber,
					color: z.string().nullable(),
					enabled: z.boolean(),
				})
				.strict(),
		),
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
		postings: z.array(
			z
				.object({
					id: z.string(),
					label: z.string(),
					sourceAccountId: z.string().nullable(),
					destinations: z.array(z.string()).nullable(),
					arithmetic: z.string(),
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
					startDate: z.string(),
					endDate: z.string().nullable(),
					annualCap: finiteNumber.nullable(),
					priority: finiteNumber,
					enabled: z.boolean(),
				})
				.strict(),
		),
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
		const response = await fetchImpl(apiPath);

		if (!response.ok) {
			throw new Error(
				`Failed to load financial model (${response.status} ${response.statusText}).`,
			);
		}

		return parseApiResponse(response);
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
				const response = await fetchImpl(apiPath, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(document),
				});

				if (!response.ok) {
					throw new Error(
						`Failed to save financial model (${response.status} ${response.statusText}).`,
					);
				}

				return parseApiResponse(response);
			},
		},
	};
}
