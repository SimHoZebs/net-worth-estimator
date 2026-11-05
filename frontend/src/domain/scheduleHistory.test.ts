import { expect, it } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import type { Transaction } from "./model.ts";
import { scheduleHistoryTransactions } from "./scheduleHistory.ts";

const schedule = financialModelFixture.transactions.find(
	(transaction) => transaction.id === "living",
)!;
const base = financialModelFixture.transactions.find(
	(transaction) => transaction.kind === "posting",
)!;

function claimed(
	id: string,
	claimOccurrenceDate: string,
	claimScheduleId = schedule.id,
): Transaction {
	return {
		...base,
		id,
		name: `Claim ${id}`,
		kind: "posting",
		startDate: claimOccurrenceDate,
		claimScheduleId,
		claimOccurrenceDate,
	};
}

it("returns matching postings newest occurrence first", () => {
	const older = claimed("older", "2026-10-01");
	const newer = claimed("newer", "2026-11-01");
	const otherSchedule = claimed("other", "2026-12-01", "salary");
	const rule = { ...schedule, claimScheduleId: schedule.id };
	const history = scheduleHistoryTransactions({
		scheduleId: schedule.id,
		transactions: [older, rule, otherSchedule, newer],
	});
	expect(history.map((transaction) => transaction.id)).toEqual([
		"newer",
		"older",
	]);
});

it("falls back to the transaction date when a claim has no occurrence day", () => {
	const posting = {
		...claimed("no-occurrence", "2026-10-01"),
		claimOccurrenceDate: null,
		startDate: "2026-10-04",
	};
	expect(
		scheduleHistoryTransactions({
			scheduleId: schedule.id,
			transactions: [posting],
		}),
	).toEqual([posting]);
});
