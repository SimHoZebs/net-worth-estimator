export const fundingLabels = {
	title: "Funding gaps",
	detail: "Funding gap",
	clear: "No projected funding gaps",
} as const;

/** Translate the stored default label without changing custom names or data. */
export function fundingEvaluationName(name: string): string {
	return !name || name === "Posting fulfillment" ? fundingLabels.title : name;
}
