import {
	type FinancialModelDocument,
	getExpression,
	type Posting,
} from "@/lib/projection";

export function indexPaymentPostingsByAccountId(
	document: FinancialModelDocument,
): ReadonlyMap<string, Posting> {
	const paymentByAccountId = new Map<string, Posting>();
	for (const posting of document.postings) {
		const label = posting.label.toLowerCase();
		if (
			!posting.enabled ||
			(!label.includes("payment") && !label.includes("pay"))
		) {
			continue;
		}
		for (const accountId of posting.destinations ?? []) {
			if (!paymentByAccountId.has(accountId)) {
				paymentByAccountId.set(accountId, posting);
			}
		}
	}
	return paymentByAccountId;
}

export function isDebtAccount(label: string): boolean {
	const l = label.toLowerCase();
	return (
		l.includes("loan") ||
		l.includes("debt") ||
		l.includes("mortgage") ||
		l.includes("credit")
	);
}

export function estimateMonthlyPayment(p: Posting | undefined): number {
	if (!p) return 0;
	const expression = getExpression(p);
	const num = expression === null ? Number.NaN : Number(expression);
	if (!Number.isFinite(num)) return 0;
	const freq = p.frequency;
	if (freq === "monthly") return num;
	if (freq === "weekly") return num * 4.33;
	if (freq === "quarterly") return num / 3;
	if (freq === "annual") return num / 12;
	return num;
}
