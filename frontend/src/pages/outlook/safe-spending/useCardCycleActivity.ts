import { useMemo } from "react";
import type { BackendCheckpoint } from "../../../api/contracts.ts";
import { accountTransactions } from "../../../domain/accountActivity.ts";
import {
	cycleOutflowTransactions,
	resolveStatementCycle,
	resolveStatementCycleAtOffset,
} from "../../../domain/cardCycle.ts";
import { closedCardBalances } from "../../../domain/closedCardBalances.ts";
import type { Account, Transaction } from "../../../domain/model.ts";
import type { Projection } from "../../../domain/result.ts";
import {
	sortTransactionsByDate,
	type TransactionOrder,
} from "../../../domain/transactionSort.ts";
import type { SafeSpendingChargeCycle } from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

/**
 * The selected statement cycle is unbounded: arrow buttons move the visible
 * window to earlier or later cycles. Only offset 0 shows the live cash-backed
 * budget; any other offset shows recorded-only history with no invented
 * budget. Cycles resolve even while the projection is pending (perAccount
 * stays empty then).
 */
export function useCardCycleActivity({
	accounts,
	transactions,
	checkpoints,
	projection,
	cards,
	trackedIds,
	statementDay,
	displayToday,
	transactionOrder,
	cycleOffset,
}: {
	accounts: Account[];
	transactions: Transaction[];
	checkpoints: BackendCheckpoint[];
	projection: Projection | null;
	cards: { id: string; name: string }[];
	trackedIds: string[];
	statementDay: number;
	displayToday: string;
	transactionOrder: TransactionOrder;
	cycleOffset: number;
}) {
	const { current, previous, selected, selectedBalances, perAccount } =
		useMemo(() => {
			const current = resolveStatementCycle({
				todayIso: displayToday,
				statementDay,
			});
			const previous = resolveStatementCycleAtOffset({
				todayIso: displayToday,
				statementDay,
				offset: -1,
			});
			const selected = resolveStatementCycleAtOffset({
				todayIso: displayToday,
				statementDay,
				offset: cycleOffset,
			});
			const tracked = trackedIds.map((id) => ({
				id,
				name: cards.find((card) => card.id === id)?.name ?? id,
			}));
			const selectedBalances = closedCardBalances({
				checkpoints,
				cards: tracked,
				cycleEnd: selected.cycleEnd,
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
			return { current, previous, selected, selectedBalances, perAccount };
		}, [
			accounts,
			transactions,
			checkpoints,
			projection,
			cards,
			trackedIds,
			statementDay,
			displayToday,
			cycleOffset,
		]);
	const selectedChargeCycle = useMemo<SafeSpendingChargeCycle>(() => {
		const sorted = sortTransactionsByDate({
			items: perAccount.flatMap((item) => item.selected),
			getDate: (transaction) => transaction.date,
			getId: (transaction) => transaction.id,
			order: transactionOrder,
		});
		return {
			start: selected.cycleStart,
			end: selected.cycleEnd,
			title: labels.recordedCharges,
			emptyMessage: "No recorded card charges in this cycle yet.",
			showTotal: true,
			transactions: sorted,
		};
	}, [perAccount, selected, transactionOrder]);
	return {
		current,
		previous,
		selected,
		selectedBalances,
		perAccount,
		selectedChargeCycle,
	};
}
