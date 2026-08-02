import { z } from "zod";
import type {
	AmountInputBinding,
	JsonValue,
	Posting,
	PostingAmountResolution,
} from "../types/model";
import { arithmeticRequirements, evaluateArithmetic } from "./arithmetic";
import { validateIncomeAmountConfig } from "./incomeConfig";

const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.min(0);
const emptyObject = z.object({}).strict();

export interface AmountProviderContext {
	balances: Readonly<Record<string, number>>;
	latestRealizedPostingAmounts: ReadonlyMap<string, number>;
	realizedPostingAmountsByYear: ReadonlyMap<
		string,
		ReadonlyMap<string, number>
	>;
	date: string;
	occurrenceRate: number;
}

export interface AmountReferenceContext {
	accountIds: ReadonlySet<string>;
	postingIds: ReadonlySet<string>;
	incomeSourceIds?: ReadonlySet<string>;
	taxProfileIds?: ReadonlySet<string>;
}

interface ProviderDefinition<TArguments = unknown> {
	argumentsSchema: z.ZodType<TArguments>;
	resolve: (arguments_: TArguments, context: AmountProviderContext) => number;
	validateReferences?: (
		arguments_: TArguments,
		context: AmountReferenceContext,
	) => string | null;
	postingDependencies?: (arguments_: TArguments) => readonly string[];
}

interface ResolverDefinition<TConfig = unknown> {
	configSchema: z.ZodType<TConfig>;
	requiredInputs: (config: TConfig) => readonly string[];
	resolve: (
		config: TConfig,
		inputs: Readonly<Record<string, number>>,
	) => number;
}

export class AmountResolutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AmountResolutionError";
	}
}

const idArgumentsSchema = z.object({ id: z.string().min(1) }).strict();

export const amountProviders: Readonly<
	Record<string, ProviderDefinition<any>>
> = {
	"model-value": {
		argumentsSchema: idArgumentsSchema,
		resolve: ({ id }, context) =>
			context.latestRealizedPostingAmounts.get(id) ?? context.balances[id] ?? 0,
		validateReferences: ({ id }, context) =>
			context.postingIds.has(id) || context.accountIds.has(id)
				? null
				: `Model value '${id}' is not a posting or account ID.`,
		postingDependencies: ({ id }) => [id],
	},
	"posting-latest": {
		argumentsSchema: idArgumentsSchema,
		resolve: ({ id }, context) =>
			context.latestRealizedPostingAmounts.get(id) ?? 0,
		validateReferences: ({ id }, context) =>
			context.postingIds.has(id) ? null : `Posting '${id}' does not exist.`,
		postingDependencies: ({ id }) => [id],
	},
	"posting-year-to-date": {
		argumentsSchema: idArgumentsSchema,
		resolve: ({ id }, context) =>
			context.realizedPostingAmountsByYear
				.get(id)
				?.get(context.date.slice(0, 4)) ?? 0,
		validateReferences: ({ id }, context) =>
			context.postingIds.has(id) ? null : `Posting '${id}' does not exist.`,
	},
	"posting-prior-year-to-date": {
		argumentsSchema: idArgumentsSchema,
		resolve: ({ id }, context) => {
			const yearToDate =
				context.realizedPostingAmountsByYear
					.get(id)
					?.get(context.date.slice(0, 4)) ?? 0;
			const latest = context.latestRealizedPostingAmounts.get(id) ?? 0;
			return Math.max(0, yearToDate - latest);
		},
		validateReferences: ({ id }, context) =>
			context.postingIds.has(id) ? null : `Posting '${id}' does not exist.`,
	},
	"account-balance": {
		argumentsSchema: idArgumentsSchema,
		resolve: ({ id }, context) => context.balances[id] ?? 0,
		validateReferences: ({ id }, context) =>
			context.accountIds.has(id) ? null : `Account '${id}' does not exist.`,
	},
	"occurrence-rate": {
		argumentsSchema: emptyObject,
		resolve: (_arguments, context) => context.occurrenceRate,
	},
};

