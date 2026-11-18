import { useMemo } from "react";
import { accountTransactions } from "../../../domain/accountActivity.ts";
import {
	cycleOutflowTransactions,
	resolveStatementCycleAtOffset,
} from "../../../domain/cardCycle.ts";
import type { Account, Transaction } from "../../../domain/model.ts";
import type { Projection } from "../../../domain/result.ts";

/**
 * The selected statement cycle plus per-account activity in that window.
 * Arrow buttons move the visible window to earlier or later cycles; the
 * single budget path derives every number from this selected window.
 * Cycles resolve even while the projection is pending (perAccount stays
 * empty then).
 */
export function useCardCycleActivity({
	accounts,
	transactions,
	projection,
	cards,
	trackedIds,
	statementDay,
	displayToday,
	cycleOffset,
}: {
	accounts: Account[];
	transactions: Transaction[];
	projection: Projection | null;
	cards: { id: string; name: string }[];
	trackedIds: string[];
	statementDay: number;
	displayToday: string;
	cycleOffset: number;
}) {
	const { selected, perAccount } = useMemo(() => {
		const selected = resolveStatementCycleAtOffset({
			todayIso: displayToday,
			statementDay,
			offset: cycleOffset,
		});
		const todayParam =
			selected.cycleEnd <= displayToday ? selected.cycleEnd : displayToday;
		const cardById = new Map(cards.map((card) => [card.id, card.name]));
		const perAccount = !projection
			? []
			: trackedIds.map((accountId) => {
					const activity = accountTransactions({
						accountId,
						accounts,
						transactions,
						// A saved purchase after the balance checkpoint is still a
						// recorded purchase. Schedules/projections are not actuals.
						startDate: displayToday,
					});
					return {
						accountId,
						name: cardById.get(accountId) ?? accountId,
						selected: cycleOutflowTransactions({
							transactions: activity,
							cycleStart: selected.cycleStart,
							todayIso: todayParam,
						}),
						recorded: activity,
					};
				});
		return { selected, perAccount };
	}, [
		accounts,
		transactions,
		projection,
		cards,
		trackedIds,
		statementDay,
		displayToday,
		cycleOffset,
	]);
	return {
		selected,
		perAccount,
	};
}
