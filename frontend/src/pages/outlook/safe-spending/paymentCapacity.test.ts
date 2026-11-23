import { describe, expect, it } from "vitest";
import type { SafeSpendingSummary } from "@/api/generated/model/safeSpendingSummary.ts";
import { capacityText, paymentCapacity } from "./paymentCapacity.ts";
import { summaryFixture } from "@/mocks/safeSpendingSummary.ts";

const summary = (
	overrides: Partial<SafeSpendingSummary> = {},
): SafeSpendingSummary =>
	summaryFixture({
		checkingAvailable: 301.11,
		expectedPay: 400,
		prePaydayBills: 91.08,
		paydayBills: 0,
		statementReserve: null,
		cardPayoffCapacity: 610.03,
		prePaydayRoom: 210.03,
		postIncomeRoom: null,
		paymentRoom: null,
		...overrides,
	});

describe("payment capacity fallback", () => {
	it("keeps the known before-card amount when the payment room is unknown", () => {
		const fallback = paymentCapacity(summary());
		expect(fallback).toEqual({ magnitude: 610.03, short: false });
		expect(capacityText(fallback!)).toBe("$610.03 for card payoffs");
	});

	it("reads a negative capacity as short before cards", () => {
		const fallback = paymentCapacity(summary({ cardPayoffCapacity: -50 }));
		expect(fallback).toEqual({ magnitude: 50, short: true });
		expect(capacityText(fallback!)).toBe("$50.00 short before cards");
	});

	it("leads with the definite pre-payday gap over a positive capacity", () => {
		const fallback = paymentCapacity(
			summary({ cardPayoffCapacity: 200, prePaydayRoom: -150 }),
		);
		expect(fallback).toEqual({ magnitude: 150, short: true });
	});

	it("never replaces a known payment room", () => {
		expect(paymentCapacity(summary({ paymentRoom: 20 }))).toBeNull();
	});

	it("stays unknown when neither room nor capacity is known", () => {
		expect(paymentCapacity(summary({ cardPayoffCapacity: null }))).toBeNull();
	});
});
