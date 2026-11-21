import { describe, expect, it } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	activeBNPLFinding,
	findingLabel,
	findingStatus,
} from "./analysisFindings.ts";

const finding = {
	id: "one",
	transactionId: "transaction",
	kind: "bnpl",
	strength: "strong",
	status: "active",
	stale: false,
	dismissed: false,
} as AnalysisFinding;

describe("BNPL transaction flags", () => {
	it("uses only current active findings for the exact transaction", () => {
		expect(activeBNPLFinding([finding], "transaction")).toBe(finding);
		for (const change of [
			{ stale: true },
			{ dismissed: true },
			{ status: "withdrawn" },
			{ kind: "provider" },
			{ transactionId: "other" },
		]) {
			expect(
				activeBNPLFinding([{ ...finding, ...change }], "transaction"),
			).toBeUndefined();
		}
	});
	it("keeps certainty explicit", () => {
		expect(findingLabel(finding)).toBe("Likely BNPL");
		expect(findingLabel({ strength: "moderate" })).toBe("Possible BNPL");
	});
	it("reads Not BNPL in both columns for a rejected strong finding", () => {
		const rejected = {
			...finding,
			review: { decision: "rejected", provider: "klarna", answeredAt: 2 },
		};
		expect(findingLabel(rejected)).toBe("Not BNPL");
		expect(findingStatus(rejected)).toBe("Not BNPL");
	});
	it("uses the shared judgment wording for the finding column", () => {
		const unsupported = {
			...finding,
			judgment: {
				requestId: "r",
				status: "ready",
				decision: "unsupported",
				strength: "strong",
			},
		} as AnalysisFinding;
		expect(findingLabel(unsupported)).toBe("Not BNPL");
	});
	it("keeps confirmed labels through stale inputs and withdrawn inference", () => {
		const confirmed = {
			...finding,
			stale: true,
			status: "withdrawn",
			review: { decision: "confirmed", provider: "klarna", answeredAt: 1 },
		};
		expect(activeBNPLFinding([confirmed], "transaction")).toBe(confirmed);
		expect(findingLabel(confirmed)).toBe("BNPL");
		expect(findingStatus(confirmed)).toBe("Confirmed");
		for (const change of [
			{ dismissed: true },
			{ review: { ...confirmed.review, decision: "rejected" } },
		])
			expect(
				activeBNPLFinding([{ ...confirmed, ...change }], "transaction"),
			).toBeUndefined();
		expect(
			findingStatus({
				...confirmed,
				review: { ...confirmed.review, decision: "rejected" },
			}),
		).toBe("Not BNPL");
	});
});
