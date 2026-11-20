import { describe, expect, it } from "vitest";
import {
	resolveEffectiveIds,
	sanitizeSafeSpendingSettings,
} from "./useSafeSpendingSettings.ts";

describe("sanitizeSafeSpendingSettings", () => {
	it("uses the monthly budget defaults when calendar days or the target are invalid", () => {
		expect(
			sanitizeSafeSpendingSettings({
				cycleStartDay: 0,
				paydayDay: 30.5,
				savingsTarget: -1,
			}),
		).toMatchObject({ cycleStartDay: 20, paydayDay: 30, savingsTarget: 0 });
	});

	it("keeps valid monthly budget settings", () => {
		expect(
			sanitizeSafeSpendingSettings({
				cycleStartDay: 1,
				paydayDay: 31,
				savingsTarget: 500.25,
			}),
		).toMatchObject({ cycleStartDay: 1, paydayDay: 31, savingsTarget: 500.25 });
	});

	it("keeps an explicit empty income-schedule selection", () => {
		expect(
			sanitizeSafeSpendingSettings({ incomeScheduleIds: [] }),
		).toMatchObject({ incomeScheduleIds: [] });
	});

	it("deduplicates income schedules and keeps the raw stored selections", () => {
		expect(
			sanitizeSafeSpendingSettings({
				spendingAccountIds: ["checking", "gone"],
				incomeScheduleIds: ["salary", "salary", "bonus"],
			}),
		).toMatchObject({
			spendingAccountIds: ["checking", "gone"],
			incomeScheduleIds: ["salary", "bonus"],
		});
	});
});

describe("resolveEffectiveIds", () => {
	it("returns every known id when nothing is stored", () => {
		expect(resolveEffectiveIds(null, ["a_card", "loan"])).toEqual([
			"a_card",
			"loan",
		]);
	});

	it("keeps stored non-card debt instead of reverting to the card set", () => {
		expect(
			resolveEffectiveIds(["loan"], ["a_card", "loan"], ["a_card"]),
		).toEqual(["loan"]);
	});

	it("drops unknown ids and falls back when nothing known remains", () => {
		expect(
			resolveEffectiveIds(["gone"], ["a_card", "loan"], ["a_card"]),
		).toEqual(["a_card"]);
	});

	it("falls back to the override set instead of every known id", () => {
		expect(
			resolveEffectiveIds(null, ["checking", "savings"], ["checking"]),
		).toEqual(["checking"]);
	});
});
