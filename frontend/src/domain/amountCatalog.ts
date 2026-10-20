import type {
	AmountTemplate,
	PostingAmountResolution,
} from "../api/contracts.ts";

// Frontend-owned copy: all human words live here, not in the backend.
// The backend exposes only wiring (names, field keys, kinds); unknown
// backend names get a generic entry built from the backend description.
export interface CopyEntry {
	name: string;
	label?: string | null;
	summary?: string | null;
	description?: string | null;
}

export const FALLBACK_RESOLVERS: CopyEntry[] = [
	{
		name: "expression",
		label: "Custom amount",
		summary:
			"You write a simple formula like 500 or (1000) * growth. Each name in the formula needs a value below.",
	},
	{
		name: "income",
		label: "Paycheck (take-home pay)",
		summary:
			"Starts from yearly salary, then takes off savings, taxes, and other steps in order. What is left is deposited as take-home pay.",
	},
];

export const FALLBACK_INCOME_STEPS: CopyEntry[] = [
	{
		name: "percentage",
		label: "Take a percent off",
		summary:
			"Takes a slice like 10% for savings. Stops at the yearly limit when set.",
	},
	{
		name: "progressive-bracket",
		label: "Tax table",
		summary:
			"Looks up tax in a table (for example federal tax) after subtracting the standard deduction.",
	},
];

export const FALLBACK_PROVIDERS: CopyEntry[] = [
	{
		name: "model-value",
		label: "Other movement amount",
		summary:
			"Use the last calculated amount of another paycheck or movement. Falls back to account balance when no history exists.",
	},
	{
		name: "account-balance",
		label: "Account balance",
		summary:
			"The live balance of one account on that date. Moves with the projection.",
	},
	{
		name: "occurrence-rate",
		label: "Yearly rate per paycheck",
		summary:
			"Turns a yearly percent into one paycheck slice. Example: 7% yearly on a monthly rule pays about 0.58% each month. Add wobble to model uncertainty.",
	},
	{
		name: "growth-factor",
		label: "Yearly growth",
		summary:
			"Grows over time from the rule start date. A 3% growth on a monthly rule compounds each month automatically.",
	},
	{
		name: "terms-minimum",
		label: "Card minimum due",
		summary:
			"What the card company says you must pay: the fixed minimum or a percent of what you owe, whichever is larger.",
	},
	{
		name: "late-fee",
		label: "Late fee (only if short)",
		summary:
			"Charges a flat fee only when last month's payment was short of the minimum due. Otherwise zero.",
	},
	{
		name: "balance-fee",
		label: "Low-balance fee",
		summary:
			"Charges a flat fee only when the account balance sits below a limit on that date. Otherwise zero.",
	},
];

function fixed(expression: string): PostingAmountResolution {
	return {
		resolver: "expression",
		config: { expression },
		inputs: {},
	};
}

