import { latestCheckpoint } from "../api/checkpoints.ts";
import type { BackendCheckpoint } from "../api/contracts.ts";

export interface ClosedCardBalance {
	id: string;
	name: string;
	amount: number | null;
	observedOn: string | null;
}

export interface ClosedCardBalances {
	total: number | null;
	cards: ClosedCardBalance[];
}

/**
 * Recorded purchases are not a balance ledger: bank sync can update a balance
 * without importing its posted charges. Use saved observations, never an
 * inferred purchase sum or a newer balance that includes the next cycle.
 */
export function closedCardBalances({
	checkpoints,
	cards,
	cycleEnd,
}: {
	checkpoints: readonly BackendCheckpoint[];
	cards: { id: string; name: string }[];
	cycleEnd: string;
}): ClosedCardBalances {
	const balances = cards.map((card) => {
		const checkpoint = latestCheckpoint(checkpoints, card.id, cycleEnd);
		return {
			...card,
			amount: checkpoint ? Math.max(0, -checkpoint.Balance) : null,
			observedOn: checkpoint
				? new Date(checkpoint.observedAt * 1000).toISOString().slice(0, 10)
				: null,
		};
	});
	return {
		cards: balances,
		total: balances.some((card) => card.amount === null)
			? null
			: Math.round(
					balances.reduce((total, card) => total + (card.amount ?? 0), 0) * 100,
				) / 100,
	};
}
