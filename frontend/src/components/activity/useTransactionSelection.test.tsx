import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { testPlan } from "../../mocks/plan.ts";
import { useTransactionSelection } from "./useTransactionSelection.ts";

afterEach(cleanup);

it("keeps only identity and resolves refreshed records until removal", () => {
	const movement = testPlan.movements[0]!;
	const transaction = {
		id: "occurrence",
		movementId: movement.id,
		amount: 10,
	} as AccountTransaction;
	const view = renderHook(
		({ transaction, movement }) =>
			useTransactionSelection(
				transaction ? [transaction] : [],
				new Map(movement ? [[movement.id, movement]] : []),
			),
		{
			initialProps: {
				transaction: transaction as AccountTransaction | null,
				movement: movement as typeof movement | null,
			},
		},
	);
	act(() => view.result.current.inspect(transaction));
	view.rerender({
		transaction: { ...transaction, amount: 20 },
		movement: { ...movement, name: "Current name" },
	});
	expect(view.result.current.selected?.transaction.amount).toBe(20);
	expect(view.result.current.selected?.movement.name).toBe("Current name");
	view.rerender({ transaction: null, movement });
	expect(view.result.current.selected).toBeNull();
	view.rerender({ transaction, movement });
	expect(view.result.current.selected).toBeNull();
});
