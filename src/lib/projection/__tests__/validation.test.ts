import { describe, expect, it } from "vitest";
import { createBaseDocument } from "../__fixtures__/documents";
import { validateCsvFinancialModel } from "../sources/csv/csvValidation";
import { validateFinancialModel } from "../validation/validateFinancialModel";

describe("financial model validation adapters", () => {
	it("keeps domain paths separate from CSV diagnostic paths", () => {
		const document = createBaseDocument();
		document.postings[0]!.sourceAccountId = "missing";

		const genericIssue = validateFinancialModel(document).find(
			(issue) => issue.code === "posting.source.missing",
		);
		const csvIssue = validateCsvFinancialModel(document).find(
			(issue) => issue.code === "posting.source.missing",
		);

		expect(genericIssue?.path).toEqual(["postings", 0, "sourceAccountId"]);
		expect(csvIssue?.path).toEqual(["postings.csv", 2, "sourceAccountId"]);
	});

	it("preserves dependency cycle validation in the generic validator", () => {
		const document = createBaseDocument({
			postings: [
				{
					...createBaseDocument().postings[0]!,
					id: "a",
					amount: {
						resolver: "expression",
						config: { expression: "b" },
						inputs: {
							b: {
								source: "provider",
								provider: "model-value",
								arguments: { id: "b" },
							},
						},
					},
				},
				{
					...createBaseDocument().postings[0]!,
					id: "b",
					amount: {
						resolver: "expression",
						config: { expression: "a" },
						inputs: {
							a: {
								source: "provider",
								provider: "model-value",
								arguments: { id: "a" },
							},
						},
					},
				},
			],
		});

		const issue = validateFinancialModel(document).find(
			(candidate) => candidate.code === "posting.amount.circular",
		);
		expect(issue?.path).toEqual(["postings", 0, "amount"]);
	});
});
