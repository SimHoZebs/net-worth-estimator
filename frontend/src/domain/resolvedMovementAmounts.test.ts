import { describe, expect, it } from "vitest";
import { resolveMovementAmounts } from "./resolvedMovementAmounts.ts";
import type { MovementResult } from "./result.ts";

function event(
	movementId: string,
	date: string,
	requested: number,
	realized: number,
): MovementResult {
	return {
		date,
		movementId,
		name: movementId,
		requested,
		realized,
		fromId: null,
		toId: "cash",
		available: null,
		constraint: null,
		accountDeltas: [],
	};
}

describe("resolveMovementAmounts", () => {
	it("picks the earliest projected occurrence per movement", () => {
		const resolved = resolveMovementAmounts([
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
		const resolved = resolveMovementAmounts([
			event("payoff", "2026-02-01", 500, 300),
		]);
		expect(resolved.get("payoff")).toMatchObject({
			amount: 300,
			requested: 500,
			constrained: true,
		});
	});

	it("returns an empty map when there are no projected events", () => {
		expect(resolveMovementAmounts([]).size).toBe(0);
	});
});
