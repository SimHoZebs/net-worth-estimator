import type { ScheduleCreateBody } from "@/api/generated/model/scheduleCreateBody.ts";

export type AmountFields = Record<string, string>;
type Amount = ScheduleCreateBody["amount"];
type Field = {
	key: string;
	label: string;
	kind: "number" | "account" | "schedule" | "debt";
	min?: number;
	max?: number;
	step?: string;
};
type Recipe = {
	id: string;
	label: string;
	summary: string;
	defaults: AmountFields;
	fields: Field[];
	build: (values: AmountFields) => Amount;
};

function expression(
	formula: string,
	inputs: Extract<Amount, { resolver: string }>["inputs"],
): Amount {
	return { resolver: "expression", config: { expression: formula }, inputs };
}

const percent: Field = {
	key: "percent",
	label: "Percentage (%)",
	kind: "number",
	min: 0,
	step: "0.01",
};

/** Author descriptors only. The Go engine owns occurrence rates and all calculations. */
export const SCHEDULE_AMOUNT_RECIPES: Recipe[] = [
	{
		id: "fixed",
		label: "Fixed amount",
		summary:
			"The same amount each time. Use for pay, bills, or a fixed transfer.",
		defaults: { amount: "500" },
		fields: [
			{
				key: "amount",
				label: "Amount (USD)",
				kind: "number",
				min: 0,
				max: 1e10,
				step: "0.01",
			},
		],
		build: (v) => ({ value: Number(v.amount) }),
	},
	{
		id: "growth",
		label: "Grows yearly by %",
		summary:
			"Start with an amount and change it by a yearly rate. Use for salary increases or inflation.",
		defaults: { amount: "500", annualIncrease: "3" },
		fields: [
			{
				key: "amount",
				label: "Amount (USD)",
				kind: "number",
				min: 0,
				max: 1e10,
				step: "0.01",
			},
			{
				key: "annualIncrease",
				label: "Annual amount increase (%)",
				kind: "number",
				min: -50,
				max: 50,
				step: "0.1",
			},
		],
		build: (v) => ({
			value: Number(v.amount),
			annualIncrease: Number(v.annualIncrease),
		}),
	},
	{
		id: "schedule-percent",
		label: "Percent of another schedule",
		summary:
			"Use a schedule's latest realized amount for employer match or automatic investing. Before its first occurrence, this amount is zero. Run the source first on shared dates.",
		defaults: { percent: "10", reference: "" },
		fields: [
			{ key: "reference", label: "Based on schedule", kind: "schedule" },
			percent,
		],
		build: (v) =>
			expression("base * share", {
				base: {
					source: "provider",
					provider: "model-value",
					arguments: { id: v.reference! },
				},
				share: { source: "literal", value: Number(v.percent) / 100 },
			}),
	},
	{
		id: "account-percent",
		label: "Percent of account balance",
		summary:
			"Take a percentage of the live balance at each occurrence. This is a per-occurrence percentage, not an annual rate.",
		defaults: { percent: "4", reference: "" },
		fields: [
			{ key: "reference", label: "Based on account", kind: "account" },
			percent,
		],
		build: (v) =>
			expression("base * share", {
				base: {
					source: "provider",
					provider: "account-balance",
					arguments: { id: v.reference! },
				},
				share: { source: "literal", value: Number(v.percent) / 100 },
			}),
	},
	{
		id: "investment-growth",
		label: "Annual return on balance",
		summary:
			"Apply a yearly return to a live balance. The engine divides the rate across occurrences. Choose External income → the same investment account.",
		defaults: { rate: "7", volatility: "0", reference: "" },
		fields: [
			{ key: "reference", label: "Balance to grow", kind: "account" },
			{
				key: "rate",
				label: "Annual return (%)",
				kind: "number",
				min: -50,
				max: 100,
				step: "0.01",
			},
			{
				key: "volatility",
				label: "Annual volatility (%)",
				kind: "number",
				min: 0,
				max: 100,
				step: "0.01",
			},
		],
		build: (v) =>
			expression("base * rate", {
				base: {
					source: "provider",
					provider: "account-balance",
					arguments: { id: v.reference! },
				},
				rate: {
					source: "provider",
					provider: "occurrence-rate",
					arguments: {
						annualRate: Number(v.rate) / 100,
						volatility: Number(v.volatility) / 100,
					},
				},
			}),
	},
	{
		id: "owed-balance",
		label: "Pay the balance owed",
		summary:
			"Pay the negative balance at each occurrence, or zero when nothing is owed. This is not a statement balance or a lender minimum.",
		defaults: { reference: "" },
		fields: [{ key: "reference", label: "Debt account", kind: "debt" }],
		build: (v) =>
			expression("(abs(balance) - balance) / 2", {
				balance: {
					source: "provider",
					provider: "account-balance",
					arguments: { id: v.reference! },
				},
			}),
	},
];

export function validateRecipe(
	recipe: Recipe,
	values: AmountFields,
): string | null {
	for (const field of recipe.fields) {
		const raw = values[field.key] ?? "";
		if (!raw.trim()) return `Enter ${field.label.toLowerCase()}.`;
		if (field.kind !== "number") continue;
		const value = Number(raw);
		if (
			!Number.isFinite(value) ||
			value < (field.min ?? -Infinity) ||
			value > (field.max ?? Infinity)
		)
			return `Review ${field.label.toLowerCase()}.`;
	}
	return null;
}
