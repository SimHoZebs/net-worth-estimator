import { useMemo } from "react";
import {
	balanceRowToDisplay,
	plannedPurchaseRowToDisplay,
} from "../api/adapter.ts";
import { transactionToDisplay } from "../domain/transactionRows.ts";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import type {
	Account,
	Evaluation,
	PlannedPurchase,
	Transaction,
} from "../domain/model.ts";
import { summaryEvaluations } from "./evaluationQueries.ts";
import { projectionStartDateFromRows } from "./projectionSource.ts";
import {
	useAccountBalances,
	useCheckpoints,
	useEvaluationSummary,
	usePlannedPurchases,
	useSchedules,
	useTransactions,
} from "./workspaceResources.ts";

/**
 * Saved rows for display, one hook per resource. Each hook returns null
 * while its query has no data (not loaded) and a possibly empty array once
 * loaded. Accounts come from balance rows, transactions from the transaction
 * query, evaluations from the evaluation summary, and purchases and the
 * start date from the saved financial model.
 *
 * Outputs are referentially stable for unchanged query data: selection and
 * form memos plus effects can depend on them without re-running every
 * render.
 */

/** Saved balance rows as display accounts. */
export function useSavedAccounts(): Account[] | null {
	const balances = useAccountBalances().data;
	return useMemo(
		() => (balances ? balances.accounts.map(balanceRowToDisplay) : null),
		[balances],
	);
}

/** Saved transaction query rows as display transactions. */
export function useSavedTransactions(): Transaction[] | null {
	const list = useTransactions().data;
	return useMemo(
		() =>
			list ? list.transactions.map((row) => transactionToDisplay(row)) : null,
		[list],
	);
}

/**
 * Saved recurrence rules as the canonical rule rows. They are not display
 * transactions; callers that need the shared row views map them through
 * scheduleToDisplay and read cadence directly from the rule.
 */
export function useSavedSchedules(): Schedule[] | null {
	const list = useSchedules().data;
	return useMemo(() => (list ? list.schedules : null), [list]);
}

/** Saved evaluation summary rows as display evaluations. */
export function useSavedEvaluations(): Evaluation[] | null {
	const summary = useEvaluationSummary().data;
	return useMemo(
		() => (summary ? summaryEvaluations(summary) : null),
		[summary],
	);
}

/** Saved purchases as display rows. */
export function useSavedPurchases(): PlannedPurchase[] | null {
	const list = usePlannedPurchases().data;
	return useMemo(() => {
		if (!list) return null;
		return [...list.plannedPurchases]
			.sort((left, right) => left.priority - right.priority)
			.map(plannedPurchaseRowToDisplay);
	}, [list]);
}

/** Saved projection start date from the narrow row queries. */
export function useSavedStartDate(): string | null {
	const checkpoints = useCheckpoints().data?.checkpoints ?? null;
	const schedules = useSavedSchedules();
	const transactions = useSavedTransactions();
	return useMemo(() => {
		if (checkpoints === null || schedules === null || transactions === null)
			return null;
		return projectionStartDateFromRows({
			checkpoints,
			schedules,
			transactions,
		});
	}, [checkpoints, schedules, transactions]);
}
