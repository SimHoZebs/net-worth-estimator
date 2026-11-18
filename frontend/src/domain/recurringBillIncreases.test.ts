import { describe, expect, it } from "vitest";
import type { Transaction } from "./model.ts";
import { transactionFixture } from "@/mocks/projection.ts";
import {
	recurringBillIncreases,
	recurringBillMarkers,
} from "./recurringBillIncreases.ts";

const bill = (
	date: string,
	requested: number,
	overrides: Parameters<typeof transactionFixture>[0] = {},
) => transactionFixture({ date, requested, name: "bill", ...overrides });

const claim = (
	id: string,
	scheduleId: string,
	occurrenceDate: string,
): Transaction => ({
	id,
	name: "paid",
	amount: 25,
	amountKnown: true,
	fromId: "checking",
	toId: null,
	kind: "transaction",
	startDate: occurrenceDate,
	endDate: null,
	annualIncrease: 0,
	enabled: true,
	readOnly: false,
	claimScheduleId: scheduleId,
	claimOccurrenceDate: occurrenceDate,
	postedDate: null,
	pending: false,
	void: false,
	syncOwned: true,
	category: null,
	categorySource: null,
	transactionTime: null,
});

describe("recurringBillIncreases", () => {
	it("groups bill occurrences by date and sums cents", () => {
		const increases = recurringBillIncreases({
			transactions: [],
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
			transactions: [],
			bills: [
				bill("2026-11-20", 10, { name: "alpha" }),
				bill("2026-11-20", 5, { name: "alpha" }),
			],
		});
		expect(increases).toEqual([
			{ date: "2026-11-20", amount: 15, name: "alpha" },
		]);
	});

	it("leaves out occurrences a recorded transaction claims", () => {
		const bills = [
			bill("2026-11-20", 25, { transactionId: "rent" }),
			bill("2026-11-21", 30, { transactionId: "utilities" }),
		];
		const increases = recurringBillIncreases({
			transactions: [claim("paid-1", "rent", "2026-11-20")],
			bills,
		});
		expect(increases).toEqual([
			{ date: "2026-11-21", amount: 30, name: "bill" },
		]);
		// Markers keep the occurred bill so its dot survives on the chart.
		expect(recurringBillMarkers(bills)).toEqual([
			{ date: "2026-11-20", amount: 25, name: "bill" },
			{ date: "2026-11-21", amount: 30, name: "bill" },
		]);
	});

	it("keeps a bill claimed by a void or pending transaction", () => {
		const voidClaim = {
			...claim("void-claim", "rent", "2026-11-20"),
			void: true,
		};
		const pendingClaim = {
			...claim("pending-claim", "utilities", "2026-11-21"),
			pending: true,
		};
		const increases = recurringBillIncreases({
			transactions: [voidClaim, pendingClaim],
			bills: [
				bill("2026-11-20", 25, { transactionId: "rent" }),
				bill("2026-11-21", 30, { transactionId: "utilities" }),
			],
		});
		expect(increases).toHaveLength(2);
	});

	it("ignores rows with no spendable amount", () => {
		const increases = recurringBillIncreases({
			transactions: [],
			bills: [
				bill("2026-11-20", 0),
				bill("2026-11-21", -5),
				bill("2026-11-22", Number.NaN),
			],
		});
		expect(increases).toEqual([]);
	});
});
