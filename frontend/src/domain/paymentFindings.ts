import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";

export interface PaymentPattern {
	key: string;
	findings: AnalysisFinding[];
	anchor: AnalysisFinding;
}

/** Keep current and withdrawn evidence separate. A rescore does not change keys. */
export function groupPaymentPatterns(
	findings: AnalysisFinding[],
): PaymentPattern[] {
	const groups = new Map<string, AnalysisFinding[]>();
	for (const finding of findings) {
		if (!finding.pattern) continue;
		const key = JSON.stringify([
			finding.kind,
			finding.pattern.patternId,
			finding.status,
		]);
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

export function paymentAmount(amount: string, currency: string): string {
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

/** Display styles for one finding state. Chips read as kind questions when
 * unanswered, labels keep the strength-based likely/possible wording, and
 * statuses collapse answers to confirmed/not-kind. */
export type FindingStateStyle = "chip" | "label" | "status";

/**
 * One wording owner for every finding state over status, review answers,
 * dismissal, staleness, and judgment. The review list chips, the dialog
 * badges, and the repetition marker all delegate here so the copies cannot
 * drift apart.
 */
export function findingStateLabel(
	finding: AnalysisFinding,
	style: FindingStateStyle,
): string {
	const kind = finding.kind;
	if (style === "label") {
		if (finding.review?.decision === "rejected") return `Not ${kind}`;
		if (finding.review?.decision === "confirmed") return `Confirmed ${kind}`;
		if (finding.judgment?.status === "pending") return "Review pending";
		if (finding.judgment?.decision === "unsupported") return `Not ${kind}`;
		if (finding.judgment?.decision === "uncertain") return `Possible ${kind}`;
		if (isMainIncome(finding)) return "Main income";
		return finding.strength === "strong"
			? `Likely ${kind}`
			: `Possible ${kind}`;
	}
	if (style === "status") {
		if (finding.status === "withdrawn") return "Withdrawn";
		if (finding.review?.decision === "rejected") return `Not ${kind}`;
		if (finding.dismissed) return "Dismissed";
		if (finding.review?.decision === "confirmed") return "Confirmed";
		if (finding.stale) return "Awaiting analysis";
		if (finding.judgment?.status === "pending") return "Review pending";
		return "Needs review";
	}
	if (finding.status === "withdrawn") return "Withdrawn";
	if (finding.review?.decision === "rejected") return `Not ${kind}`;
	if (finding.review?.decision === "confirmed") return kind;
	if (finding.dismissed) return "Dismissed";
	if (finding.stale) return "Awaiting analysis";
	if (finding.judgment?.status === "pending") return "Review pending";
	if (finding.judgment?.decision === "unsupported") return `Not ${kind}`;
	if (finding.judgment?.decision === "uncertain") return `Possible ${kind}`;
	if (isMainIncome(finding)) return "Main income";
	return `${kind}?`;
}

export function paymentLabel(finding: AnalysisFinding) {
	return findingStateLabel(finding, "label");
}

export function paymentStatus(finding: AnalysisFinding) {
	return findingStateLabel(finding, "status");
}
