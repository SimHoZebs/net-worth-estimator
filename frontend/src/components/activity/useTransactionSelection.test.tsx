import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { useTransactionSelection } from "./useTransactionSelection.ts";

afterEach(cleanup);

it("keeps only identity and resolves refreshed records until removal", () => {
	const planTransaction = financialModelFixture.transactions[0]!;
	const transaction = {
		id: "occurrence",
		transactionId: planTransaction.id,
		amount: 10,
	} as AccountTransaction;
	const view = renderHook(
		({ transaction, planTransaction }) =>
			useTransactionSelection(
				transaction ? [transaction] : [],
				new Map(planTransaction ? [[planTransaction.id, planTransaction]] : []),
			),
		{
			initialProps: {
				transaction: transaction as AccountTransaction | null,
				planTransaction: planTransaction as typeof planTransaction | null,
			},
		},
	);
	act(() => view.result.current.inspect(transaction));
	view.rerender({
		transaction: { ...transaction, amount: 20 },
		planTransaction: { ...planTransaction, name: "Current name" },
	});
	expect(view.result.current.selected?.transaction.amount).toBe(20);
	expect(view.result.current.selected?.planTransaction.name).toBe(
		"Current name",
	);
	view.rerender({ transaction: null, planTransaction });
	expect(view.result.current.selected).toBeNull();
	view.rerender({ transaction, planTransaction });
	expect(view.result.current.selected).toBeNull();
});
