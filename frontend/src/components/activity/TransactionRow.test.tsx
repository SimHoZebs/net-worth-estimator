import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import type { Movement } from "../../domain/model.ts";
import { TransactionRow } from "./TransactionRow.tsx";

afterEach(cleanup);

function voidTransaction(): {
	transaction: AccountTransaction;
	movement: Movement;
} {
	const movement = {
		id: "01900000-0000-7000-8000-000000000099",
		name: "Hold that did not post",
		amount: 42.1,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		frequency: "once" as const,
		startDate: "2026-10-20",
		endDate: null,
		annualIncrease: 0,
		enabled: false,
		readOnly: true,
		claimRuleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		pending: false,
		void: true,
	} as Movement;
	const transaction: AccountTransaction = {
		id: "recorded-01900000-0000-7000-8000-000000000099",
		movementId: movement.id,
		date: "2026-10-20",
		name: movement.name,
		source: "historical",
		direction: "out",
		category: "expense",
		counterparty: "Unknown account",
		from: "Everyday checking",
		to: "External spending",
		amount: 42.1,
		requested: 42.1,
		shortfall: 0,
		constraint: null,
		excluded: true,
		pending: false,
		void: true,
	};
	return { transaction, movement };
}

it("marks holds that did not post instead of pending", () => {
	const { transaction, movement } = voidTransaction();
	render(
		<TransactionRow
			transaction={transaction}
			movement={movement}
			onEdit={() => {}}
		/>,
	);
	expect(screen.getByText("Did not post")).toBeTruthy();
	expect(screen.queryByText("Pending")).toBeNull();
	expect(screen.getByText("bank hold that did not post")).toBeTruthy();
	expect(screen.getByRole("button", { name: /did not post/i })).toBeTruthy();
});

it("does not render any badge without status", () => {
	const { transaction, movement } = voidTransaction();
	render(
		<TransactionRow
			transaction={{ ...transaction, void: false }}
			movement={movement}
			onEdit={() => {}}
		/>,
	);
	expect(screen.queryByText("Did not post")).toBeNull();
});
