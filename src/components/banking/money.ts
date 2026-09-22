import {
	associatedAccountIds,
	isNumericArithmetic,
	parseNumericArithmetic,
} from "@/lib/posting-categories";
import { getExpression, type Posting } from "@/lib/projection";

export type MoneyDirection = "in" | "out" | "transfer";

export function moneyDirection(
	posting: Pick<Posting, "sourceAccountId" | "destinations">,
): MoneyDirection {
	if (!posting.sourceAccountId && posting.destinations?.length) return "in";
	if (posting.sourceAccountId && posting.destinations === null) return "out";
	return "transfer";
}

/** Numeric preview of the amount expression, or null when calculated. */
export function moneyAmount(posting: Pick<Posting, "amount">): number | null {
	const expression = getExpression(posting);
	if (expression !== null && isNumericArithmetic(expression)) {
		return parseNumericArithmetic(expression);
	}
	return null;
}

export function touchesAccount(
	posting: Posting,
	accountId: string,
	accountIds: ReadonlySet<string>,
): boolean {
	return associatedAccountIds(posting, accountIds).includes(accountId);
}

export function slugId(label: string, prefix: string): string {
	const slug =
		label
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "item";
	return `${prefix}-${slug}-${Date.now().toString(36)}`;
}

const DIRECTION_LABEL: Record<MoneyDirection, string> = {
	in: "Money in",
	out: "Money out",
	transfer: "Transfer",
};

export function directionLabel(direction: MoneyDirection): string {
	return DIRECTION_LABEL[direction];
}
