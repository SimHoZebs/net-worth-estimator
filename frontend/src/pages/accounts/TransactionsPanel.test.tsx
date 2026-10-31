import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import type { Transaction } from "../../domain/model.ts";
import { TransactionsPanel } from "./TransactionsPanel.tsx";

afterEach(cleanup);

function syncRow(overrides: Partial<Transaction>): Transaction {
	return {
		id: "01900000-0000-7000-8000-000000000031",
		name: "Mock Corner Store",
		amount: 42.1,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		frequency: "once",
		startDate: "2026-09-25",
		endDate: null,
		annualIncrease: 0,
		enabled: false,
		readOnly: true,
		claimRuleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		pending: false,
		void: false,
		syncOwned: true,
		...overrides,
	} as Transaction;
}

function showBadges(transaction: Transaction) {
	render(
		<TransactionsPanel
			transactions={[transaction]}
			accounts={financialModelFixture.accounts}
			startDate={financialModelFixture.startDate}
			readOnly
		/>,
	);
}

it("marks a void bank hold as did-not-post instead of excluded", () => {
	showBadges(syncRow({ void: true }));
	expect(screen.getByText("Did not post")).toBeTruthy();
	expect(screen.queryByText("Excluded")).toBeNull();
});

it("marks a pending bank charge as pending instead of excluded", () => {
	showBadges(syncRow({ pending: true }));
	expect(screen.getByText("Pending")).toBeTruthy();
	expect(screen.queryByText("Excluded")).toBeNull();
});

it("marks an owner-disabled settled bank row as excluded", () => {
	showBadges(syncRow({}));
	expect(screen.getByText("Excluded")).toBeTruthy();
});

it("shows no badge on an enabled settled bank row", () => {
	showBadges(syncRow({ enabled: true }));
	expect(screen.queryByText("Did not post")).toBeNull();
	expect(screen.queryByText("Pending")).toBeNull();
	expect(screen.queryByText("Excluded")).toBeNull();
});

it("marks an owner-disabled manual row as excluded", () => {
	showBadges(syncRow({ syncOwned: false, readOnly: false }));
	expect(screen.getByText("Excluded")).toBeTruthy();
});
