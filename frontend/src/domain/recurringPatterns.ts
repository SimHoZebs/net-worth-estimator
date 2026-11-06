import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";

export interface RecurringPattern {
	key: string;
	merchant: string;
	cadence: string;
	findings: AnalysisFinding[];
	anchor: AnalysisFinding;
	confirmed?: AnalysisFinding;
}

function evidenceIds(finding: AnalysisFinding): string[] {
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const evidence of finding.evidence ?? [])
		for (const id of evidence.transactionIds ?? []) {
			if (id && !seen.has(id)) {
				seen.add(id);
				ordered.push(id);
			}
		}
	return ordered;
}

function patternKey(finding: AnalysisFinding): string | null {
	const ids = evidenceIds(finding);
	if (finding.kind !== "recurring" || ids.length === 0) return null;
	return ["recurring", finding.product, ...[...ids].sort()].join(" ");
}

/** Group repeating-payment findings by their recorded occurrence set. */
export function groupRecurringPatterns(
	findings: AnalysisFinding[],
): RecurringPattern[] {
	const groups = new Map<string, AnalysisFinding[]>();
	for (const finding of findings) {
		const key = patternKey(finding);
		if (!key) continue;
		const group = groups.get(key);
		if (group) group.push(finding);
		else groups.set(key, [finding]);
	}
	return [...groups.entries()].flatMap(([key, group]) => {
		const head = group[0];
		if (!head) return [];
		const order = new Map(evidenceIds(head).map((id, index) => [id, index]));
		const findings = [...group].sort(
			(a, b) =>
				(order.get(a.transactionId) ?? Number.MAX_SAFE_INTEGER) -
				(order.get(b.transactionId) ?? Number.MAX_SAFE_INTEGER),
		);
		const anchor = findings[0];
		if (!anchor) return [];
		const pattern: RecurringPattern = {
			key,
			merchant: head.provider,
			cadence: head.product,
			findings,
			anchor,
			confirmed: findings.find(
				(finding) => finding.review?.decision === "confirmed",
			),
		};
		return [pattern];
	});
}

/** The most common saved transaction name behind a pattern, oldest first on ties. */
export function patternTitle(
	pattern: RecurringPattern,
	names: Map<string, string>,
): string {
	const counts = new Map<string, number>();
	let best = "";
	let bestCount = 0;
	for (const finding of pattern.findings) {
		const name = names.get(finding.transactionId) ?? "";
		if (!name) continue;
		const count = (counts.get(name) ?? 0) + 1;
		counts.set(name, count);
		if (count > bestCount) {
			best = name;
			bestCount = count;
		}
	}
	if (best) return best;
	const merchant = pattern.merchant.trim();
	return merchant
		? merchant.charAt(0).toUpperCase() + merchant.slice(1)
		: "Repeating payment";
}

export function cadenceLabel(cadence: string): string {
	switch (cadence) {
		case "weekly":
			return "Weekly";
		case "biweekly":
			return "Every 2 weeks";
		case "monthly":
			return "Monthly";
		case "quarterly":
			return "Every 3 months";
		case "annual":
			return "Yearly";
		default:
			return "Repeating";
	}
}

export function directionLabel(direction: string): string {
	switch (direction) {
		case "inflow":
			return "Deposit";
		case "outflow":
			return "Payment";
		default:
			return "Movement";
	}
}

export function frequencyLabel(frequency: string): string {
	switch (frequency) {
		case "daily":
			return "Daily";
		case "weekly":
			return "Weekly";
		case "monthly":
			return "Monthly";
		case "quarterly":
			return "Every 3 months";
		case "annual":
		case "yearly":
			return "Yearly";
		case "once":
			return "One-time";
		default:
			return frequency || "Repeating";
	}
}

export function recurringPatternStatus(pattern: RecurringPattern): string {
	if (pattern.confirmed) return "Confirmed";
	const anchor = pattern.anchor;
	if (anchor.review?.decision === "rejected") return "Not repeating";
	if (anchor.dismissed) return "Dismissed";
	if (anchor.stale) return "Awaiting analysis";
	return anchor.status === "withdrawn" ? "Withdrawn" : "Needs review";
}
