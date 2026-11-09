import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";

export interface IncomePattern {
	key: string;
	findings: AnalysisFinding[];
	anchor: AnalysisFinding;
}

/** Keep current and withdrawn evidence separate. A rescore does not change keys. */
export function groupIncomePatterns(
	findings: AnalysisFinding[],
): IncomePattern[] {
	const groups = new Map<string, AnalysisFinding[]>();
	for (const finding of findings) {
		if (finding.kind !== "income" || !finding.income) continue;
		const key = JSON.stringify([finding.income.patternId, finding.status]);
		const group = groups.get(key);
		if (group) group.push(finding);
		else groups.set(key, [finding]);
	}
	return [...groups]
		.map(([key, members]) => {
			// Keep the most recently reviewed occurrence correctable. Otherwise use
			// an eligible occurrence; reviewing it produces one explicit label.
			const ordered = [...members].sort(
				(a, b) =>
					(b.review?.answeredAt ?? 0) - (a.review?.answeredAt ?? 0) ||
					b.feedbackRevision - a.feedbackRevision ||
					a.id.localeCompare(b.id),
			);
			const anchor = ordered.find((finding) => !finding.stale) ?? ordered[0]!;
			return { key, findings: ordered, anchor };
		})
		.sort(
			(a, b) =>
				Number(isMainIncome(b.anchor)) - Number(isMainIncome(a.anchor)) ||
				a.key.localeCompare(b.key),
		);
}

export function incomeAmount(amount: string, currency: string): string {
	const numeric = new Intl.NumberFormat("en-US", {
		maximumFractionDigits: 2,
	}).format(Number(amount));
	return `${numeric}${currency ? ` ${currency}` : ""}`;
}

export function isMainIncome(finding: AnalysisFinding) {
	return (finding.evidence ?? []).some((evidence) =>
		evidence.code?.startsWith("income.main-inflow"),
	);
}

export function incomeLabel(finding: AnalysisFinding) {
	if (finding.review?.decision === "rejected") return "Not income";
	if (finding.review?.decision === "confirmed") return "Confirmed income";
	if (finding.judgment?.status === "pending") return "Review pending";
	if (isMainIncome(finding)) return "Main income";
	return finding.strength === "strong" ? "Likely income" : "Possible income";
}

export function incomeStatus(finding: AnalysisFinding) {
	if (finding.status === "withdrawn") return "Withdrawn";
	if (finding.review?.decision === "rejected") return "Not income";
	if (finding.dismissed) return "Dismissed";
	if (finding.review?.decision === "confirmed") return "Confirmed";
	if (finding.stale) return "Awaiting analysis";
	if (finding.judgment?.status === "pending") return "Review pending";
	return "Active";
}