export const FALLBACK_TEMPLATES: AmountTemplate[] = [
	{
		id: "fixed",
		label: "Fixed amount",
		summary: "Same dollars every time. Example: $500 monthly investing.",
		whenToUse: "Rent, fixed savings, any bill that never changes.",
		resolver: "expression",
		amount: fixed("500"),
	},
	{
		id: "growth",
		label: "Grows yearly by %",
		summary:
			"Starts at a base amount, then grows by a yearly percent from the start date.",
		whenToUse: "Salary that rises 3% a year, rent that climbs.",
		resolver: "expression",
		amount: {
			resolver: "expression",
			config: { expression: "(base) * growth" },
			inputs: {
				base: { source: "literal", value: 500 },
				growth: {
					source: "provider",
					provider: "growth-factor",
					arguments: { annualGrowthRate: 0.03 },
				},
			},
		},
	},
	{
		id: "account-percent",
		label: "Percent of account",
		summary: "A percent of a live account balance. Example: 4% withdrawal.",
		whenToUse: "Withdrawals tied to balance, fees tied to what you owe.",
		resolver: "expression",
		amount: {
			resolver: "expression",
			config: { expression: "balance * pct" },
			inputs: {
				balance: {
					source: "provider",
					provider: "account-balance",
					arguments: { id: "brokerage" },
				},
				pct: { source: "literal", value: 0.04 },
			},
		},
	},
	{
		id: "investment-growth",
		label: "Investment growth",
		summary:
			"Balance times a yearly rate, split across paychecks. Add wobble to model uncertainty ranges.",
		whenToUse: "Brokerage or savings growth with optional volatility.",
		resolver: "expression",
		amount: {
			resolver: "expression",
			config: { expression: "brokerage * rate" },
			inputs: {
				brokerage: {
					source: "provider",
					provider: "model-value",
					arguments: { id: "brokerage" },
				},
				rate: {
					source: "provider",
					provider: "occurrence-rate",
					arguments: { annualRate: 0.07, volatility: 0.12 },
				},
			},
		},
	},
	{
		id: "debt-minimum",
		label: "Card minimum due",
		summary: "Pays exactly what the card requires, no more.",
		whenToUse: "Minimum-only debt payments.",
		resolver: "expression",
		amount: {
			resolver: "expression",
			config: { expression: "minimum" },
			inputs: {
				minimum: {
					source: "provider",
					provider: "terms-minimum",
					arguments: { id: "prime_card" },
				},
			},
		},
	},
	{
		id: "late-fee",
		label: "Late fee if short",
		summary: "Adds a flat fee only when the payment was short this month.",
		whenToUse: "Model penalties without overcharging on-time months.",
		resolver: "expression",
		amount: {
			resolver: "expression",
			config: { expression: "fee" },
			inputs: {
				fee: {
					source: "provider",
					provider: "late-fee",
					arguments: {
						payment: "card_payment",
						account: "prime_card",
						fee: 30,
					},
				},
			},
		},
	},
	{
		id: "low-balance-fee",
		label: "Low-balance fee",
		summary: "Adds a flat fee only when the balance drops below a limit.",
		whenToUse: "Bank fees tied to minimum balances.",
		resolver: "expression",
		amount: {
			resolver: "expression",
			config: { expression: "fee" },
			inputs: {
				fee: {
					source: "provider",
					provider: "balance-fee",
					arguments: { account: "checking", threshold: 1500, fee: 12 },
				},
			},
		},
	},
	{
		id: "paycheck",
		label: "Paycheck take-home",
		summary:
			"Yearly salary minus 401k percent and tax table, in order. Remainder lands as take-home pay.",
		whenToUse: "Any salary with pre-tax savings and taxes.",
		resolver: "income",
		amount: {
			resolver: "income",
			config: {
				incomeSourceId: "salary",
				resolvers: [
					{
						resolver: "percentage",
						config: { rate: 0.1, annualCap: 23500 },
						destinationAccountId: "401k",
					},
					{ resolver: "progressive-bracket", config: { profileId: "federal" } },
				],
			},
			inputs: {},
		},
	},
];

export function plainLanguageForAmount(
	amount: PostingAmountResolution | null | undefined,
): string {
	if (!amount) return "No amount set.";
	if (amount.resolver === "income") {
		const steps =
			(
				(amount.config as Record<string, unknown> | null)?.resolvers as
					| Array<{ resolver?: string }>
					| undefined
			)?.length ?? 0;
		return `Take-home pay: salary minus ${steps} step${steps === 1 ? "" : "s"} in order. Remainder is deposited.`;
	}
	const expression =
		(amount.config as Record<string, unknown> | null)?.expression ?? "";
	if (typeof expression !== "string" || !expression.trim()) {
		return "Calculated from the values you pick below.";
	}
	const trimmed = expression.trim();
	if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(trimmed)) {
		return `Fixed amount of $${trimmed} every time.`;
	}
	return "Calculated from the values you pick below.";
}

export function templateById(id: string): AmountTemplate | null {
	return FALLBACK_TEMPLATES.find((template) => template.id === id) ?? null;
}

// Built-in recipe names the builder knows how to render field editors for.
// Server presets with other names render their stored amount directly.
export const BUILT_IN_TEMPLATE_IDS: ReadonlySet<string> = new Set(
	FALLBACK_TEMPLATES.map((template) => template.id),
);

export function presetToTemplate(preset: {
	name: string;
	label: string;
	summary?: string | null;
	whenUse?: string | null;
	amount: PostingAmountResolution;
}): AmountTemplate {
	return {
		id: preset.name,
		label: preset.label,
		summary: preset.summary ?? undefined,
		whenToUse: preset.whenUse ?? undefined,
		amount: preset.amount,
	};
}
