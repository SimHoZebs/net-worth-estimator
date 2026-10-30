import { describe, expect, it } from "vitest";
import { combineDayTime, timeOfDay, postingBody } from "./transactionBodies.ts";

describe("timestamped actual authoring", () => {
	it("formats and combines UTC instants without losing seconds", () => {
		expect(timeOfDay(1773140400)).toBe("11:00");
		expect(timeOfDay(1773140417)).toBe("11:00:17");
		expect(timeOfDay(null)).toBe("");
		expect(combineDayTime("2026-03-10", "11:00")).toBe(1773140400);
		expect(combineDayTime("2026-03-10", "11:00:17")).toBe(1773140417);
		expect(combineDayTime("2026-03-10", "")).toBe(1773100800);
	});
	it("writes an explicit intraday time through the row body", () => {
		const body = postingBody({
			name: "Expense",
			amount: 100,
			annualIncrease: 0,
			fromId: "checking",
			toId: null,
			frequency: "once",
			startDate: "2026-03-10",
			endDate: null,
			postedDate: null,
			enabled: true,
			claimRuleId: null,
			claimOccurrenceDate: null,
			transactionTime: 1773140400,
		});
		expect(body.transactionTime).toBe(1773140400);
	});
});
