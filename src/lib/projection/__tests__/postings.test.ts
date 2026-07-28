import { describe, expect, it } from "vitest";
import { makeAccount, makePosting } from "../__fixtures__";
import {
	addOccurrences,
	frequencyDivisor,
	resolveAccountMovement,
} from "../simulation/postings";

describe("posting recurrence", () => {
	it("adds a once posting exactly once and uses a divisor of one", () => {
		const eventDates = new Map();
		addOccurrences(
			[
				makePosting({
					id: "one-time",
					frequency: "once",
					startDate: "2026-01-15",
				}),
			],
			eventDates,
			"2026-01-01",
			"2030-01-01",
			true,
		);

		expect([...eventDates.keys()]).toEqual(["2026-01-15"]);
		expect(eventDates.get("2026-01-15")).toHaveLength(1);
		expect(frequencyDivisor("once")).toBe(1);
	});
});

describe("account movement resolution", () => {
	it("returns raw unavailable-source movement facts", () => {
		const result = resolveAccountMovement(
			{
				sourceAccountId: "missing",
				destinations: null,
				requestedAmount: 100,
			},
			{},
			new Map(),
		);

		expect(result).toEqual({
			requestedAmount: 100,
			realizedAmount: 0,
		});
	});

	it("resolves tied source-floor and caller action limits", () => {
		const source = makeAccount({ id: "cash", minBalance: 50 });
		const result = resolveAccountMovement(
			{
				sourceAccountId: source.id,
				destinations: null,
				requestedAmount: 100,
				limitRemaining: 50,
			},
			{ cash: 100 },
			new Map([[source.id, source]]),
		);

		expect(result.realizedAmount).toBe(50);
		expect(result.requestedAmount - result.realizedAmount).toBe(50);
	});

	it("enforces a tied destination ceiling", () => {
		const source = makeAccount({ id: "cash", minBalance: 0 });
		const destination = makeAccount({ id: "loan", maxBalance: 0 });
		const result = resolveAccountMovement(
			{
				sourceAccountId: source.id,
				destinations: [destination.id],
				requestedAmount: 200,
			},
			{ cash: 100, loan: -100 },
			new Map([
				[source.id, source],
				[destination.id, destination],
			]),
		);

		expect(result.realizedAmount).toBe(100);
	});

	it("does not bind constraints for a zero request", () => {
		const result = resolveAccountMovement(
			{
				sourceAccountId: "missing",
				destinations: null,
				requestedAmount: 0,
			},
			{},
			new Map(),
		);

		expect(result.requestedAmount - result.realizedAmount).toBe(0);
	});
});
