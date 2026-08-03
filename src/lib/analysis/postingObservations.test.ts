import { describe, expect, it } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { buildPostingObservationDataset } from "./postingObservations";

describe("posting observations", () => {
	it("derives observations from once external inflows only", () => {
		const document = createBaseDocument({
			postings: [
				makePosting({
					id: "history",
					label: "Amazon Payroll",
					destinations: ["checking"],
					arithmetic: "7579.38",
					frequency: "once",
					startDate: "2026-07-31",
				}),
				makePosting({
					id: "recurring-salary",
					label: "Salary",
					destinations: ["checking"],
					arithmetic: "10000",
					frequency: "monthly",
				}),
				makePosting({
					id: "outflow",
					label: "Outflow",
					sourceAccountId: "checking",
					arithmetic: "100",
					frequency: "once",
				}),
			],
		});
		const result = buildPostingObservationDataset(document);
		expect(result.postings).toHaveLength(1);
		expect(result.postings[0]).toMatchObject({
			id: "history",
			postingId: "history",
			amount: 7579.38,
			accountId: "checking",
		});
	});
});
