import { describe, expect, it } from "vitest";
import { classifyPosting, classifyPostings } from "./classification";
import {
	classifyPayer,
	classifyPaymentRail,
	classifyPayrollLanguage,
	detectPaymentRail,
} from "./postingClassifiers";
import type { PostingObservation } from "./postingObservations";

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

describe("posting classification", () => {
	it("extracts a normalized payer identity", () => {
		expect(
			classifyPayer(
				posting("amazon", {
					description: "AMAZON DEVELOPME PAYROLL PPD ID: 9111111103",
					counterpartyName: "ACH credit",
				}),
			).value,
		).toEqual({
			identity: "amazon developme",
			label: "amazon developme",
		});
	});

	it("detects payroll language only on positive informative inflows", () => {
		expect(classifyPayrollLanguage(posting("pay"))).toHaveLength(1);
		expect(
			classifyPayrollLanguage(posting("debit", { amount: -2000 })),
		).toEqual([]);
		expect(
			classifyPayrollLanguage(posting("unresolved", { amount: null })),
		).toEqual([]);
		expect(
			classifyPayrollLanguage(
				posting("unknown", {
					description: "CARD CREDIT",
					counterpartyName: "---",
				}),
			),
		).toEqual([]);
	});

	it("detects the payment rail", () => {
		expect(detectPaymentRail("ACH credit DIRECT DEPOSIT")).toBe("ach");
		expect(detectPaymentRail("CARD CREDIT")).toBe("card");
		expect(detectPaymentRail("pleasant transfer")).toBe("unknown");
		expect(
			classifyPaymentRail(
				posting("rail", {
					description: "AMAZON DEVELOPME PAYROLL PPD ID: 9111111103",
					counterpartyName: "ACH credit",
				}),
			).value,
		).toBe("ach");
	});

	it("combines payer, payroll-language, and rail evidence in order", () => {
		const classified = classifyPosting(
			posting("amazon", {
				description: "AMAZON DEVELOPME PAYROLL PPD ID: 9111111103",
				counterpartyName: "ACH credit",
			}),
		);

		expect(classified.payer).toEqual({
			identity: "amazon developme",
			label: "amazon developme",
		});
		expect(classified.hasPayrollLanguage).toBe(true);
		expect(classified.paymentRail).toBe("ach");
		expect(classified.evidence.map(({ code }) => code)).toEqual([
			"payer.identity",
			"payroll.language",
			"payment-rail.ach",
		]);
	});

	it("classifies every observation in a dataset", () => {
		const dataset = classifyPostings({
			postings: [posting("one"), posting("two", { amount: -5 })],
		});

		expect(dataset.postings).toHaveLength(2);
		expect(dataset.postings[0]?.hasPayrollLanguage).toBe(true);
		expect(dataset.postings[1]?.hasPayrollLanguage).toBe(false);
	});
});
