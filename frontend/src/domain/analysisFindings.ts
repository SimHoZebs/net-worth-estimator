import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { findingStateLabel } from "./paymentFindings.ts";

export function activeBNPLFinding(
	findings: AnalysisFinding[],
	transactionId: string,
) {
	return findings.find(
		(finding) =>
			finding.transactionId === transactionId &&
			finding.kind === "bnpl" &&
			!finding.dismissed &&
			finding.review?.decision !== "rejected" &&
			(finding.review?.decision === "confirmed" ||
				(finding.status === "active" && !finding.stale)),
	);
}

/** The label helper has always accepted a strength and review pair, while its
 * callers pass the whole finding. The shared owner needs the complete shape. */
type LabelFinding = Pick<AnalysisFinding, "strength" | "review"> &
	Partial<AnalysisFinding>;

export function findingLabel(finding: LabelFinding) {
	// The badge reads "BNPL" where the shared label style says "Confirmed BNPL".
	if (finding.review?.decision === "confirmed") return "BNPL";
	return findingStateLabel(
		{ ...finding, kind: "BNPL" } as AnalysisFinding,
		"label",
	);
}

export function findingStatus(finding: AnalysisFinding) {
	const answered =
		Boolean(finding.review?.decision) || finding.dismissed || finding.stale;
	// The shared owner checks withdrawal before answers and staleness. BNPL rows
	// keep the latest answer visible, so clear the operational status there.
	const state: AnalysisFinding = {
		...finding,
		kind: "BNPL",
		status:
			answered && finding.status === "withdrawn" ? "active" : finding.status,
	};
	const shared = findingStateLabel(state, "status");
	// The column reads "Active" where the shared status style says "Needs review".
	return shared === "Needs review" ? "Active" : shared;
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
