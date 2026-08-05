import type { Checkpoint, Posting } from "../types/model";

export function isGeneratedCheckpointSurrogate(
	posting: Posting,
	checkpoints: readonly Checkpoint[],
): boolean {
	const match = /^(opening|adjustment)_(\d{4})(\d{2})(\d{2})_(.+)$/u.exec(
		posting.id,
	);
	if (!match) return false;
	const [, , year, month, day, accountId] = match;
	if (!accountId) return false;
	const date = `${year}-${month}-${day}`;
	const hasMatchingCheckpoint = checkpoints.some(
		(checkpoint) =>
			checkpoint.Date === date && checkpoint.AccountId === accountId,
	);
	const isMatchingRoute =
		(posting.sourceAccountId === null &&
			posting.destinations?.length === 1 &&
			posting.destinations[0] === accountId) ||
		(posting.sourceAccountId === accountId && posting.destinations === null);
	const expression = posting.amount.config.expression;
	const hasGeneratedAmount =
		posting.amount.resolver === "expression" &&
		Object.keys(posting.amount.config).length === 1 &&
		typeof expression === "string" &&
		Number.isFinite(Number(expression)) &&
		Number(expression) >= 0 &&
		Object.keys(posting.amount.inputs).length === 0;
	return (
		hasMatchingCheckpoint &&
		isMatchingRoute &&
		hasGeneratedAmount &&
		posting.frequency === "once" &&
		posting.startDate === date &&
		posting.endDate === null &&
		posting.annualRate === 0 &&
		posting.annualGrowthRate === 0 &&
		posting.volatility === 0 &&
		posting.annualCap === null &&
		posting.priority === 1 &&
		posting.enabled
	);
}
