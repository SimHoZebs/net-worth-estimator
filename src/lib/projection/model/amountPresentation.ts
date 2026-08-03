import type {
	JsonValue,
	Posting,
	PostingAmountResolution,
} from "../types/model";

export interface AmountPresentationNode {
	label: string;
	value?: string;
	children?: AmountPresentationNode[];
}

export interface AmountPresentation {
	summary: string;
	sections: AmountPresentationNode[];
}

export function getExpression(posting: Pick<Posting, "amount">): string | null {
	return posting.amount.resolver === "expression" &&
		typeof posting.amount.config.expression === "string"
		? posting.amount.config.expression
		: null;
}

function displayLabel(identifier: string): string {
	const words = identifier
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[-_]+/g, " ")
		.trim();
	if (!words) return "Value";
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`.replace(
		/\bId\b/g,
		"ID",
	);
}

function primitiveValue(value: JsonValue): string {
	if (value === null) return "None";
	if (typeof value === "boolean") return value ? "True" : "False";
	return String(value);
}

function presentValue(label: string, value: JsonValue): AmountPresentationNode {
	if (Array.isArray(value)) {
		return {
			label: displayLabel(label),
			value: value.length === 0 ? "None" : undefined,
			children: value.map((item, index) =>
				presentValue(`Step ${index + 1}`, item),
			),
		};
	}
	if (typeof value === "object" && value !== null) {
		const resolver =
			typeof value.resolver === "string" ? value.resolver : undefined;
		const entries = Object.entries(value).filter(
			([key]) => !(resolver && key === "resolver"),
		);
		return {
			label: resolver
				? `${displayLabel(resolver)} calculation`
				: displayLabel(label),
			value: entries.length === 0 ? "None" : undefined,
			children: entries.map(([key, child]) => presentValue(key, child)),
		};
	}
	return { label: displayLabel(label), value: primitiveValue(value) };
}

export function getAmountPresentation(
	amount: PostingAmountResolution,
): AmountPresentation {
	const summary = `${displayLabel(amount.resolver)} calculation`;
	return {
		summary,
		sections: [
			presentValue("Configuration", amount.config),
			presentValue("Inputs", amount.inputs),
		],
	};
}

export function describePostingAmount(
	posting: Pick<Posting, "amount">,
): string {
	return (
		getExpression(posting) ?? getAmountPresentation(posting.amount).summary
	);
}
