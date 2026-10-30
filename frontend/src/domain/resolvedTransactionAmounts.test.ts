import { describe, expect, it } from "vitest";
import { resolveTransactionAmounts } from "./resolvedTransactionAmounts.ts";
import type { TransactionResult } from "./result.ts";

function event(
	transactionId: string,
	date: string,
	requested: number,
	realized: number,
): TransactionResult {
	return {
		date,
		transactionId,
		name: transactionId,
		requested,
		realized,
		fromId: null,
		toId: "cash",
		available: null,
		constraint: null,
		accountDeltas: [],
	};
}

describe("resolveTransactionAmounts", () => {
	it("picks the earliest projected occurrence per transaction", () => {
		const resolved = resolveTransactionAmounts([
			event("growth", "2026-03-01", 50, 50),
			event("growth", "2026-02-01", 40, 40),
		]);
		expect(resolved.get("growth")).toMatchObject({
			amount: 40,
			date: "2026-02-01",
			occurrences: 2,
		});
	});

	it("prefers realized over requested and flags shortfalls", () => {
		const resolved = resolveTransactionAmounts([
			event("payoff", "2026-02-01", 500, 300),
		]);
		expect(resolved.get("payoff")).toMatchObject({
			amount: 300,
			requested: 500,
			constrained: true,
		});
	});

	it("returns an empty map when there are no projected events", () => {
		expect(resolveTransactionAmounts([]).size).toBe(0);
	});
});
