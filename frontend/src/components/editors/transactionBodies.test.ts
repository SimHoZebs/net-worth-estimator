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
	claimScheduleId: null,
	claimOccurrenceDate: null,
	postedDate: "2028-06-15",
	void: false,
	transactionTime: 1842637212,
};

const baselineSchedule: Transaction = {
	id: "invest",
	name: "Monthly investing",
	amount: 1800,
	amountKnown: true,
	fromId: "checking",
	toId: "brokerage",
	kind: "schedule",
	startDate: "2026-10-03",
	endDate: "2028-10-03",
	annualIncrease: 2.5,
	enabled: true,
	readOnly: false,
	claimScheduleId: null,
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
		claimScheduleId: null,
		claimOccurrenceDate: null,
		transactionTime: baselinePosting.transactionTime,
		...overrides,
	};
}

describe("transaction patches", () => {
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

	it("sends the wall time when the time changes", () => {
		const changed = combineDayTime(baselinePosting.startDate, "11:00");
		const patch = postingUpdate({
			baseline: baselinePosting,
			values: values({ transactionTime: changed }),
		});
		expect(patch).toEqual({ time: "11:00" });
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
			claimScheduleId: "",
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

	it("clears nullable endpoint members explicitly", () => {
		const cleared = postingUpdate({
			baseline: baselinePosting,
			values: values({ fromId: null, toId: null }),
		});
		expect(cleared).toEqual({ sourceAccountId: null, destinations: null });
	});

	it("leaves claims to the separate claim action", () => {
		const patch = postingUpdate({
			baseline: {
				...baselinePosting,
				claimScheduleId: "salary",
				claimOccurrenceDate: "2026-02-01",
			},
			values: values({ claimScheduleId: null, claimOccurrenceDate: null }),
		});
		expect(patch).toEqual({});
	});
});

describe("schedule patches", () => {
	function scheduleValues(
		overrides: Partial<Parameters<typeof ruleUpdate>[0]["values"]> = {},
	): Parameters<typeof ruleUpdate>[0]["values"] {
		return {
			name: baselineSchedule.name,
			amount: baselineSchedule.amount,
			annualIncrease: baselineSchedule.annualIncrease,
			fromId: baselineSchedule.fromId,
			toId: baselineSchedule.toId,
			frequency: "yearly",
			startDate: baselineSchedule.startDate,
			endDate: baselineSchedule.endDate,
			postedDate: null,
			enabled: baselineSchedule.enabled,
			claimScheduleId: null,
			claimOccurrenceDate: null,
			...overrides,
		};
	}

	it("keeps a stored cadence the editor never offered", () => {
		const patch = ruleUpdate({
			baseline: baselineSchedule,
			values: scheduleValues({ name: "Monthly investing revised" }),
			storedFrequency: "annual",
		});
		expect(patch).toEqual({
			amend: { name: "Monthly investing revised" },
			reschedule: {},
		});
	});

	it("sends only the cadence when the choice changes", () => {
		const patch = ruleUpdate({
			baseline: baselineSchedule,
			values: scheduleValues({ frequency: "monthly" }),
			storedFrequency: "annual",
		});
		expect(patch).toEqual({ amend: {}, reschedule: { frequency: "monthly" } });
	});

	it("sends a semantic amount when the value or growth changes", () => {
		const patch = ruleUpdate({
			baseline: baselineSchedule,
			values: scheduleValues({ amount: 2000, annualIncrease: 3 }),
			storedFrequency: "annual",
		});
		expect(patch).toEqual({
			amend: { amount: { value: 2000, annualIncrease: 3 } },
			reschedule: {},
		});
	});

	it("clears the end date with an explicit null", () => {
		const patch = ruleUpdate({
			baseline: baselineSchedule,
			values: scheduleValues({ endDate: null, frequency: "yearly" }),
			storedFrequency: "annual",
		});
		expect(patch).toEqual({ amend: {}, reschedule: { endDate: null } });
	});

	it("omits frequency when the stored cadence is unknown", () => {
		const patch = ruleUpdate({
			baseline: baselineSchedule,
			values: scheduleValues({ name: "Renamed" }),
		});
		expect(patch).toEqual({ amend: { name: "Renamed" }, reschedule: {} });
	});
});

describe("create bodies", () => {
	it("authors a semantic transaction amount and calendar day", () => {
		const body = postingBody(values());
		expect(body.amount).toEqual({ value: 48000 });
		expect(body.date).toBe("2028-06-15");
		expect(body.time).toBe("19:40:12");
	});
	it("authors a semantic schedule amount with yearly growth", () => {
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
			claimScheduleId: null,
			claimOccurrenceDate: null,
		});
		expect(body.amount).toEqual({ value: 900, annualIncrease: 2.5 });
	});
	it("states a claim as its own action body", () => {
		expect(claimUpdate("salary", "2026-02-01")).toEqual({
			scheduleId: "salary",
			occurrenceDate: "2026-02-01",
		});
	});
});
