import { isGroupedDisplay } from "./accountDisplay.ts";
import { isLiability } from "./accountKinds.ts";

type AmountAccount = {
	id: string;
	kind: string;
	display?: { components?: readonly unknown[] | null } | null;
};

type NumericRule = {
	key: string;
	label: string;
	min: number;
	max?: number;
};

const NUMERIC_RULES: Record<string, NumericRule[]> = {
	fixed: [{ key: "amount", label: "Amount (USD)", min: 0, max: 1e10 }],
	growth: [
		{ key: "base", label: "Amount (USD)", min: 0, max: 1e10 },
		{
			key: "annualGrowthRate",
			label: "Annual amount increase (%)",
			min: -0.5,
			max: 0.5,
		},
	],
	"schedule-percent": [{ key: "percent", label: "Percentage (%)", min: 0 }],
	"account-percent": [{ key: "pct", label: "Percentage (%)", min: 0 }],
	"investment-growth": [
		{ key: "annualRate", label: "Annual return (%)", min: -0.5, max: 1 },
		{ key: "volatility", label: "Annual volatility (%)", min: 0, max: 1 },
	],
};

const REFERENCE_RULES: Record<
	string,
	| { key: string; kind: "schedule"; message: string }
	| { key: string; kind: "account" | "debt"; message: string }
> = {
	"schedule-percent": {
		key: "reference",
		kind: "schedule",
		message: "Choose a schedule.",
	},
	"account-percent": {
		key: "accountId",
		kind: "account",
		message: "Choose an account.",
	},
	"investment-growth": {
		key: "refId",
		kind: "account",
		message: "Choose an account.",
	},
	"owed-balance": {
		key: "accountId",
		kind: "debt",
		message: "Choose a debt account.",
	},
};

/** Validate only the guided fields owned by the schedule form. Saved custom
 * descriptors keep their server-defined shape and are not constrained here. */
export function validateScheduleAmountDraft({
	templateId,
	fields,
	accounts,
	schedules,
}: {
	templateId: string;
	fields: Record<string, string>;
	accounts: AmountAccount[];
	schedules: { id: string }[];
}): string | null {
	for (const rule of NUMERIC_RULES[templateId] ?? []) {
		const raw = fields[rule.key] ?? "";
		if (!raw.trim()) return `Enter ${rule.label.toLowerCase()}.`;
		const value = Number(raw);
		if (
			!Number.isFinite(value) ||
			value < rule.min ||
			(rule.max !== undefined && value > rule.max)
		)
			return `Review ${rule.label.toLowerCase()}.`;
	}
	const reference = REFERENCE_RULES[templateId];
	if (!reference) return null;
	const id = fields[reference.key]?.trim() ?? "";
	if (!id) return reference.message;
	if (reference.kind === "schedule")
		return schedules.some((schedule) => schedule.id === id)
			? null
			: reference.message;
	const account = accounts.find((entry) => entry.id === id);
	if (!account || isGroupedDisplay(account)) return reference.message;
	return (
		reference.kind === "debt" ? isLiability(account) : !isLiability(account)
	)
		? null
		: reference.message;
}
