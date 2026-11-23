import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import type { AccountKind } from "../api/contracts.ts";

/**
 * The proposed kind is the existing account kind, never a separate card
 * classification. The finding only asks; the declared kind stays authoritative.
 */
export const CARD_KIND_SUGGESTION: AccountKind = "credit_card";

/** `accountId` is carried by account-scoped findings in the shared shape. */
type AccountFinding = AnalysisFinding & { accountId?: string };

function findingAccountId(finding: AnalysisFinding): string | undefined {
	return (finding as AccountFinding).accountId;
}

/** A card-kind finding belongs to the account it describes, not a transaction. */
export function isCardKindFinding(finding: AnalysisFinding): boolean {
	if (!findingAccountId(finding)) return false;
	return (
		finding.analysisType === "card-kind" ||
		finding.kind === "card-kind" ||
		finding.kind === CARD_KIND_SUGGESTION
	);
}

/**
 * One unanswered card-kind finding for the viewed account. Dismissed, stale,
 * withdrawn, and rejected findings stay out, and an account already carrying
 * the proposed kind needs no suggestion.
 */
export function cardKindFinding(
	findings: AnalysisFinding[],
	accountId: string,
	currentKind: AccountKind,
): AnalysisFinding | undefined {
	if (currentKind === CARD_KIND_SUGGESTION) return undefined;
	return findings.find(
		(finding) =>
			isCardKindFinding(finding) &&
			findingAccountId(finding) === accountId &&
			!finding.dismissed &&
			!finding.stale &&
			finding.status === "active" &&
			finding.review?.decision !== "rejected",
	);
}

/** The plain-language evidence reasons are the basis shown to the owner. */
export function cardKindBasis(finding: AnalysisFinding): string[] {
	return (finding.evidence ?? [])
		.map((item) => item.reason?.trim() ?? "")
		.filter(Boolean);
}
