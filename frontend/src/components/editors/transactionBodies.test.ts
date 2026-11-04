import { describe, expect, it } from "vitest";
import type { Transaction } from "../../domain/model.ts";
import {
	claimUpdate,
	combineDayTime,
	detailFormValues,
	postingBody,
	postingUpdate,
	ruleBody,
	ruleUpdate,
	timeOfDay,
} from "./transactionBodies.ts";

const baselinePosting: Transaction = {
	id: "renovation",
	name: "Home renovation",
	amount: 48000,
	amountKnown: true,
	fromId: "checking",
	toId: "savings",
	kind: "posting",
	startDate: "2028-06-15",
	endDate: null,
	annualIncrease: 0,
	enabled: true,
	readOnly: false,
	claimRuleId: null,
	claimOccurrenceDate: null,
	postedDate: "2028-06-15",
	void: false,
	transactionTime: 1842637212,
};

const baselineRule: Transaction = {
	id: "invest",
	name: "Monthly investing",
	amount: 1800,
	amountKnown: true,
	fromId: "checking",
	toId: "brokerage",
	kind: "rule",
	startDate: "2026-10-03",
	endDate: "2028-10-03",
	annualIncrease: 2.5,
	enabled: true,
	readOnly: false,
	claimRuleId: null,
	claimOccurrenceDate: null,
	postedDate: null,
	void: false,
};

function values(
	overrides: Partial<Parameters<typeof postingUpdate>[0]["values"]> = {},
): Parameters<typeof postingUpdate>[0]["values"] {
	return {
		name: baselinePosting.name,
		amount: baselinePosting.amount,
		annualIncrease: baselinePosting.annualIncrease,
		fromId: baselinePosting.fromId,
		toId: baselinePosting.toId,
		frequency: "once",
		startDate: baselinePosting.startDate,
		endDate: baselinePosting.endDate,
		postedDate: baselinePosting.postedDate,
		enabled: baselinePosting.enabled,
		claimRuleId: null,
		claimOccurrenceDate: null,
		transactionTime: baselinePosting.transactionTime,
		...overrides,
	};
}

describe("posting patches", () => {
	it("states only the edited member on a rename", () => {
		const patch = postingUpdate({
			baseline: baselinePosting,
			values: values({ name: "Home renovation revised" }),
		});
		expect(patch).toEqual({ name: "Home renovation revised" });
	});

	it("returns an empty patch when nothing changed", () => {
		expect(
			postingUpdate({ baseline: baselinePosting, values: values() }),
		).toEqual({});
	});

	it("sends the exact new instant when the time changes", () => {
		const changed = combineDayTime(baselinePosting.startDate, "11:00");
		const patch = postingUpdate({
			baseline: baselinePosting,
			values: values({ transactionTime: changed }),
		});
		expect(patch).toEqual({ transactionTime: changed });
	});

	it("keeps second precision out of the patch when the time is untouched", () => {
		const draft = {
			name: baselinePosting.name,
			amount: "48000",
			fromId: "checking",
			toId: "savings",
			frequency: "once" as const,
			startDate: baselinePosting.startDate,
			endDate: "",
			noEndDate: true,
			annualIncrease: "0",
			enabled: true,
			claimRuleId: "",
			claimOccurrenceDate: "",
			postedDate: baselinePosting.postedDate ?? "",
			transactionTime: timeOfDay(baselinePosting.transactionTime),
		};
		const formValues = detailFormValues({
			draft,
			item: baselinePosting,
			isOnce: true,
		});
		if (formValues instanceof Error) throw formValues;
		expect(formValues.transactionTime).toBe(baselinePosting.transactionTime);
		expect(
			postingUpdate({ baseline: baselinePosting, values: formValues }),
		).toEqual({});
	});

	it("clears nullable claim and endpoint members explicitly", () => {
		const patch = postingUpdate({
			baseline: { ...baselinePosting, claimRuleId: "salary", claimOccurrenceDate: "2026-02-01" },
			values: values({ claimRuleId: null, claimOccurrenceDate: null }),
		});
		expect(patch).toEqual({ claim: null });
		const cleared = postingUpdate({
			baseline: baselinePosting,
			values: values({ fromId: null, toId: null }),
		});
		expect(cleared).toEqual({ sourceAccountId: null, destinations: null });
	});
});

describe("rule patches", () => {
	function ruleValues(
		overrides: Partial<Parameters<typeof ruleUpdate>[0]["values"]> = {},
	): Parameters<typeof ruleUpdate>[0]["values"] {
		return {
			name: baselineRule.name,
			amount: baselineRule.amount,
			annualIncrease: baselineRule.annualIncrease,
			fromId: baselineRule.fromId,
			toId: baselineRule.toId,
			frequency: "yearly",
			startDate: baselineRule.startDate,
			endDate: baselineRule.endDate,
			postedDate: null,
			enabled: baselineRule.enabled,
			claimRuleId: null,
			claimOccurrenceDate: null,
			...overrides,
		};
	}

	it("keeps a stored cadence the editor never offered", () => {
		const patch = ruleUpdate({
			baseline: baselineRule,
			values: ruleValues({ name: "Monthly investing revised" }),
			storedFrequency: "annual",
		});
		expect(patch).toEqual({ name: "Monthly investing revised" });
	});

	it("sends only the cadence when the choice changes", () => {
		const patch = ruleUpdate({
			baseline: baselineRule,
			values: ruleValues({ frequency: "monthly" }),
			storedFrequency: "annual",
		});
		expect(patch).toEqual({ frequency: "monthly" });
	});

	it("sends a semantic amount when the value or growth changes", () => {
		const patch = ruleUpdate({
			baseline: baselineRule,
			values: ruleValues({ amount: 2000, annualIncrease: 3 }),
			storedFrequency: "annual",
		});
		expect(patch).toEqual({ amount: { value: 2000, annualIncrease: 3 } });
	});

	it("clears the end date with an explicit null", () => {
		const patch = ruleUpdate({
			baseline: baselineRule,
			values: ruleValues({ endDate: null, frequency: "yearly" }),
			storedFrequency: "annual",
		});
		expect(patch).toEqual({ endDate: null });
	});

	it("omits frequency when the stored cadence is unknown", () => {
		const patch = ruleUpdate({
			baseline: baselineRule,
			values: ruleValues({ name: "Renamed" }),
		});
		expect(patch).toEqual({ name: "Renamed" });
	});
});

describe("create bodies", () => {
	it("authors a semantic posting amount", () => {
		const body = postingBody(values());
		expect(body.amount).toEqual({ value: 48000 });
	});
	it("authors a semantic rule amount with yearly growth", () => {
		const body = ruleBody({
			name: "Invest",
			amount: 900,
			annualIncrease: 2.5,
			fromId: "checking",
			toId: "brokerage",
			frequency: "yearly",
			startDate: "2026-01-01",
			endDate: null,
			postedDate: null,
			enabled: true,
			claimRuleId: null,
			claimOccurrenceDate: null,
		});
		expect(body.amount).toEqual({ value: 900, annualIncrease: 2.5 });
	});
	it("states a claim as one member on the claim patch", () => {
		expect(claimUpdate("salary", "2026-02-01")).toEqual({
			claim: { ruleId: "salary", occurrenceDate: "2026-02-01" },
		});
	});
});
