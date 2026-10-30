import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";

export function activeBNPLFinding(
	findings: AnalysisFinding[],
	postingId: string,
) {
	return findings.find(
		(finding) =>
			finding.postingId === postingId &&
			finding.kind === "bnpl" &&
			!finding.dismissed &&
			finding.review?.decision !== "rejected" &&
			(finding.review?.decision === "confirmed" ||
				(finding.status === "active" && !finding.stale)),
	);
}

export function findingLabel(
	finding: Pick<AnalysisFinding, "strength" | "review">,
) {
	if (finding.review?.decision === "confirmed") return "BNPL";
	return finding.strength === "strong" ? "Likely BNPL" : "Possible BNPL";
}

export function findingStatus(finding: AnalysisFinding) {
	if (finding.review?.decision === "rejected") return "Not BNPL";
	if (finding.dismissed) return "Dismissed";
	if (finding.review?.decision === "confirmed") return "Confirmed";
	if (finding.stale) return "Awaiting analysis";
	return finding.status === "withdrawn" ? "Withdrawn" : "Active";
}

export function providerLabel(provider: string) {
	const names: Record<string, string> = {
		klarna: "Klarna",
		affirm: "Affirm",
		afterpay: "Afterpay",
		sezzle: "Sezzle",
		zip: "Zip",
		paypal: "PayPal",
		"shop-pay": "Shop Pay",
	};
	return names[provider] ?? (provider || "Unknown provider");
}
