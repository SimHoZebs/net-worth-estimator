import type { PostingAmountResolution } from "../../api/contracts.ts";

const paths: Record<string, Record<string, string[]>> = {
	fixed: { amount: ["config", "expression"] },
	growth: {
		base: ["inputs", "base", "value"],
		annualGrowthRate: ["inputs", "growth", "arguments", "annualGrowthRate"],
	},
	"account-percent": {
		accountId: ["inputs", "balance", "arguments", "id"],
		pct: ["inputs", "pct", "value"],
	},
	"investment-growth": {
		refId: ["inputs", "ref", "arguments", "id"],
		annualRate: ["inputs", "rate", "arguments", "annualRate"],
		volatility: ["inputs", "rate", "arguments", "volatility"],
	},
	"debt-minimum": { accountId: ["inputs", "minimum", "arguments", "id"] },
	"late-fee": {
		paymentId: ["inputs", "fee", "arguments", "payment"],
		accountId: ["inputs", "fee", "arguments", "account"],
		fee: ["inputs", "fee", "arguments", "fee"],
	},
	"low-balance-fee": {
		accountId: ["inputs", "fee", "arguments", "account"],
		threshold: ["inputs", "fee", "arguments", "threshold"],
		fee: ["inputs", "fee", "arguments", "fee"],
	},
	"federal-tax": {
		deduction: ["config", "deduction"],
		brackets: ["config", "brackets"],
		grossId: ["inputs", "gross", "arguments", "id"],
		pretaxId: ["inputs", "pretax", "arguments", "id"],
	},
};

function readPath(value: unknown, path: string[]): unknown {
	return path.reduce<unknown>(
		(current, key) =>
			current && typeof current === "object"
				? (current as Record<string, unknown>)[key]
				: undefined,
		value,
	);
}

export function templateFieldsFromAmount(
	id: string,
	amount: PostingAmountResolution | undefined,
): Record<string, string> {
	if (!amount) return {};
	return Object.fromEntries(
		Object.entries(paths[id] ?? {}).flatMap(([field, path]) => {
			const value = readPath(amount, path);
			return value === undefined
				? []
				: [
						[
							field,
							typeof value === "object" ? JSON.stringify(value) : String(value),
						],
					];
		}),
	);
}

/** Change only the paths the user edited. Preserve the saved resolver and all other inputs. */
export function patchTemplateAmount(
	id: string,
	source: PostingAmountResolution,
	built: PostingAmountResolution,
	fields: Record<string, string>,
): PostingAmountResolution {
	const next = structuredClone(source);
	for (const field of Object.keys(fields)) {
		const path = paths[id]?.[field];
		if (!path) continue;
		let target = next as unknown as Record<string, unknown>;
		for (const key of path.slice(0, -1)) {
			if (!target[key] || typeof target[key] !== "object") target[key] = {};
			target = target[key] as Record<string, unknown>;
		}
		target[path[path.length - 1]!] = readPath(built, path);
	}
	return next;
}
