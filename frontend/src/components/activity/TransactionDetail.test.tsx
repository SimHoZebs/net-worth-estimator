import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { testPlan } from "../../mocks/plan.ts";
import { acceptTestResource } from "../../mocks/resource.ts";
import { stubTestServer } from "../../mocks/waypointServer.ts";
import { resetServerQueryCache } from "../../state/serverQuery.ts";
import { resetWorkspaceStore } from "../../state/workspaceStore.ts";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { ruleTransaction } from "../../domain/accountActivity.ts";
import { TransactionDetail } from "./TransactionDetail.tsx";

function calculatedTransaction() {
	return {
		...testPlan.transactions[0]!,
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
	window.HTMLDialogElement.prototype.showModal = function (
		this: HTMLDialogElement,
	) {
		this.setAttribute("open", "");
	};
	window.HTMLDialogElement.prototype.close = function (
		this: HTMLDialogElement,
	) {
		this.removeAttribute("open");
	};
	acceptTestResource();
	resetWorkspaceStore();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

it("shows the resolved figure with a single Calculated label", () => {
	const planTransaction = calculatedTransaction();
	const plan = { ...testPlan, transactions: [planTransaction] };
	render(
		<TransactionDetail
			transaction={ruleTransaction({
				transaction: planTransaction,
				plan,
				resolved: { amount: 2881, requested: 2881, date: "2026-10-31" },
			})}
			planTransaction={planTransaction}
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
	const planTransaction = calculatedTransaction();
	const plan = { ...testPlan, transactions: [planTransaction] };
	render(
		<TransactionDetail
			transaction={ruleTransaction({ transaction: planTransaction, plan })}
			planTransaction={planTransaction}
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
	const planTransaction = calculatedTransaction();
	const transaction: AccountTransaction = {
		id: "projected-sapphire-payoff-2026-10-31-0",
		movementId: planTransaction.id,
		date: "2026-10-31",
		name: planTransaction.name,
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
			planTransaction={planTransaction}
			accounts={testPlan.accounts}
			plan={{ ...testPlan, transactions: [planTransaction] }}
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

it("deletes the transaction through the row endpoint", async () => {
	const server = stubTestServer();
	const planTransaction = {
		...testPlan.transactions[0]!,
		id: "renovation-once",
		name: "Home renovation",
		frequency: "once" as const,
		amountKnown: true,
		readOnly: false,
	};
	const plan = { ...testPlan, transactions: [planTransaction] };
	const onClose = vi.fn();
	render(
		<TransactionDetail
			transaction={ruleTransaction({ transaction: planTransaction, plan })}
			planTransaction={planTransaction}
			accounts={testPlan.accounts}
			plan={plan}
			claimRuleName={null}
			onClose={onClose}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Delete transaction" }));
	const confirm = screen.getByRole("dialog", {
		name: "Delete Home renovation?",
	});
	fireEvent.click(
		within(confirm).getByRole("button", { name: "Delete transaction" }),
	);
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) =>
					call.method === "DELETE" &&
					call.url === "/v1/postings/renovation-once",
			),
		).toBe(true),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("marks holds that did not post instead of posted", () => {
	const planTransaction = {
		...testPlan.transactions[0]!,
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
		movementId: planTransaction.id,
		date: "2026-10-20",
		name: planTransaction.name,
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
			planTransaction={planTransaction}
			accounts={testPlan.accounts}
			plan={{ ...testPlan, transactions: [planTransaction] }}
			claimRuleName={null}
			onClose={() => {}}
		/>,
	);
	expect(screen.getByText("Did not post")).toBeTruthy();
	expect(screen.getByText("bank hold that did not post")).toBeTruthy();
	expect(screen.queryByText("Posted")).toBeNull();
	expect(screen.queryByText("Pending")).toBeNull();
});
