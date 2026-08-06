import { describe, expect, it } from "vitest";
import {
	createPostingClassificationAnalysis,
	createPostingClassificationPlan,
} from "@/lib/analysis";
import type { PostingObservation } from "../postingObservations";
import { payrollDetectionAnalysis } from "./payrollDetection";

const classificationAnalysis = createPostingClassificationAnalysis(
	createPostingClassificationPlan(
		payrollDetectionAnalysis.classificationRequirements,
	),
);

function posting(
	id: string,
	bookedDate: string,
	changes: Partial<PostingObservation> = {},
): PostingObservation {
	return {
		id,
		postingId: id,
		accountId: "checking",
		bookedDate,
		amount: 2000,
		currency: "USD",
		description: "ACME DIRECT DEPOSIT PAYROLL",
		counterpartyName: "Acme Inc",
		...changes,
	};
}

async function detectPayroll(input: { postings: PostingObservation[] }) {
	const classified = await classificationAnalysis.run({ input });
	return payrollDetectionAnalysis.run({ input: classified.value });
}

describe("payroll detection analysis", () => {
	it("detects recurring payroll-language deposits", async () => {
		const result = await detectPayroll({
			postings: [
				posting("p1", "2026-01-02"),
				posting("p2", "2026-01-16"),
				posting("p3", "2026-01-30"),
			],
		});
		expect(result.value.candidates).toHaveLength(1);
		expect(result.value.candidates[0]).toMatchObject({
			accountId: "checking",
			recurring: true,
			identityEvidence: { strength: "moderate" },
			regularityEvidence: { strength: "moderate" },
		});
	});

	it("uses payroll labels and excludes non-payroll posting labels", async () => {
		const result = await detectPayroll({
			postings: [
				posting("pay-1", "2026-01-02"),
				posting("pay-2", "2026-01-16"),
				posting("pay-3", "2026-01-30"),
				posting("transfer", "2026-01-16", {
					description: "Account transfer",
					counterpartyName: null,
				}),
			],
		});
		expect(
			result.value.candidates[0]?.transactions.map(({ id }) => id),
		).toEqual(["pay-1", "pay-2", "pay-3"]);
	});

	it("keeps identical payer names separated by account", async () => {
		const result = await detectPayroll({
			postings: [
				posting("a1", "2026-01-02"),
				posting("a2", "2026-01-16"),
				posting("a3", "2026-01-30"),
				posting("b1", "2026-01-03", { accountId: "savings" }),
				posting("b2", "2026-01-17", { accountId: "savings" }),
				posting("b3", "2026-01-31", { accountId: "savings" }),
			],
		});
		expect(
			result.value.candidates.map(({ accountId }) => accountId).sort(),
		).toEqual(["checking", "savings"]);
	});

	it("does not merge employers behind a generic counterparty label", async () => {
		const result = await detectPayroll({
			postings: [
				posting("acme-1", "2026-01-02", {
					counterpartyName: "DIRECT DEPOSITS",
					description: "DIRECT DEPOSITS ACME",
				}),
				posting("acme-2", "2026-01-16", {
					counterpartyName: "DIRECT DEPOSITS",
					description: "DIRECT DEPOSITS ACME",
				}),
				posting("acme-3", "2026-01-30", {
					counterpartyName: "DIRECT DEPOSITS",
					description: "DIRECT DEPOSITS ACME",
				}),
				posting("globex-1", "2026-01-03", {
					counterpartyName: "DIRECT DEPOSITS",
					description: "DIRECT DEPOSITS GLOBEX",
				}),
				posting("globex-2", "2026-01-17", {
					counterpartyName: "DIRECT DEPOSITS",
					description: "DIRECT DEPOSITS GLOBEX",
				}),
				posting("globex-3", "2026-01-31", {
					counterpartyName: "DIRECT DEPOSITS",
					description: "DIRECT DEPOSITS GLOBEX",
				}),
			],
		});
		expect(result.value.candidates).toHaveLength(2);
		expect(
			result.value.candidates.map(({ payerLabel }) => payerLabel).sort(),
		).toEqual(["acme", "globex"]);
	});

	it("does not merge identity-less payroll postings", async () => {
		const result = await detectPayroll({
			postings: [
				posting("unknown-1", "2026-01-02", {
					counterpartyName: "PAYROLL",
					description: "PAYROLL",
				}),
				posting("unknown-2", "2026-01-16", {
					counterpartyName: "PAYROLL",
					description: "PAYROLL",
				}),
				posting("unknown-3", "2026-01-30", {
					counterpartyName: "PAYROLL",
					description: "PAYROLL",
				}),
			],
		});
		expect(result.value.candidates).toHaveLength(0);
	});

	it("does not create an identity from punctuation-only payer text", async () => {
		const result = await detectPayroll({
			postings: [
				posting("punctuation-1", "2026-01-02", {
					counterpartyName: "---",
					description: "PAYROLL",
				}),
				posting("punctuation-2", "2026-01-16", {
					counterpartyName: "---",
					description: "PAYROLL",
				}),
				posting("punctuation-3", "2026-01-30", {
					counterpartyName: "---",
					description: "PAYROLL",
				}),
			],
		});
		expect(result.value.candidates).toHaveLength(0);
	});

	it("marks cadence-breaking gaps and duplicate dates as non-recurring", async () => {
		const result = await detectPayroll({
			postings: [
				posting("p1", "2026-01-02"),
				posting("p2", "2026-01-16"),
				posting("p3", "2026-01-30"),
				posting("p4", "2026-02-13"),
				posting("p5", "2026-03-13"),
			],
		});
		expect(result.value.candidates).toHaveLength(1);
		expect(result.value.candidates[0]?.recurring).toBe(false);

		const duplicateDateResult = await detectPayroll({
			postings: [
				posting("d1", "2026-01-02"),
				posting("d2", "2026-01-02"),
				posting("d3", "2026-01-16"),
				posting("d4", "2026-01-30"),
			],
		});
		expect(duplicateDateResult.value.candidates).toHaveLength(1);
		expect(duplicateDateResult.value.candidates[0]?.recurring).toBe(false);
	});
});
