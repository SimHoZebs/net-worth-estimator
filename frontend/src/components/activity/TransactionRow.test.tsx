import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import type { Transaction } from "../../domain/model.ts";
import { TransactionRow } from "./TransactionRow.tsx";

function voidTransaction(): {
	transaction: AccountTransaction;
	savedTransaction: Transaction;
} {
	const savedTransaction = {
		id: "01900000-0000-7000-8000-000000000099",
		name: "Hold that did not post",
		amount: 42.1,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "transaction" as const,
		startDate: "2026-10-20",
		endDate: null,
		annualIncrease: 0,
		enabled: false,
		readOnly: true,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		pending: false,
		void: true,
	} as Transaction;
	const transaction: AccountTransaction = {
		id: "recorded-01900000-0000-7000-8000-000000000099",
		transactionId: savedTransaction.id,
		date: "2026-10-20",
		name: savedTransaction.name,
		source: "historical",
		direction: "out",
		flow: "expense",
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
	return { transaction, savedTransaction };
}

it("marks holds that did not post instead of pending", () => {
	const { transaction, savedTransaction } = voidTransaction();
	render(
		<TransactionRow
			transaction={transaction}
			savedTransaction={savedTransaction}
			onEdit={() => {}}
		/>,
	);
	expect(screen.getByText("Did not post")).toBeTruthy();
	expect(screen.queryByText("Pending")).toBeNull();
	expect(screen.getByText("bank hold that did not post")).toBeTruthy();
	expect(screen.getByRole("button", { name: /did not post/i })).toBeTruthy();
});

it("puts the pending chip below the amount, outside the title button", () => {
	const { transaction, savedTransaction } = voidTransaction();
	render(
		<TransactionRow
			transaction={{
				...transaction,
				void: false,
				excluded: false,
				pending: true,
				name: "Groceries",
			}}
			savedTransaction={{
				...savedTransaction,
				void: false,
				pending: true,
				name: "Groceries",
			}}
			onEdit={() => {}}
		/>,
	);
	const pending = screen.getByText("Pending");
	expect(pending).toBeTruthy();
	const button = screen.getByRole("button", { name: /groceries/i });
	expect(button.contains(pending)).toBe(false);
	expect(button.textContent).not.toContain("Pending");
	const row = screen.getByRole("row");
	expect(row.contains(pending)).toBe(true);
});

it("does not render any badge without status", () => {
	const { transaction, savedTransaction } = voidTransaction();
	render(
		<TransactionRow
			transaction={{ ...transaction, void: false }}
			savedTransaction={savedTransaction}
			onEdit={() => {}}
		/>,
	);
	expect(screen.queryByText("Did not post")).toBeNull();
});

it("tints an unfulfilled row and names the shortfall", () => {
	const { transaction, savedTransaction } = voidTransaction();
	render(
		<TransactionRow
			transaction={{
				...transaction,
				void: false,
				excluded: false,
				shortfall: 100,
				requested: 142.1,
			}}
			savedTransaction={savedTransaction}
			onEdit={() => {}}
			shortfall
			shortfallLabel="Unfulfilled"
		/>,
	);
	const row = screen.getByRole("row");
	expect(row.className).toContain("bg-warning-bg");
	expect(row.className).toContain("border-warning-text");
	expect(screen.getByText("Unfulfilled")).toBeTruthy();
	expect(screen.getByText("$142.10 planned")).toBeTruthy();
	expect(screen.getByText("−$42.10").className).toContain("text-warning-text");
});
