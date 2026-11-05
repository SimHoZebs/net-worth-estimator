import { describe, expect, it } from "vitest";
import type { Transaction } from "../../domain/model.ts";
import {
	claimUpdate,
	combineDayTime,
	detailPostingValues,
	detailScheduleValues,
	postingBody,
	postingUpdate,
	scheduleBody,
	scheduleUpdate,
	timeOfDay,
	validatePostingValues,
	validateScheduleValues,
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

function postingValues(
	overrides: Partial<Parameters<typeof postingUpdate>[0]["values"]> = {},
): Parameters<typeof postingUpdate>[0]["values"] {
	return {
		name: baselinePosting.name,
		amount: baselinePosting.amount,
		fromId: baselinePosting.fromId,
		toId: baselinePosting.toId,
		startDate: baselinePosting.startDate,
		postedDate: baselinePosting.postedDate,
		enabled: baselinePosting.enabled,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		transactionTime: baselinePosting.transactionTime,
		...overrides,
	};
}

function scheduleValues(
	overrides: Partial<Parameters<typeof scheduleUpdate>[0]["values"]> = {},
): Parameters<typeof scheduleUpdate>[0]["values"] {
	return {
		name: baselineSchedule.name,
		amount: baselineSchedule.amount,
		annualIncrease: baselineSchedule.annualIncrease,
		fromId: baselineSchedule.fromId,
		toId: baselineSchedule.toId,
		frequency: "monthly",
		startDate: baselineSchedule.startDate,
		endDate: baselineSchedule.endDate,
		enabled: baselineSchedule.enabled,
		...overrides,
	};
}

describe("posting patches", () => {
	it("states only the edited member on a rename", () => {
		const patch = postingUpdate({
			baseline: baselinePosting,
			values: postingValues({ name: "Home renovation revised" }),
		});
		expect(patch).toEqual({ name: "Home renovation revised" });
	});

	it("returns an empty patch when nothing changed", () => {
		expect(
			postingUpdate({ baseline: baselinePosting, values: postingValues() }),
		).toEqual({});
	});

	it("sends the wall time when the time changes", () => {
		const changed = combineDayTime(baselinePosting.startDate, "11:00");
		const patch = postingUpdate({
			baseline: baselinePosting,
			values: postingValues({ transactionTime: changed }),
		});
		expect(patch).toEqual({ time: "11:00" });
	});

	it("keeps second precision out of the patch when the time is untouched", () => {
		const formValues = detailPostingValues({
			draft: {
				name: baselinePosting.name,
				amount: "48000",
				fromId: "checking",
				toId: "savings",
				startDate: baselinePosting.startDate,
				postedDate: baselinePosting.postedDate ?? "",
				enabled: true,
				claimScheduleId: "",
				claimOccurrenceDate: "",
				transactionTime: timeOfDay(baselinePosting.transactionTime),
			},
			item: baselinePosting,
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
			values: postingValues({ fromId: null, toId: null }),
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
			values: postingValues({ claimScheduleId: null, claimOccurrenceDate: null }),
		});
		expect(patch).toEqual({});
	});

	it("carries no cadence, growth, or end date", () => {
		const body = postingBody(postingValues());
		expect(body).not.toHaveProperty("frequency");
		expect(body).not.toHaveProperty("endDate");
		expect(body.amount).toEqual({ value: 48000 });
		expect(postingUpdate({ baseline: baselinePosting, values: postingValues() }))
			.not.toHaveProperty("annualIncrease");
	});

	it("validates the posting fields without asking for recurrence", () => {
		expect(validatePostingValues(postingValues())).toBeNull();
		expect(validatePostingValues(postingValues({ name: "  " }))).toBe(
			"Give the transaction a name.",
		);
		expect(
			validatePostingValues(
				postingValues({ claimScheduleId: "salary", claimOccurrenceDate: null }),
			),
		).toBe("Choose which occurrence this replaces.");
	});
});

describe("schedule patches", () => {
	it("keeps the stored cadence when the choice does not change", () => {
		const patch = scheduleUpdate({
			baseline: baselineSchedule,
			values: scheduleValues({ name: "Monthly investing revised" }),
			storedFrequency: "monthly",
		});
		expect(patch).toEqual({
			amend: { name: "Monthly investing revised" },
			reschedule: {},
		});
	});

	it("sends only the cadence when the choice changes", () => {
		const patch = scheduleUpdate({
			baseline: baselineSchedule,
			values: scheduleValues({ frequency: "annual" }),
			storedFrequency: "monthly",
		});
		expect(patch).toEqual({ amend: {}, reschedule: { frequency: "annual" } });
	});

	it("sends a semantic amount when the value or growth changes", () => {
		const patch = scheduleUpdate({
			baseline: baselineSchedule,
			values: scheduleValues({ amount: 2000, annualIncrease: 3 }),
			storedFrequency: "monthly",
		});
		expect(patch).toEqual({
			amend: { amount: { value: 2000, annualIncrease: 3 } },
			reschedule: {},
		});
	});

	it("clears the end date with an explicit null", () => {
		const patch = scheduleUpdate({
			baseline: baselineSchedule,
			values: scheduleValues({ endDate: null }),
			storedFrequency: "monthly",
		});
		expect(patch).toEqual({ amend: {}, reschedule: { endDate: null } });
	});

	it("omits frequency when the stored cadence is unknown", () => {
		const patch = scheduleUpdate({
			baseline: baselineSchedule,
			values: scheduleValues({ name: "Renamed", frequency: "annual" }),
		});
		expect(patch).toEqual({ amend: { name: "Renamed" }, reschedule: {} });
	});

	it("reads growth and an open end date from the in-place draft", () => {
		const values = detailScheduleValues({
			draft: {
				name: "Monthly investing",
				amount: "1800",
				fromId: "checking",
				toId: "brokerage",
				frequency: "annual",
				startDate: "2026-10-03",
				endDate: "",
				noEndDate: true,
				annualIncrease: "2.5",
				enabled: true,
			},
		});
		if (values instanceof Error) throw values;
		expect(values.frequency).toBe("annual");
		expect(values.annualIncrease).toBe(2.5);
		expect(values.endDate).toBeNull();
	});

	it("validates recurrence fields on a schedule", () => {
		expect(validateScheduleValues(scheduleValues())).toBeNull();
		expect(
			validateScheduleValues(scheduleValues({ annualIncrease: 60 })),
		).toBe("Enter a yearly increase between -50 and 50 percent.");
		expect(
			validateScheduleValues(
				scheduleValues({ startDate: "2026-10-03", endDate: "2026-09-01" }),
			),
		).toBe("The last occurrence cannot come before the first one.");
	});
});

describe("create bodies", () => {
	it("authors a semantic transaction amount and calendar day", () => {
		const body = postingBody(postingValues());
		expect(body.amount).toEqual({ value: 48000 });
		expect(body.date).toBe("2028-06-15");
		expect(body.time).toBe("19:40:12");
	});

	it("authors a semantic schedule amount with yearly growth", () => {
		const body = scheduleBody({
			name: "Invest",
			amount: 900,
			annualIncrease: 2.5,
			fromId: "checking",
			toId: "brokerage",
			frequency: "annual",
			startDate: "2026-01-01",
			endDate: null,
			enabled: true,
		});
		expect(body.amount).toEqual({ value: 900, annualIncrease: 2.5 });
		expect(body.frequency).toBe("annual");
	});

	it("states a claim as its own action body", () => {
		expect(claimUpdate("salary", "2026-02-01")).toEqual({
			scheduleId: "salary",
			occurrenceDate: "2026-02-01",
		});
	});
});