const expressionConfigSchema = z.object({ expression: z.string() }).strict();
const progressiveConfigSchema = z
	.object({
		brackets: z.array(
			z
				.object({
					upTo: finiteNumber.nullable(),
					rate: finiteNumber.min(0).max(1),
				})
				.strict(),
		),
		deduction: nonNegativeNumber,
	})
	.strict()
	.superRefine(({ brackets }, context) => {
		if (brackets.length === 0 || brackets[brackets.length - 1]?.upTo !== null) {
			context.addIssue({
				code: "custom",
				message: "The final bracket must have upTo null.",
			});
		}
		let previous = 0;
		brackets.forEach((bracket, index) => {
			if (bracket.upTo === null) {
				if (index !== brackets.length - 1) {
					context.addIssue({
						code: "custom",
						message: "Only the final bracket may have upTo null.",
					});
				}
				return;
			}
			if (bracket.upTo <= previous) {
				context.addIssue({
					code: "custom",
					message: "Bracket limits must be strictly ascending.",
				});
			}
			previous = bracket.upTo;
		});
	});

function progressiveLiability(
	taxableAmount: number,
	brackets: Array<{ upTo: number | null; rate: number }>,
): number {
	let previousLimit = 0;
	let liability = 0;
	for (const bracket of brackets) {
		const upper = bracket.upTo ?? taxableAmount;
		const width = Math.max(0, Math.min(taxableAmount, upper) - previousLimit);
		liability += width * bracket.rate;
		if (taxableAmount <= upper) break;
		previousLimit = upper;
	}
	return liability;
}

export const amountResolvers: Readonly<
	Record<string, ResolverDefinition<any>>
> = {
	expression: {
		configSchema: expressionConfigSchema,
		requiredInputs: ({ expression }) => arithmeticRequirements(expression),
		resolve: ({ expression }, inputs) => evaluateArithmetic(expression, inputs),
	},
	percentage: {
		configSchema: z.object({ rate: nonNegativeNumber }).strict(),
		requiredInputs: () => ["amount"],
		resolve: ({ rate }, { amount }) => Math.max(0, amount) * rate,
	},
	"progressive-bracket": {
		configSchema: progressiveConfigSchema,
		requiredInputs: () => [
			"currentAmount",
			"yearToDateAmount",
			"yearToDateResolvedAmount",
		],
		resolve: ({ brackets, deduction }, inputs) => {
			const taxable = Math.max(
				0,
				inputs.yearToDateAmount + inputs.currentAmount - deduction,
			);
			return Math.max(
				0,
				progressiveLiability(taxable, brackets) -
					Math.max(0, inputs.yearToDateResolvedAmount),
			);
		},
	},
	"capped-percentage": {
		configSchema: z
			.object({ rate: nonNegativeNumber, cap: nonNegativeNumber })
			.strict(),
		requiredInputs: () => ["currentAmount", "yearToDateAmount"],
		resolve: ({ rate, cap }, inputs) =>
			Math.min(
				Math.max(0, inputs.currentAmount),
				Math.max(0, cap - Math.max(0, inputs.yearToDateAmount)),
			) * rate,
	},
	"threshold-percentage": {
		configSchema: z
			.object({ rate: nonNegativeNumber, threshold: nonNegativeNumber })
			.strict(),
		requiredInputs: () => ["currentAmount", "yearToDateAmount"],
		resolve: ({ rate, threshold }, inputs) =>
			(Math.max(0, inputs.yearToDateAmount + inputs.currentAmount - threshold) -
				Math.max(0, inputs.yearToDateAmount - threshold)) *
			rate,
	},
};

function parseDefinition<T>(
	schema: z.ZodType<T>,
	value: unknown,
	label: string,
): T {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new AmountResolutionError(
			`${label}: ${result.error.issues.map((issue) => issue.message).join(" ")}`,
		);
	}
	return result.data;
}

function validateExactKeys(
	actual: Record<string, unknown>,
	required: readonly string[],
) {
	const expected = new Set(required);
	const missing = required.filter((key) => !(key in actual));
	const extra = Object.keys(actual).filter((key) => !expected.has(key));
	if (missing.length || extra.length) {
		throw new AmountResolutionError(
			`Amount inputs do not match requirements. Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`,
		);
	}
}

