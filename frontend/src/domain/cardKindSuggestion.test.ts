import { describe, expect, it } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	CARD_KIND_SUGGESTION,
	cardKindBasis,
	cardKindChipLabel,
	cardKindFinding,
} from "./cardKindSuggestion.ts";

function finding(
	overrides: Partial<AnalysisFinding> & { accountId?: string } = {},
): AnalysisFinding {
	return {
		analysisType: "card-kind",
		analyzerVersion: "v1",
		dismissed: false,
		evidence: [
			{
				code: "card-issuer",
				reason: "The issuer appears in the card provider list.",
				transactionIds: null,
			},
			{
				code: "debt-balance",
				reason: "The balance behaves like a debt.",
				transactionIds: null,
			},
		],
		feedbackRevision: 0,
		firstDetectedAt: 1,
		id: "card-1",
		inputRevision: 1,
		kind: "credit_card",
		lastCheckedAt: 2,
		product: "",
		provider: "",
		role: "",
		runId: "run-1",
		stale: false,
		status: "active",
		strength: "strong",
		transactionId: "",
		accountId: "account-1",
		...overrides,
	} as AnalysisFinding;
}

describe("card-kind suggestion", () => {
	it("selects one active finding for the viewed account", () => {
		const result = cardKindFinding(
			[
				finding({ id: "other-account", accountId: "account-2" }),
				finding({ id: "dismissed", dismissed: true }),
				finding({ id: "stale", stale: true }),
				finding({
					id: "rejected",
					review: { answeredAt: 3, decision: "rejected", provider: "" },
				}),
				finding({ id: "withdrawn", status: "withdrawn" }),
				finding({ id: "wanted" }),
			],
			"account-1",
			"cash",
		);
		expect(result?.id).toBe("wanted");
	});

	it("does not suggest the kind the account already declares", () => {
		expect(
			cardKindFinding([finding()], "account-1", CARD_KIND_SUGGESTION),
		).toBeUndefined();
	});

	it("leaves transaction findings and other analyses alone", () => {
		expect(
			cardKindFinding(
				[
					finding({ accountId: undefined, analysisType: "bnpl", kind: "bnpl" }),
					finding({
						id: "recurring",
						analysisType: "recurring",
						kind: "recurring",
					}),
				],
				"account-1",
				"cash",
			),
		).toBeUndefined();
	});

	it("shows the evidence reasons as the basis", () => {
		expect(cardKindBasis(finding())).toEqual([
			"The issuer appears in the card provider list.",
			"The balance behaves like a debt.",
		]);
		expect(cardKindBasis(finding({ evidence: null }))).toEqual([]);
	});

	it("reuses pattern chip wording with the account kind label", () => {
		expect(cardKindChipLabel(finding())).toBe("Credit card?");
	});
});
