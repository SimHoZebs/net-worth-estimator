import { describe, expect, it } from "vitest";
import type { SafeSpendingTrend } from "@/domain/safeSpendingTrend.ts";
import { paceLabel, spendingChartDomain } from "./SafeSpendingTrendChart.tsx";

describe("current spending pace after refunds", () => {
	const cleared: SafeSpendingTrend = {
		actual: [
			{ date: "2026-11-08", spent: 60, projected: false },
			{ date: "2026-11-09", spent: 10, projected: false },
		],
		projected: [],
		limit: 50,
		safetyNet: 30,
		averageDaily: 5,
		limitHit: {
			date: "2026-11-08",
			amount: 60,
			projected: false,
			transactionId: "purchase",
		},
		safetyNetHit: {
			date: "2026-11-08",
			amount: 60,
			projected: false,
			transactionId: "purchase",
		},
	};
	it("pads negative net spending from a refund without clipping the recorded curve", () => {
		const refundOnly = {
			...cleared,
			actual: [{ date: "2026-11-09", spent: -100, projected: false }],
			limitHit: null,
			safetyNetHit: null,
		};
		expect(spendingChartDomain(refundOnly)).toEqual([-108, 54]);
		const [low] = spendingChartDomain({
			...refundOnly,
			projected: [{ date: "2026-11-10", spent: -120, projected: true }],
			limit: -200,
		});
		expect(low).toBe(-216);
	});
	it("keeps the baseline at zero for positive-only spending", () => {
		const [low, high] = spendingChartDomain(cleared);
		expect(low).toBe(0);
		expect(high).toBeCloseTo(64.8);
	});
	it("keeps historical crossing identities without showing cleared cash or reserve warnings", () => {
		expect(paceLabel(cleared, false)).toEqual({ text: null, tone: "normal" });
		expect(cleared.limitHit?.transactionId).toBe("purchase");
	});
	it("warns about a genuine future crossing after an earlier cleared crossing", () => {
		const trend = {
			...cleared,
			projected: [
				{ date: "2026-11-09", spent: 10, projected: true },
				{ date: "2026-11-19", spent: 60, projected: true },
			],
		};
		expect(paceLabel(trend, false)).toEqual({
			text: "Cash limit ~ Nov 19",
			tone: "danger",
		});
	});
});
