import { describe, expect, it } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	groupPaymentPatterns,
	paymentLabel,
	paymentStatus,
} from "./paymentFindings.ts";

describe("payment classifications", () => {
	const rent = {
		id: "rent",
		kind: "rent",
		status: "active",
		stale: false,
		feedbackRevision: 0,
		strength: "strong",
		pattern: {
			patternId: "shared",
			currency: "USD",
			typicalAmount: "1800",
		},
	} as AnalysisFinding;
	it("keeps assessments separate from operational status", () => {
		expect(
			paymentLabel({
				...rent,
				judgment: {
					requestId: "r",
					status: "ready",
					decision: "unsupported",
					strength: "strong",
				},
			}),
		).toBe("Not rent");
		expect(
			paymentLabel({
				...rent,
				judgment: {
					requestId: "r",
					status: "ready",
					decision: "uncertain",
					strength: "moderate",
				},
			}),
		).toBe("Possible rent");
		expect(
			paymentLabel({
				...rent,
				judgment: { requestId: "r", status: "pending" },
			}),
		).toBe("Review pending");
	});
	it("does not merge distinct classifications of the same stream", () => {
		expect(
			groupPaymentPatterns([
				rent,
				{ ...rent, id: "mortgage", kind: "mortgage" },
			]),
		).toHaveLength(2);
	});
	it("keeps assessment status distinct from review decisions", () => {
		expect(paymentStatus(rent)).toBe("Needs review");
		expect(
			paymentStatus({
				...rent,
				review: { decision: "confirmed", provider: "acme", answeredAt: 1 },
			}),
		).toBe("Confirmed");
	});
});
