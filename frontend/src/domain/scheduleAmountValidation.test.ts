import { describe, expect, it } from "vitest";
import { validateScheduleAmountDraft } from "./scheduleAmountValidation.ts";

const accounts = [
	{ id: "checking", kind: "cash" },
	{ id: "brokerage", kind: "investment" },
	{ id: "card", kind: "credit_card" },
	{
		id: "grouped",
		kind: "cash",
		display: { components: [{ accountId: "a" }, { accountId: "b" }] },
	},
];
const schedules = [{ id: "salary" }];

function validate(templateId: string, fields: Record<string, string>) {
	return validateScheduleAmountDraft({
		templateId,
		fields,
		accounts,
		schedules,
	});
}

describe("schedule amount draft validation", () => {
	it.each([
		["fixed", { amount: "" }],
		["fixed", { amount: "-1" }],
		["fixed", { amount: "10000000001" }],
		["fixed", { amount: "NaN" }],
		["growth", { base: "500", annualGrowthRate: "0.51" }],
		["growth", { base: "-1", annualGrowthRate: "0.03" }],
		["schedule-percent", { reference: "salary", percent: "-0.1" }],
		["account-percent", { accountId: "checking", pct: "-0.04" }],
		[
			"investment-growth",
			{ refId: "brokerage", annualRate: "1.01", volatility: "0.12" },
		],
		[
			"investment-growth",
			{ refId: "brokerage", annualRate: "-0.51", volatility: "0.12" },
		],
		[
			"investment-growth",
			{ refId: "brokerage", annualRate: "0.07", volatility: "-0.01" },
		],
		[
			"investment-growth",
			{ refId: "brokerage", annualRate: "0.07", volatility: "1.01" },
		],
	])("rejects invalid guided fields for %s", (templateId, fields) => {
		expect(validate(templateId, fields)).not.toBeNull();
	});

	it.each([
		["fixed", { amount: "0" }],
		["fixed", { amount: "10000000000" }],
		["growth", { base: "500", annualGrowthRate: "-0.5" }],
		["growth", { base: "500", annualGrowthRate: "0.5" }],
		["schedule-percent", { reference: "salary", percent: "2" }],
		["account-percent", { accountId: "checking", pct: "2" }],
		[
			"investment-growth",
			{ refId: "brokerage", annualRate: "-0.5", volatility: "0" },
		],
		[
			"investment-growth",
			{ refId: "brokerage", annualRate: "1", volatility: "1" },
		],
		["owed-balance", { accountId: "card" }],
	])("accepts valid guided fields for %s", (templateId, fields) => {
		expect(validate(templateId, fields)).toBeNull();
	});

	it.each([
		["schedule-percent", { reference: "", percent: "0.1" }],
		["schedule-percent", { reference: "missing", percent: "0.1" }],
		["account-percent", { accountId: "card", pct: "0.04" }],
		["account-percent", { accountId: "grouped", pct: "0.04" }],
		[
			"investment-growth",
			{ refId: "", annualRate: "0.07", volatility: "0.12" },
		],
		["owed-balance", { accountId: "checking" }],
	])("requires a valid current reference for %s", (templateId, fields) => {
		expect(validate(templateId, fields)).not.toBeNull();
	});

	it("leaves saved custom descriptors to their own contract", () => {
		expect(validate("custom", {})).toBeNull();
		expect(validate("federal-tax", {})).toBeNull();
	});
});
