import { describe, expect, it } from "vitest";
import type { Transaction } from "../../domain/model.ts";
import {
	claimUpdate,
	combineDayTime,
	detailTransactionValues,
	detailScheduleValues,
	transactionBody,
	transactionUpdate,
	scheduleBody,
	scheduleUpdate,
	timeOfDay,
	validateTransactionValues,
	validateScheduleValues,
} from "./transactionBodies.ts";

const baselineTransaction: Transaction = {
	id: "renovation",
	name: "Home renovation",
	amount: 48000,
	amountKnown: true,
	fromId: "checking",
	toId: "savings",
	kind: "transaction",
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

function transactionValues(
	overrides: Partial<Parameters<typeof transactionUpdate>[0]["values"]> = {},
): Parameters<typeof transactionUpdate>[0]["values"] {
	return {
		name: baselineTransaction.name,
		amount: baselineTransaction.amount,
		fromId: baselineTransaction.fromId,
		toId: baselineTransaction.toId,
		startDate: baselineTransaction.startDate,
		postedDate: baselineTransaction.postedDate,
		enabled: baselineTransaction.enabled,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		transactionTime: baselineTransaction.transactionTime,
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

describe("transaction patches", () => {
	it("states only the edited member on a rename", () => {
		const patch = transactionUpdate({
			baseline: baselineTransaction,
			values: transactionValues({ name: "Home renovation revised" }),
		});
		expect(patch).toEqual({ name: "Home renovation revised" });
	});

	it("returns an empty patch when nothing changed", () => {
		expect(
			transactionUpdate({
				baseline: baselineTransaction,
				values: transactionValues(),
			}),
		).toEqual({});
	});

	it("sends the wall time when the time changes", () => {
		const changed = combineDayTime(baselineTransaction.startDate, "11:00");
		const patch = transactionUpdate({
			baseline: baselineTransaction,
			values: transactionValues({ transactionTime: changed }),
		});
		expect(patch).toEqual({ time: "11:00" });
	});

	it("keeps second precision out of the patch when the time is untouched", () => {
		const formValues = detailTransactionValues({
			draft: {
				name: baselineTransaction.name,
				amount: "48000",
				fromId: "checking",
				toId: "savings",
				startDate: baselineTransaction.startDate,
				postedDate: baselineTransaction.postedDate ?? "",
				enabled: true,
				claimScheduleId: "",
				claimOccurrenceDate: "",
				transactionTime: timeOfDay(baselineTransaction.transactionTime),
			},
			item: baselineTransaction,
		});
		if (formValues instanceof Error) throw formValues;
		expect(formValues.transactionTime).toBe(
			baselineTransaction.transactionTime,
		);
		expect(
			transactionUpdate({ baseline: baselineTransaction, values: formValues }),
		).toEqual({});
	});

	it("clears nullable endpoint members explicitly", () => {
		const cleared = transactionUpdate({
			baseline: baselineTransaction,
			values: transactionValues({ fromId: null, toId: null }),
		});
		expect(cleared).toEqual({ sourceAccountId: null, destinations: null });
	});

	it("leaves claims to the separate claim action", () => {
		const patch = transactionUpdate({
			baseline: {
				...baselineTransaction,
				claimScheduleId: "salary",
				claimOccurrenceDate: "2026-02-01",
			},
			values: transactionValues({
				claimScheduleId: null,
				claimOccurrenceDate: null,
			}),
		});
		expect(patch).toEqual({});
	});

	it("carries no cadence, growth, or end date", () => {
		const body = transactionBody(transactionValues());
		expect(body).not.toHaveProperty("frequency");
		expect(body).not.toHaveProperty("endDate");
		expect(body.amount).toEqual({ value: 48000 });
		expect(
			transactionUpdate({
				baseline: baselineTransaction,
				values: transactionValues(),
			}),
		).not.toHaveProperty("annualIncrease");
	});

	it("validates the transaction fields without asking for recurrence", () => {
		expect(validateTransactionValues(transactionValues())).toBeNull();
		expect(validateTransactionValues(transactionValues({ name: "  " }))).toBe(
			"Give the transaction a name.",
		);
		expect(
			validateTransactionValues(
				transactionValues({
					claimScheduleId: "salary",
					claimOccurrenceDate: null,
				}),
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
		expect(validateScheduleValues(scheduleValues({ annualIncrease: 60 }))).toBe(
			"Enter a yearly increase between -50 and 50 percent.",
		);
		expect(
			validateScheduleValues(
				scheduleValues({ startDate: "2026-10-03", endDate: "2026-09-01" }),
			),
		).toBe("The last occurrence cannot come before the first one.");
	});
});

describe("create bodies", () => {
	it("authors a semantic transaction amount and calendar day", () => {
		const body = transactionBody(transactionValues());
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
