import { describe, expect, it } from "vitest";
import type { PostingObservation } from "../postingObservations";
import { transactionClassificationAnalysis } from "./transactionClassification";

function posting(
	id: string,
	changes: Partial<PostingObservation> = {},
): PostingObservation {
	return {
		id,
		postingId: id,
		accountId: "checking",
		bookedDate: "2026-01-01",
		amount: 2000,
		currency: "USD",
		description: "ACME PAYROLL",
		counterpartyName: null,
		...changes,
	};
}

describe("posting classification analysis", () => {
	it("classifies payroll labels and exposes normalized payer identity", async () => {
		const result = await transactionClassificationAnalysis.run({
			input: { postings: [posting("payroll")] },
		});
		const classified = result.value.transactions[0]!.classification;
		expect(classified).toMatchObject({
			type: "payroll",
			payerIdentity: "acme",
			payerLabel: "acme",
		});
		expect(classified.evidence.map(({ code }) => code)).toEqual([
			"payer.identity",
			"payroll.language",
		]);
	});

	it("leaves non-payroll posting labels unknown", async () => {
		const result = await transactionClassificationAnalysis.run({
			input: {
				postings: [posting("transfer", { description: "Account transfer" })],
			},
		});
		expect(result.value.transactions[0]!.classification.type).toBe("unknown");
	});

	it("recognizes an Amazon payroll descriptor with ACH boilerplate", async () => {
		const result = await transactionClassificationAnalysis.run({
			input: {
				postings: [
					posting("amazon", {
						description: "AMAZON DEVELOPME PAYROLL PPD ID: 9111111103",
						counterpartyName: "ACH credit",
					}),
				],
			},
		});
		expect(result.value.transactions[0]!.classification).toMatchObject({
			type: "payroll",
			paymentRail: "ach",
			payerIdentity: "amazon developme",
		});
	});

	it("does not infer payroll from a debit or an uninformative description", async () => {
		const result = await transactionClassificationAnalysis.run({
			input: {
				postings: [
					posting("debit", {
						amount: -2000,
						description: "ACME PAYROLL",
					}),
					posting("unknown", {
						description: "CARD CREDIT",
						counterpartyName: "---",
					}),
				],
			},
		});
		expect(
			result.value.transactions.map(
				({ classification }) => classification.type,
			),
		).toEqual(["unknown", "unknown"]);
	});
});
