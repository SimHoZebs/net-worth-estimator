import { describe, expect, it } from "vitest";
import { transactionFixture } from "@/mocks/projection.ts";
import { recurringBillIncreases } from "./recurringBillIncreases.ts";

const bill = (
	date: string,
	requested: number,
	overrides: Parameters<typeof transactionFixture>[0] = {},
) => transactionFixture({ date, requested, name: "bill", ...overrides });

describe("recurringBillIncreases", () => {
	it("groups unposted bill occurrences by date and sums cents", () => {
		const increases = recurringBillIncreases({
			bills: [
				bill("2026-11-20", 10, { name: "alpha" }),
				bill("2026-11-20", 15.005, { name: "beta" }),
				bill("2026-11-21", 25, { name: "gamma" }),
			],
		});
		expect(increases).toEqual([
			{ date: "2026-11-20", amount: 25.01, name: "alpha, beta" },
			{ date: "2026-11-21", amount: 25, name: "gamma" },
		]);
	});

	it("keeps distinct names once per day", () => {
		const increases = recurringBillIncreases({
			bills: [
				bill("2026-11-20", 10, { name: "alpha" }),
				bill("2026-11-20", 5, { name: "alpha" }),
			],
		});
		expect(increases).toEqual([
			{ date: "2026-11-20", amount: 15, name: "alpha" },
		]);
	});

	it("leaves out posted occurrences already in actual spending", () => {
		const increases = recurringBillIncreases({
			bills: [bill("2026-11-20", 25, { posted: true }), bill("2026-11-21", 30)],
		});
		expect(increases).toEqual([
			{ date: "2026-11-21", amount: 30, name: "bill" },
		]);
	});

	it("ignores rows with no spendable amount", () => {
		const increases = recurringBillIncreases({
			bills: [
				bill("2026-11-20", 0),
				bill("2026-11-21", -5),
				bill("2026-11-22", Number.NaN),
			],
		});
		expect(increases).toEqual([]);
	});
});
