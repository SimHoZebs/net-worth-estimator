import { describe, expect, it } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { activityProjection } from "../mocks/projection.ts";
import { accountTransactions } from "./accountActivity.ts";

const { accounts, transactions, startDate } = financialModelFixture;

describe("finance-first account activity", () => {
	it("returns recorded history without a forecast", () => {
		for (const projection of [null, undefined]) {
			const rows = accountTransactions({
				accountId: "checking",
				accounts,
				transactions,
				startDate,
				projection,
			});
			expect(rows).toHaveLength(3);
			expect(rows.every((row) => row.source === "historical")).toBe(true);
		}
	});

	it("keeps recorded facts identical with or without a forecast", () => {
		const recorded = accountTransactions({
			accountId: "checking",
			accounts,
			transactions,
			startDate,
			projection: null,
		});
		const merged = accountTransactions({
			accountId: "checking",
			accounts,
			transactions,
			startDate,
			projection: activityProjection(),
		});
		expect(merged.filter((row) => row.source === "historical")).toEqual(
			recorded,
		);
	});
});
