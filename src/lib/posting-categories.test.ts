import { describe, expect, it } from "vitest";
import { makeAccount } from "@/lib/projection/__fixtures__/accounts";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import {
	associatedAccountIds,
	isPastScheduledPosting,
	partitionPostings,
} from "./posting-categories";

describe("posting presentation categories", () => {
	it("separates history, direct cash-flow transactions, and account rules", () => {
		const history = makePosting({ id: "opening", frequency: "once" });
		const salary = makePosting({
			id: "salary",
			destinations: ["checking"],
			arithmetic: "1000",
		});
		const taxes = makePosting({
			id: "taxes",
			sourceAccountId: "checking",
			arithmetic: "salary * 0.2",
		});
		const match = makePosting({
			id: "match",
			destinations: ["k401"],
			arithmetic: "employee_contribution * 0.5",
		});
		const groups = partitionPostings([history, salary, taxes, match]);

		expect(groups.transactionHistory.map((posting) => posting.id)).toEqual([
			"opening",
		]);
		expect(groups.scheduledTransactions.map((posting) => posting.id)).toEqual([
			"salary",
			"taxes",
		]);
		expect(groups.accountRules.map((posting) => posting.id)).toEqual(["match"]);
	});

	it("associates a rule with source, destination, and referenced accounts", () => {
		const accounts = ["source", "destination", "reference"].map((id) =>
			makeAccount({ id }),
		);
		const posting = makePosting({
			id: "rule",
			sourceAccountId: "source",
			destinations: ["destination"],
			arithmetic: "abs(reference) * rate",
		});

		expect(
			associatedAccountIds(posting, new Set(accounts.map(({ id }) => id))),
		).toEqual(["source", "destination", "reference"]);
	});

	it("does not treat reserved arithmetic tokens as account references", () => {
		const accounts = ["brokerage", "rate", "abs"].map((id) =>
			makeAccount({ id }),
		);
		const posting = makePosting({
			id: "growth",
			arithmetic: "abs(brokerage) * rate",
		});
		expect(
			associatedAccountIds(posting, new Set(accounts.map(({ id }) => id))),
		).toEqual(["brokerage"]);
	});

	it("treats only postings ending before the projection as past", () => {
		const projectionStartDate = "2026-02-01";
		expect(
			isPastScheduledPosting(
				makePosting({ id: "ended", endDate: "2026-01-31" }),
				projectionStartDate,
			),
		).toBe(true);
		expect(
			isPastScheduledPosting(
				makePosting({ id: "boundary", endDate: projectionStartDate }),
				projectionStartDate,
			),
		).toBe(false);
		expect(
			isPastScheduledPosting(
				makePosting({ id: "ongoing", endDate: null }),
				projectionStartDate,
			),
		).toBe(false);
	});
});
