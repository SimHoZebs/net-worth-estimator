import { describe, expect, it } from "vitest";
import type { BackendCheckpoint } from "../api/contracts.ts";
import { closedCardBalances } from "./closedCardBalances.ts";

const cards = [
	{ id: "a", name: "Card A" },
	{ id: "b", name: "Card B" },
];
const checkpoints: BackendCheckpoint[] = [
	{ AccountId: "a", Balance: -900, observedAt: 1792627199 },
	{ AccountId: "b", Balance: -700, observedAt: 1792454399 },
	{ AccountId: "a", Balance: -100, observedAt: 1790985599 },
	{ AccountId: "a", Balance: -500, observedAt: 1792454399 },
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
				{ AccountId: "a", Balance: 25, observedAt: 1792454399 },
				checkpoints[1]!,
			],
			cycleEnd: "2026-10-19",
		});
		expect(result.total).toBe(700);
		expect(result.cards[0]!.amount).toBe(0);
	});

	it("lets the later row win duplicate observation instants", () => {
		// Same-instant, same-authorship ties resolve to the later row,
		// mirroring the backend replay's stable overwrite. Owner rows win
		// over sync rows regardless of order (see checkpoints.test.ts).
		const result = closedCardBalances({
			cards: [cards[0]!],
			checkpoints: [
				...checkpoints,
				{ AccountId: "a", Balance: -999, observedAt: 1792454399 },
			],
			cycleEnd: "2026-10-19",
		});
		expect(result.total).toBe(999);
	});
});
