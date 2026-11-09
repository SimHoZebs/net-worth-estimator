import { describe, expect, it } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	isMainIncome,
	paymentLabel as incomeLabel,
	paymentStatus as incomeStatus,
	groupPaymentPatterns,
	paymentAmount as incomeAmount,
} from "./paymentFindings.ts";

const finding = {
	id: "one",
	transactionId: "transaction",
	kind: "income",
	strength: "strong",
	status: "active",
	stale: false,
	dismissed: false,
	feedbackRevision: 0,
	pattern: {
		patternId: "checking-payroll",
		currency: "USD",
		typicalAmount: "2000.00",
		annualizedEstimate: "52000.00",
	},
	evidence: [{ code: "income.main-inflow:annualized", reason: "annualized" }],
} as AnalysisFinding;

describe("income findings", () => {
	it("shows an asynchronous judgment without assuming a model or blocking user answers", () => {
		const pending = {
			...finding,
			judgment: { requestId: "request", status: "pending" as const },
		};
		expect(incomeLabel(pending)).toBe("Review pending");
		expect(incomeStatus(pending)).toBe("Review pending");
		expect(
			incomeLabel({
				...pending,
				review: { decision: "confirmed", provider: "acme", answeredAt: 1 },
			}),
		).toBe("Confirmed income");
	});
	it("groups occurrences without merging accounts or withdrawn evidence", () => {
		const second = {
			...finding,
			id: "two",
			transactionId: "second",
			feedbackRevision: 1,
			review: { decision: "confirmed", provider: "acme", answeredAt: 2 },
		};
		const otherAccount = {
			...finding,
			id: "other",
			pattern: { ...finding.pattern!, patternId: "savings-payroll" },
		};
		const withdrawn = { ...finding, id: "old", status: "withdrawn" };
		const groups = groupPaymentPatterns([
			finding,
			second,
			otherAccount,
			withdrawn,
		]);
		expect(groups).toHaveLength(3);
		const shared = groups.find((group) => group.findings.length === 2)!;
		expect(shared.anchor.id).toBe("two");
		expect(shared.findings.map((item) => item.id)).toEqual(["two", "one"]);
	});
	it("formats the actual source amounts without dollar or training-scale assumptions", () => {
		expect(incomeAmount("25000.50", "EUR")).toBe("25,000.5 EUR");
		expect(incomeAmount("650000.00", "USD")).toBe("650,000 USD");
	});
	it("marks the main inflow", () => {
		expect(isMainIncome(finding)).toBe(true);
		expect(incomeLabel(finding)).toBe("Main income");
	});
	it("keeps confirmed explicit", () => {
		const confirmed = {
			...finding,
			review: { decision: "confirmed", provider: "acme", answeredAt: 1 },
		} as AnalysisFinding;
		expect(incomeLabel(confirmed)).toBe("Confirmed income");
		expect(incomeStatus(confirmed)).toBe("Confirmed");
	});
	it("distinguishes not income", () => {
		const rejected = {
			...finding,
			review: { decision: "rejected", provider: "acme", answeredAt: 1 },
		} as AnalysisFinding;
		expect(incomeStatus(rejected)).toBe("Not income");
		expect(incomeLabel(rejected)).toBe("Not income");
	});
	it("keeps withdrawal visible alongside a saved answer", () => {
		const withdrawn = {
			...finding,
			status: "withdrawn",
			review: { decision: "confirmed", provider: "acme", answeredAt: 1 },
		};
		expect(incomeLabel(withdrawn)).toBe("Confirmed income");
		expect(incomeStatus(withdrawn)).toBe("Withdrawn");
	});
});
