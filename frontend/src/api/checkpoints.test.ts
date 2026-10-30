import { describe, expect, it } from "vitest";
import { checkpointInstant, latestCheckpoint } from "./checkpoints.ts";

describe("latestCheckpoint", () => {
	it("orders by instant, not date alone", () => {
		const rows = [
			{ AccountId: "a", Balance: 1, observedAt: 200 },
			{
				AccountId: "a",
				Balance: 2,
				observedAt: 100,
				source: "simplefin",
			},
		];
		expect(latestCheckpoint(rows, "a", "2026-03-10")?.Balance).toBe(1);
		expect(checkpointInstant(rows[1]!)).toBe(100);
	});

	it("lets the owner row win equal instants regardless of input order", () => {
		const syncFirst = [
			{
				AccountId: "a",
				Balance: 1,
				observedAt: 100,
				source: "simplefin",
			},
			{
				AccountId: "a",
				Balance: 2,
				observedAt: 100,
				source: "user",
			},
		];
		const ownerFirst = [...syncFirst].reverse();
		expect(latestCheckpoint(syncFirst, "a", "2026-03-10")?.Balance).toBe(2);
		expect(latestCheckpoint(ownerFirst, "a", "2026-03-10")?.Balance).toBe(2);
	});

	it("ignores observations after the viewed date", () => {
		const rows = [
			{ AccountId: "a", Balance: 9, observedAt: 1773273599 },
			{ AccountId: "a", Balance: 3, observedAt: 1773187199 },
		];
		expect(latestCheckpoint(rows, "a", "2026-03-10")?.Balance).toBe(3);
		expect(latestCheckpoint(rows, "a", "2026-03-09")).toBeNull();
	});
});
