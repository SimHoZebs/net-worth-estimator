import { describe, expect, it } from "vitest";
import type { SafeSpendingSettings } from "@/api/contracts.ts";
import {
	applySafeSpendingNumericInputs,
	changedIds,
	dirtySafeSpendingNumericFields,
	safeSpendingNumericInputs,
	sameIds,
	sameSafeSpendingSettings,
} from "./safeSpendingDraft.ts";

const settings: SafeSpendingSettings = {
	cycleStartDay: 20,
	paydayDay: 30,
	savingsTarget: 0,
	accountIds: null,
	spendingAccountIds: null,
	incomeScheduleIds: [],
	transactionIds: null,
};

describe("safe spending draft comparisons", () => {
	it("compares numeric strings numerically and keeps empty required values dirty", () => {
		const inputs = safeSpendingNumericInputs(settings);
		expect(
			dirtySafeSpendingNumericFields(settings, {
				...inputs,
				cycleStartDay: "20.0",
				savingsTarget: "0.00",
			}),
		).toEqual({ cycleStartDay: false, paydayDay: false, savingsTarget: false });
		expect(
			dirtySafeSpendingNumericFields(settings, {
				...inputs,
				savingsTarget: "",
			}),
		).toMatchObject({ savingsTarget: true });
	});

	it("applies all validated numeric inputs to one settings snapshot", () => {
		expect(
			applySafeSpendingNumericInputs(settings, {
				cycleStartDay: "21",
				paydayDay: "29",
				savingsTarget: "500.25",
			}),
		).toMatchObject({
			cycleStartDay: 21,
			paydayDay: 29,
			savingsTarget: 500.25,
		});
	});

	it("compares id selections without order and reports only changed ids", () => {
		expect(sameIds(["card", "cash"], ["cash", "card"])).toBe(true);
		expect(sameIds(["card"], ["cash"])).toBe(false);
		expect([...changedIds(["card", "cash"], ["cash", "loan"])]).toEqual([
			"card",
			"loan",
		]);
	});

	it("compares complete settings semantically with order-insensitive nullable ids", () => {
		const saved = {
			...settings,
			accountIds: ["card", "cash"],
			spendingAccountIds: null,
			incomeScheduleIds: ["salary", "bonus"],
			transactionIds: [],
		};
		expect(
			sameSafeSpendingSettings(saved, {
				...saved,
				accountIds: ["cash", "card"],
				spendingAccountIds: [],
				incomeScheduleIds: ["bonus", "salary"],
				transactionIds: null,
			}),
		).toBe(true);
		expect(
			sameSafeSpendingSettings(saved, { ...saved, savingsTarget: 1 }),
		).toBe(false);
		expect(
			sameSafeSpendingSettings(saved, {
				...saved,
				incomeScheduleIds: ["salary"],
			}),
		).toBe(false);
		expect(
			sameSafeSpendingSettings(settings, { ...settings, accountIds: [] }),
		).toBe(false);
		expect(
			sameSafeSpendingSettings(
				{ ...settings, accountIds: [] },
				{ ...settings, accountIds: [] },
			),
		).toBe(true);
	});
});
