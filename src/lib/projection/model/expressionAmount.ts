import type {
	AmountInputBinding,
	PostingAmountResolution,
} from "../types/model";

const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Editor-side constructor for expression amounts. Extracts identifier
 * requirements with a lexical scan only; expression semantics and validation
 * run server-side in Go. `abs` is a display function, not an input.
 */
export function expressionRequirements(expression: string): readonly string[] {
	const names = new Set<string>();
	for (const match of expression.match(IDENTIFIER_PATTERN) ?? []) {
		if (match === "abs") continue;
		names.add(match);
	}
	return [...names];
}

function inputsFor(expression: string): Record<string, AmountInputBinding> {
	const inputs: Record<string, AmountInputBinding> = {};
	for (const requirement of expressionRequirements(expression)) {
		inputs[requirement] =
			requirement === "rate"
				? { source: "provider", provider: "occurrence-rate", arguments: {} }
				: {
						source: "provider",
						provider: "model-value",
						arguments: { id: requirement },
					};
	}
	return inputs;
}

export function createExpressionAmount(
	expression: string,
): PostingAmountResolution {
	if (expression.trim() === "") {
		throw new Error("Amount expression must not be empty.");
	}
	return {
		resolver: "expression",
		config: { expression },
		inputs: inputsFor(expression),
	};
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
