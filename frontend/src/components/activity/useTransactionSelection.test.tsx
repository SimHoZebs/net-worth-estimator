import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { useTransactionSelection } from "./useTransactionSelection.ts";

afterEach(cleanup);

it("keeps only identity and resolves refreshed records until removal", () => {
	const savedTransaction = financialModelFixture.transactions[0]!;
	const transaction = {
		id: "occurrence",
		transactionId: savedTransaction.id,
		amount: 10,
	} as AccountTransaction;
	const view = renderHook(
		({ transaction, savedTransaction }) =>
			useTransactionSelection(
				transaction ? [transaction] : [],
				new Map(
					savedTransaction ? [[savedTransaction.id, savedTransaction]] : [],
				),
			),
		{
			initialProps: {
				transaction: transaction as AccountTransaction | null,
				savedTransaction: savedTransaction as typeof savedTransaction | null,
			},
		},
	);
	act(() => view.result.current.inspect(transaction));
	view.rerender({
		transaction: { ...transaction, amount: 20 },
		savedTransaction: { ...savedTransaction, name: "Current name" },
	});
	expect(view.result.current.selected?.transaction.amount).toBe(20);
	expect(view.result.current.selected?.savedTransaction.name).toBe(
		"Current name",
	);
	view.rerender({ transaction: null, savedTransaction });
	expect(view.result.current.selected).toBeNull();
	view.rerender({ transaction, savedTransaction });
	expect(view.result.current.selected).toBeNull();
});
