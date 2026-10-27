import { useMemo } from "react";
import type { BackendCheckpoint } from "../../../api/contracts.ts";
import { accountTransactions } from "../../../domain/accountActivity.ts";
import {
	cycleSpentSoFar,
	cycleOutflowTransactions,
	resolveStatementCycle,
} from "../../../domain/cardCycle.ts";
import { shiftDate } from "../../../domain/format.ts";
import { closedCardBalances } from "../../../domain/closedCardBalances.ts";
import type { Plan } from "../../../domain/model.ts";
import type { Projection } from "../../../domain/result.ts";
import {
	sortTransactionsByDate,
	type TransactionOrder,
} from "../../../domain/transactionSort.ts";
import type {
	SafeSpendingChargeCycle,
	SafeSpendingCycleTab,
} from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

export function useCardCycleActivity({
	plan,
	checkpoints,
	projection,
	cards,
	trackedIds,
	statementDay,
	displayToday,
	transactionOrder,
}: {
	plan: Plan;
	checkpoints: BackendCheckpoint[];
	projection: Projection | null;
	cards: { id: string; name: string }[];
	trackedIds: string[];
	statementDay: number;
	displayToday: string;
	transactionOrder: TransactionOrder;
}) {
	const { cycle, closedCycle, perAccount } = useMemo(() => {
		const cycle = resolveStatementCycle({
			todayIso: displayToday,
			statementDay,
		});
		const closed = resolveStatementCycle({
			todayIso: shiftDate({ date: cycle.cycleStart, days: -1 }),
			statementDay,
		});
		const perAccount = !projection
			? []
			: trackedIds.map((accountId) => {
					const transactions = accountTransactions({
						accountId,
						plan,
						projection,
					});
					return {
						accountId,
						name:
							cards.find((card) => card.id === accountId)?.name ?? accountId,
						derived: cycleSpentSoFar({
							transactions,
							cycleStart: cycle.cycleStart,
							todayIso: displayToday,
						}),
						inCycle: cycleOutflowTransactions({
							transactions,
							cycleStart: cycle.cycleStart,
							todayIso: displayToday,
						}),
						lastCycle: cycleOutflowTransactions({
							transactions,
							cycleStart: closed.cycleStart,
							todayIso: closed.cycleEnd,
						}),
					};
				});
		return {
			cycle,
			closedCycle: {
				start: closed.cycleStart,
				end: closed.cycleEnd,
				...closedCardBalances({
					checkpoints,
					cards: trackedIds.map((id) => ({
						id,
						name: cards.find((card) => card.id === id)?.name ?? id,
					})),
					cycleEnd: closed.cycleEnd,
				}),
			},
			perAccount,
		};
	}, [
		plan,
		checkpoints,
		projection,
		cards,
		trackedIds,
		statementDay,
		displayToday,
	]);
	const chargeCycles = useMemo<
		Record<SafeSpendingCycleTab, SafeSpendingChargeCycle>
	>(() => {
		const sort = (items: SafeSpendingChargeCycle["transactions"]) =>
			sortTransactionsByDate({
				items,
				getDate: (transaction) => transaction.date,
				getId: (transaction) => transaction.id,
				order: transactionOrder,
			});
		return {
			cycle: {
				start: cycle.cycleStart,
				end: cycle.cycleEnd,
				title: labels.recordedCharges,
				emptyMessage: "No recorded card charges in this cycle yet.",
				transactions: sort(perAccount.flatMap((item) => item.inCycle)),
			},
			"last-cycle": {
				start: closedCycle.start,
				end: closedCycle.end,
				title: labels.recordedCharges,
				emptyMessage: "No recorded card charges in last cycle.",
				showTotal: true,
				transactions: sort(perAccount.flatMap((item) => item.lastCycle)),
			},
		};
	}, [cycle, closedCycle, perAccount, transactionOrder]);
	return { cycle, closedCycle, perAccount, chargeCycles };
}
