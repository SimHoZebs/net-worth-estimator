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

export function paymentLabel(finding: AnalysisFinding) {
	const label = finding.kind;
	if (finding.review?.decision === "rejected") return `Not ${label}`;
	if (finding.review?.decision === "confirmed") return `Confirmed ${label}`;
	if (finding.judgment?.status === "pending") return "Review pending";
	if (finding.judgment?.decision === "unsupported") return `Not ${label}`;
	if (finding.judgment?.decision === "uncertain") return `Possible ${label}`;
	if (isMainIncome(finding)) return "Main income";
	return finding.strength === "strong"
		? `Likely ${label}`
		: `Possible ${label}`;
}

export function paymentTitle(
	pattern: PaymentPattern,
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
	const raw = (pattern.anchor.provider ?? "").trim() || pattern.anchor.kind;
	const merchant = raw.trim();
	return merchant
		? merchant.charAt(0).toUpperCase() + merchant.slice(1)
		: "Payment pattern";
}

export function paymentStatus(finding: AnalysisFinding) {
	if (finding.status === "withdrawn") return "Withdrawn";
	if (finding.review?.decision === "rejected") return `Not ${finding.kind}`;
	if (finding.dismissed) return "Dismissed";
	if (finding.review?.decision === "confirmed") return "Confirmed";
	if (finding.stale) return "Awaiting analysis";
	if (finding.judgment?.status === "pending") return "Review pending";
	return "Needs review";
}