export function validateAmountDescriptor(
	amount: PostingAmountResolution,
	references?: AmountReferenceContext,
): readonly string[] {
	if (amount.resolver === "income") {
		if (Object.keys(amount.inputs).length > 0) {
			throw new AmountResolutionError(
				"Income amount descriptors cannot define generic inputs.",
			);
		}
		try {
			validateIncomeAmountConfig(amount.config, references);
		} catch (error) {
			throw new AmountResolutionError(
				error instanceof Error
					? error.message
					: "Invalid income amount config.",
			);
		}
		return [];
	}
	const resolver = amountResolvers[amount.resolver];
	if (!resolver)
		throw new AmountResolutionError(
			`Unknown amount resolver '${amount.resolver}'.`,
		);
	const config = parseDefinition(
		resolver.configSchema,
		amount.config,
		`Invalid '${amount.resolver}' config`,
	);
	const required = resolver.requiredInputs(config);
	validateExactKeys(amount.inputs, required);
	const dependencies: string[] = [];
	for (const [inputName, binding] of Object.entries(amount.inputs)) {
		if (binding.source === "literal") {
			if (
				typeof binding.value !== "number" ||
				!Number.isFinite(binding.value)
			) {
				throw new AmountResolutionError(
					`Literal amount input '${inputName}' must be a finite number.`,
				);
			}
			continue;
		}
		const provider = amountProviders[binding.provider];
		if (!provider)
			throw new AmountResolutionError(
				`Unknown amount provider '${binding.provider}' for input '${inputName}'.`,
			);
		const arguments_ = parseDefinition(
			provider.argumentsSchema,
			binding.arguments,
			`Invalid '${binding.provider}' arguments`,
		);
		if (references) {
			const error = provider.validateReferences?.(arguments_, references);
			if (error) throw new AmountResolutionError(error);
		}
		for (const id of provider.postingDependencies?.(arguments_) ?? []) {
			if (!references || references.postingIds.has(id)) dependencies.push(id);
		}
	}
	return dependencies;
}

export function resolvePostingAmountDescriptor(
	amount: PostingAmountResolution,
	context: AmountProviderContext,
): number {
	if (amount.resolver === "income") {
		throw new AmountResolutionError(
			"Income amounts must be resolved by the income transition.",
		);
	}
	const resolver = amountResolvers[amount.resolver];
	if (!resolver)
		throw new AmountResolutionError(
			`Unknown amount resolver '${amount.resolver}'.`,
		);
	const config = parseDefinition(
		resolver.configSchema,
		amount.config,
		`Invalid '${amount.resolver}' config`,
	);
	const required = resolver.requiredInputs(config);
	validateExactKeys(amount.inputs, required);
	const concreteInputs: Record<string, number> = {};
	for (const [name, binding] of Object.entries(amount.inputs)) {
		let value: JsonValue | number;
		if (binding.source === "literal") {
			value = binding.value;
		} else {
			const provider = amountProviders[binding.provider];
			if (!provider)
				throw new AmountResolutionError(
					`Unknown amount provider '${binding.provider}'.`,
				);
			const arguments_ = parseDefinition(
				provider.argumentsSchema,
				binding.arguments,
				`Invalid '${binding.provider}' arguments`,
			);
			value = provider.resolve(arguments_, context);
		}
		if (typeof value !== "number" || !Number.isFinite(value)) {
			throw new AmountResolutionError(
				`Amount input '${name}' must resolve to a finite number.`,
			);
		}
		concreteInputs[name] = value;
	}
	const result = resolver.resolve(config, concreteInputs);
	if (!Number.isFinite(result))
		throw new AmountResolutionError(
			"Amount resolver returned a nonfinite value.",
		);
	return result;
}

export function createExpressionAmount(
	expression: string,
): PostingAmountResolution {
	const inputs: Record<string, AmountInputBinding> = {};
	for (const requirement of arithmeticRequirements(expression)) {
		inputs[requirement] =
			requirement === "rate"
				? { source: "provider", provider: "occurrence-rate", arguments: {} }
				: {
						source: "provider",
						provider: "model-value",
						arguments: { id: requirement },
					};
	}
	return { resolver: "expression", config: { expression }, inputs };
}

export function updateExpressionAmount(
	amount: PostingAmountResolution,
	expression: string,
): PostingAmountResolution {
	const updated = createExpressionAmount(expression);
	for (const name of Object.keys(updated.inputs)) {
		if (amount.inputs[name]) updated.inputs[name] = amount.inputs[name];
	}
	return updated;
}

export function getExpression(posting: Pick<Posting, "amount">): string | null {
	return posting.amount.resolver === "expression" &&
		typeof posting.amount.config.expression === "string"
		? posting.amount.config.expression
		: null;
}

export function describePostingAmount(
	posting: Pick<Posting, "amount">,
): string {
	return getExpression(posting) ?? JSON.stringify(posting.amount);
}
