import { describe, expect, it } from "vitest";
import { SCHEDULE_AMOUNT_RECIPES, validateRecipe } from "./scheduleAmounts.ts";

const recipe = (id: string) =>
	SCHEDULE_AMOUNT_RECIPES.find((entry) => entry.id === id)!;

describe("guided schedule amounts", () => {
	it("retains server-authored literals and yearly growth", () => {
		expect(recipe("fixed").build({ amount: "123.45" })).toEqual({
			value: 123.45,
		});
		expect(
			recipe("growth").build({ amount: "1000", annualIncrease: "3" }),
		).toEqual({ value: 1000, annualIncrease: 3 });
	});
	it.each([
		["schedule-percent", "model-value"],
		["account-percent", "account-balance"],
	])("authors %s without copying simulation calculations", (id, provider) => {
		expect(
			recipe(id).build({ reference: "selected-id", percent: "4" }),
		).toEqual({
			resolver: "expression",
			config: { expression: "base * share" },
			inputs: {
				base: {
					source: "provider",
					provider,
					arguments: { id: "selected-id" },
				},
				share: { source: "literal", value: 0.04 },
			},
		});
	});
	it("passes annual rates to the engine without dividing them in the browser", () => {
		expect(
			recipe("investment-growth").build({
				reference: "investment",
				rate: "7",
				volatility: "15",
			}),
		).toMatchObject({
			inputs: {
				rate: {
					provider: "occurrence-rate",
					arguments: { annualRate: 0.07, volatility: 0.15 },
				},
			},
		});
	});
	it("never turns a positive card balance into a new payment", () => {
		expect(recipe("owed-balance").build({ reference: "card" })).toMatchObject({
			config: { expression: "(abs(balance) - balance) / 2" },
		});
	});
	it.each(SCHEDULE_AMOUNT_RECIPES)(
		"validates each required field for $id",
		(entry) => {
			for (const field of entry.fields) {
				expect(
					validateRecipe(entry, {
						...entry.defaults,
						reference: "selected-id",
						[field.key]: "",
					}),
				).not.toBeNull();
			}
			for (const field of entry.fields.filter(
				(field) => field.kind === "number",
			)) {
				for (const value of [
					"NaN",
					"Infinity",
					...(field.max === undefined ? [] : [String(field.max + 1)]),
				]) {
					expect(
						validateRecipe(entry, {
							...entry.defaults,
							reference: "selected-id",
							[field.key]: value,
						}),
					).not.toBeNull();
				}
			}
			expect(
				validateRecipe(entry, { ...entry.defaults, reference: "selected-id" }),
			).toBeNull();
		},
	);
	it("allows employer matches above one hundred percent", () => {
		const entry = recipe("schedule-percent");
		expect(
			validateRecipe(entry, { reference: "contribution", percent: "200" }),
		).toBeNull();
		expect(
			entry.build({ reference: "contribution", percent: "200" }),
		).toMatchObject({ inputs: { share: { value: 2 } } });
	});
});
