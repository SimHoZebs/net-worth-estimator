import { useMemo } from "react";
import {
	balanceRowToDisplay,
	savedPurchasesToDisplay,
} from "../api/adapter.ts";
import { transactionToDisplay } from "../domain/transactionRows.ts";
import type {
	Account,
	Evaluation,
	PlannedPurchase,
	Transaction,
} from "../domain/model.ts";
import { summaryEvaluations } from "./evaluationQueries.ts";
import { projectionStartDate } from "./projectionStartDate.ts";
import {
	useAccountBalances,
	useEvaluationSummary,
	useServerModel,
	useTransactions,
} from "./workspaceResources.ts";

/**
 * Saved rows for display, one hook per resource. Each hook returns null
 * while its query has no data (not loaded) and a possibly empty array once
 * loaded. The hooks never assemble a whole model: accounts come from the
 * balance rows, transactions from the transaction query, evaluations from
 * the eval summary, purchases from the standalone rows plus the legacy
 * purchase-marker postings in the canonical document, and the start date
 * from the canonical document.
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

/** Saved evaluation summary rows as display evaluations. */
export function useSavedEvaluations(): Evaluation[] | null {
	const summary = useEvaluationSummary().data;
	return useMemo(
		() => (summary ? summaryEvaluations(summary) : null),
		[summary],
	);
}

/** Saved purchases as display rows, standalone or legacy posting form. */
export function useSavedPurchases(): PlannedPurchase[] | null {
	const document = useServerModel({ enabled: true }).data?.document;
	return useMemo(() => {
		if (document === undefined) return null;
		return savedPurchasesToDisplay(document);
	}, [document]);
}

/** Saved projection start date from the canonical document. */
export function useSavedStartDate(): string | null {
	const document = useServerModel({ enabled: true }).data?.document;
	return useMemo(
		() => (document ? projectionStartDate(document) : null),
		[document],
	);
}
