import { describe, expect, it } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	groupPatternReviews,
	reviewAmount,
	reviewCadenceLabel,
	reviewChipLabel,
	reviewChips,
	reviewRecordedCount,
	reviewTabFor,
	reviewTitle,
} from "./patternReview.ts";

function payment(
	id: string,
	overrides: Partial<AnalysisFinding> = {},
): AnalysisFinding {
	return {
		id,
		transactionId: id,
		streamId: "stream",
		kind: "income",
		provider: "acme",
		product: "monthly",
		role: "inflow",
		strength: "strong",
		status: "active",
		stale: false,
		dismissed: false,
		runId: "run",
		feedbackRevision: 0,
		pattern: {
			patternId: "payroll",
			currency: "USD",
			typicalAmount: "2000.00",
			annualizedEstimate: "24000.00",
		},
		evidence: [{ code: "income", reason: "test", transactionIds: [id] }],
		...overrides,
	} as AnalysisFinding;
}

function recurring(id: string, transactionId: string): AnalysisFinding {
	return {
		id,
		transactionId,
		streamId: "stream",
		kind: "recurring",
		provider: "acme",
		product: "monthly",
		role: "inflow",
		strength: "moderate",
		status: "active",
		stale: false,
		dismissed: false,
		runId: "run",
		feedbackRevision: 0,
		evidence: [
			{
				code: "recurring.cadence",
				reason: "test",
				transactionIds: ["one", "two"],
			},
		],
	} as AnalysisFinding;
}

describe("pattern review grouping", () => {
	it("groups purpose and repetition of one stream into one row", () => {
		const rows = groupPatternReviews([
			payment("one"),
			payment("two"),
			recurring("rep-one", "one"),
			recurring("rep-two", "two"),
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.payments).toHaveLength(1);
		expect(rows[0]!.repetition).toHaveLength(1);
		expect(rows[0]!.tab).toBe("review");
	});
	it("keeps withdrawn evidence in a separate row", () => {
		const rows = groupPatternReviews([
			payment("one"),
			payment("old", { status: "withdrawn" }),
		]);
		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.tab)).toEqual(["review", "review"]);
	});
	it("keeps findings without a stream standalone", () => {
		const rows = groupPatternReviews([
			payment("one", { streamId: undefined }),
			payment("two", { streamId: undefined }),
		]);
		expect(rows).toHaveLength(2);
	});
	it("ignores findings outside the review queue", () => {
		expect(
			groupPatternReviews([
				payment("one", { kind: "bnpl", pattern: undefined }),
			]),
		).toHaveLength(0);
	});
	it("assigns tabs from answers only", () => {
		const confirmed = payment("one", {
			review: { decision: "confirmed", provider: "acme", answeredAt: 1 },
		});
		const rejected = payment("two", {
			review: { decision: "rejected", provider: "acme", answeredAt: 1 },
		});
		expect(reviewTabFor([confirmed, rejected])).toBe("saved");
		expect(reviewTabFor([rejected])).toBe("dismissed");
		expect(reviewTabFor([payment("three", { dismissed: true })])).toBe(
			"dismissed",
		);
		expect(reviewTabFor([payment("four")])).toBe("review");
		expect(
			reviewTabFor([payment("five", { stale: true, status: "withdrawn" })]),
		).toBe("review");
	});
});

describe("pattern review rows", () => {
	const names = new Map([
		["one", "ACME payroll"],
		["two", "ACME payroll"],
	]);
	function row() {
		return groupPatternReviews([
			payment("one"),
			payment("two"),
			recurring("rep-one", "one"),
			recurring("rep-two", "two"),
		])[0]!;
	}
	it("titles the row after the most common saved name", () => {
		expect(reviewTitle(row(), names)).toBe("ACME payroll");
		expect(reviewTitle(row(), new Map())).toBe("Acme");
	});
	it("summarizes cadence, occurrences, and the typical amount", () => {
		expect(reviewCadenceLabel(row())).toBe("Monthly");
		expect(reviewRecordedCount(row())).toBe(2);
		expect(reviewAmount(row())).toEqual({
			text: "2,000 USD typical",
			direction: "Deposit",
			inflow: true,
		});
	});
	it("reports missing repetition and skips amounts without a purpose", () => {
		const [single] = groupPatternReviews([payment("one", { product: "" })]);
		expect(reviewCadenceLabel(single!)).toBe("Repetition not established");
		const [repeating] = groupPatternReviews([recurring("rep-one", "one")]);
		expect(reviewCadenceLabel(repeating!)).toBe("Monthly");
		expect(reviewAmount(repeating!)).toBeNull();
	});
	it("chips each classification plus a repetition marker", () => {
		const chips = reviewChips(row());
		expect(chips.map((chip) => chip.label)).toEqual(["income?", "Repeating"]);
		expect(chips.map((chip) => chip.tone)).toEqual(["neutral", "neutral"]);
		const [saved] = groupPatternReviews([
			payment("one", {
				review: { decision: "confirmed", provider: "acme", answeredAt: 1 },
			}),
			recurring("rep-one", "one"),
		]);
		expect(reviewChips(saved!).map((chip) => chip.label)).toEqual([
			"income",
			"Repeating",
		]);
	});
	it("words chips with the existing finding states", () => {
		expect(reviewChipLabel(payment("one"))).toBe("income?");
		expect(
			reviewChipLabel(
				payment("one", {
					review: { decision: "confirmed", provider: "acme", answeredAt: 1 },
				}),
			),
		).toBe("income");
		expect(
			reviewChipLabel(
				payment("one", {
					review: { decision: "rejected", provider: "acme", answeredAt: 1 },
				}),
			),
		).toBe("Not income");
		expect(reviewChipLabel(payment("one", { dismissed: true }))).toBe(
			"Dismissed",
		);
		expect(reviewChipLabel(payment("one", { status: "withdrawn" }))).toBe(
			"Withdrawn",
		);
		expect(reviewChipLabel(payment("one", { stale: true }))).toBe(
			"Awaiting analysis",
		);
		expect(
			reviewChipLabel(
				payment("one", { judgment: { requestId: "r", status: "pending" } }),
			),
		).toBe("Review pending");
	});
});
