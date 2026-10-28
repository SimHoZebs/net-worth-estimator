import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { testPlan } from "../../mocks/plan.ts";
import { acceptTestResource } from "../../mocks/resource.ts";
import { resetWorkspaceStore } from "../../state/workspaceStore.ts";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { movementRuleTransaction } from "../../domain/accountActivity.ts";
import { TransactionDetail } from "./TransactionDetail.tsx";

function calculatedMovement() {
	return {
		...testPlan.movements[0]!,
		id: "sapphire-payoff",
		name: "Sapphire Statement Payoff",
		amount: 0,
		amountKnown: false,
		fromId: "checking",
		toId: "mortgage",
		frequency: "monthly" as const,
		startDate: "2026-10-31",
		endDate: null,
		annualIncrease: 0,
		enabled: true,
		readOnly: true,
		claimRuleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
	};
}

beforeEach(() => {
	if (!window.HTMLDialogElement.prototype.showModal) {
		window.HTMLDialogElement.prototype.showModal = function () {};
	}
	if (!window.HTMLDialogElement.prototype.close) {
		window.HTMLDialogElement.prototype.close = function () {};
	}
	acceptTestResource();
	resetWorkspaceStore();
});

afterEach(() => {
	cleanup();
	resetWorkspaceStore();
});

it("shows the resolved figure with a single Calculated label", () => {
	const movement = calculatedMovement();
	const plan = { ...testPlan, movements: [movement] };
	render(
		<TransactionDetail
			transaction={movementRuleTransaction({
				movement,
				plan,
				resolved: { amount: 2881, requested: 2881, date: "2026-10-31" },
			})}
			movement={movement}
			accounts={testPlan.accounts}
			plan={plan}
			claimRuleName={null}
			onClose={() => {}}
		/>,
	);
	expect(
		(screen.getByLabelText("Amount (USD)") as HTMLInputElement).value,
	).toBe("2881");
	expect(screen.getByText("Calculated")).toBeTruthy();
	expect(screen.queryByText("Varies")).toBeNull();
	expect(screen.queryByText("Per occurrence")).toBeNull();
	expect(screen.queryByText(/calculated each time/i)).toBeNull();
	expect(screen.queryByText(/Varies each occurrence/)).toBeNull();
});

it("shows only the Calculated label when no resolved amount exists", () => {
	const movement = calculatedMovement();
	const plan = { ...testPlan, movements: [movement] };
	render(
		<TransactionDetail
			transaction={movementRuleTransaction({ movement, plan })}
			movement={movement}
			accounts={testPlan.accounts}
			plan={plan}
			claimRuleName={null}
			onClose={() => {}}
		/>,
	);
	expect(screen.queryByLabelText("Amount (USD)")).toBeNull();
	expect(screen.getByText("Calculated")).toBeTruthy();
	expect(screen.queryByText("Varies")).toBeNull();
});

it("shows the resolved occurrence amount with a Calculated label", () => {
	const movement = calculatedMovement();
	const transaction: AccountTransaction = {
		id: "projected-sapphire-payoff-2026-10-31-0",
		movementId: movement.id,
		date: "2026-10-31",
		name: movement.name,
		source: "projected",
		direction: "out",
		category: "transfer",
		counterparty: "Sapphire",
		from: "Everyday checking",
		to: "Home mortgage",
		amount: 2881,
		requested: 2881,
		shortfall: 0,
		constraint: null,
		excluded: false,
		pending: false,
		void: false,
	};
	render(
		<TransactionDetail
			transaction={transaction}
			movement={movement}
			accounts={testPlan.accounts}
			plan={{ ...testPlan, movements: [movement] }}
			claimRuleName={null}
			onClose={() => {}}
		/>,
	);
	const amount = screen.getByLabelText("Amount (USD)") as HTMLInputElement;
	expect(amount.value).toBe("2881");
	expect(amount.readOnly).toBe(true);
	expect(screen.getByText("Calculated")).toBeTruthy();
	expect(screen.queryByText("Varies")).toBeNull();
	expect(screen.queryByText(/calculated each time/i)).toBeNull();
});

it("marks holds that did not post instead of posted", () => {
	const movement = {
		...testPlan.movements[0]!,
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
	};
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
	render(
		<TransactionDetail
			transaction={transaction}
			movement={movement}
			accounts={testPlan.accounts}
			plan={{ ...testPlan, movements: [movement] }}
			claimRuleName={null}
			onClose={() => {}}
		/>,
	);
	expect(screen.getByText("Did not post")).toBeTruthy();
	expect(screen.getByText("bank hold that did not post")).toBeTruthy();
	expect(screen.queryByText("Posted")).toBeNull();
	expect(screen.queryByText("Pending")).toBeNull();
});
