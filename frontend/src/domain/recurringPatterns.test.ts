import { describe, expect, it } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	cadenceLabel,
	directionLabel,
	frequencyLabel,
	groupRecurringPatterns,
	patternTitle,
	recurringPatternStatus,
} from "./recurringPatterns.ts";

function recurringFinding(
	id: string,
	transactionId: string,
	product = "monthly",
	review?: AnalysisFinding["review"],
): AnalysisFinding {
	return {
		id,
		transactionId,
		kind: "recurring",
		provider: "grocer",
		product,
		role: "outflow",
		strength: "moderate",
		status: "active",
		stale: false,
		dismissed: false,
		evidence: [
			{ code: "recurring.cadence", reason: "test", transactionIds: ["a", "b"] },
		],
		review,
	} as AnalysisFinding;
}

describe("repeating-payment patterns", () => {
	it("groups occurrences by their recorded set", () => {
		const first = recurringFinding("one", "a");
		const second = recurringFinding("two", "b");
		const other = {
			...recurringFinding("three", "c"),
			evidence: [
				{ code: "recurring.cadence", reason: "test", transactionIds: ["c"] },
			],
		};
		const unrelated = { ...first, id: "four", kind: "bnpl" };
		const patterns = groupRecurringPatterns([first, other, second, unrelated]);
		expect(patterns).toHaveLength(2);
		expect(patterns[0]!.findings.map((finding) => finding.id)).toEqual([
			"one",
			"two",
		]);
		expect(patterns[0]!.anchor.id).toBe("one");
		expect(patterns[1]!.findings.map((finding) => finding.id)).toEqual([
			"three",
		]);
	});
	it("prefers the confirmed occurrence for approval", () => {
		const patterns = groupRecurringPatterns([
			recurringFinding("one", "a"),
			recurringFinding("two", "b", "monthly", {
				decision: "confirmed",
				provider: "grocer",
				answeredAt: 1,
			}),
		]);
		expect(patterns).toHaveLength(1);
		expect(patterns[0]!.confirmed?.id).toBe("two");
		expect(recurringPatternStatus(patterns[0]!)).toBe("Confirmed");
	});
	it("names the pattern after its recorded transactions", () => {
		const names = new Map([
			["a", "Grocer"],
			["b", "Grocer"],
		]);
		const patterns = groupRecurringPatterns([
			recurringFinding("one", "a"),
			recurringFinding("two", "b"),
		]);
		expect(patternTitle(patterns[0]!, names)).toBe("Grocer");
		expect(patternTitle(patterns[0]!, new Map())).toBe("Grocer");
	});
	it("keeps review states distinct from provider labels", () => {
		const [needsReview] = groupRecurringPatterns([
			recurringFinding("one", "a"),
		]);
		expect(recurringPatternStatus(needsReview!)).toBe("Needs review");
		const rejected = {
			...recurringFinding("one", "a"),
			review: { decision: "rejected", provider: "grocer", answeredAt: 1 },
		};
		const [notRepeating] = groupRecurringPatterns([rejected]);
		expect(recurringPatternStatus(notRepeating!)).toBe("Not repeating");
	});
	it("words cadences without schedule jargon", () => {
		expect(cadenceLabel("monthly")).toBe("Monthly");
		expect(cadenceLabel("biweekly")).toBe("Every 2 weeks");
		expect(directionLabel("outflow")).toBe("Payment");
		expect(directionLabel("inflow")).toBe("Deposit");
		expect(frequencyLabel("quarterly")).toBe("Every 3 months");
	});
});
