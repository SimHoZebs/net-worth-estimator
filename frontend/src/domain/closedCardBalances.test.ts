import { describe, expect, it } from "vitest";
import type { BackendCheckpoint } from "../api/contracts.ts";
import { closedCardBalances } from "./closedCardBalances.ts";

const cards = [
	{ id: "a", name: "Card A" },
	{ id: "b", name: "Card B" },
];
const checkpoints: BackendCheckpoint[] = [
	{ AccountId: "a", Date: "2026-10-21", Balance: -900 },
	{ AccountId: "b", Date: "2026-10-19", Balance: -700 },
	{ AccountId: "a", Date: "2026-10-02", Balance: -100 },
	{ AccountId: "a", Date: "2026-10-19", Balance: -500 },
];

describe("closedCardBalances", () => {
	it("uses each saved balance at close and ignores newer-cycle balances", () => {
		const result = closedCardBalances({
			cards,
			checkpoints,
			cycleEnd: "2026-10-19",
		});
		expect(result.total).toBe(1200);
		expect(result.cards).toEqual([
			{ ...cards[0], amount: 500, observedOn: "2026-10-19" },
			{ ...cards[1], amount: 700, observedOn: "2026-10-19" },
		]);
	});

	it("includes only selected cards and preserves the date of older observations", () => {
		const result = closedCardBalances({
			cards: [cards[0]!],
			checkpoints,
			cycleEnd: "2026-10-18",
		});
		expect(result.total).toBe(100);
		expect(result.cards[0]!.observedOn).toBe("2026-10-02");
	});

	it("does not present a partial total as the amount needed for all cards", () => {
		const result = closedCardBalances({
			cards,
			checkpoints: checkpoints.filter((row) => row.AccountId === "a"),
			cycleEnd: "2026-10-19",
		});
		expect(result.total).toBeNull();
		expect(result.cards[1]).toEqual({
			...cards[1],
			amount: null,
			observedOn: null,
		});
	});

	it("does not offset debt on one card with a credit on another", () => {
		const result = closedCardBalances({
			cards,
			checkpoints: [
				{ AccountId: "a", Date: "2026-10-19", Balance: 25 },
				checkpoints[1]!,
			],
			cycleEnd: "2026-10-19",
		});
		expect(result.total).toBe(700);
		expect(result.cards[0]!.amount).toBe(0);
	});

	it("keeps the existing first-row tie break for duplicate observation dates", () => {
		const result = closedCardBalances({
			cards: [cards[0]!],
			checkpoints: [
				...checkpoints,
				{ AccountId: "a", Date: "2026-10-19", Balance: -999 },
			],
			cycleEnd: "2026-10-19",
		});
		expect(result.total).toBe(500);
	});
});
