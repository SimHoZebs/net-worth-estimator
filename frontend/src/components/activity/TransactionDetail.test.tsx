import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { fixtureModel } from "../../mocks/model.ts";
import { acceptTestResource } from "../../mocks/resource.ts";
import { stubTestServer } from "../../mocks/waypointServer.ts";
import { setServerModelFixture } from "../../mocks/workspace.ts";
import { resetServerQueryCache } from "../../state/serverQuery.ts";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { ruleTransaction } from "../../domain/accountActivity.ts";
import type { Transaction } from "../../domain/model.ts";
import { TransactionDetail } from "./TransactionDetail.tsx";

// Saved-row occurrence adapter for tests.
function occurrence(
	transaction: Transaction,
	resolved?: { amount: number; requested: number; date: string },
) {
	return ruleTransaction({
		transaction,
		accounts: financialModelFixture.accounts,
		startDate: financialModelFixture.startDate,
		...(resolved ? { resolved } : {}),
	});
}

function calculatedTransaction() {
	return {
		...financialModelFixture.transactions[0]!,
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
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

it("shows the resolved figure with a single Calculated label", () => {
	const savedTransaction = calculatedTransaction();
	render(
		<TransactionDetail
			transaction={occurrence(savedTransaction, {
				amount: 2881,
				requested: 2881,
				date: "2026-10-31",
			})}
			savedTransaction={savedTransaction}
			accounts={financialModelFixture.accounts}
			transactions={[savedTransaction]}
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
	const savedTransaction = calculatedTransaction();
	render(
		<TransactionDetail
			transaction={occurrence(savedTransaction)}
			savedTransaction={savedTransaction}
			accounts={financialModelFixture.accounts}
			transactions={[savedTransaction]}
			onClose={() => {}}
		/>,
	);
	expect(screen.queryByLabelText("Amount (USD)")).toBeNull();
	expect(screen.getByText("Calculated")).toBeTruthy();
	expect(screen.queryByText("Varies")).toBeNull();
});

it("shows the resolved occurrence amount with a Calculated label", () => {
	const savedTransaction = calculatedTransaction();
	const transaction: AccountTransaction = {
		id: "projected-sapphire-payoff-2026-10-31-0",
		transactionId: savedTransaction.id,
		date: "2026-10-31",
		name: savedTransaction.name,
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
			savedTransaction={savedTransaction}
			accounts={financialModelFixture.accounts}
			transactions={[savedTransaction]}
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
	const savedTransaction = {
		...financialModelFixture.transactions[0]!,
		id: "renovation-once",
		name: "Home renovation",
		frequency: "once" as const,
		amountKnown: true,
		readOnly: false,
	};
	const onClose = vi.fn();
	render(
		<TransactionDetail
			transaction={occurrence(savedTransaction)}
			savedTransaction={savedTransaction}
			accounts={financialModelFixture.accounts}
			transactions={[savedTransaction]}
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
	const savedTransaction = {
		...financialModelFixture.transactions[0]!,
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
		transactionId: savedTransaction.id,
		date: "2026-10-20",
		name: savedTransaction.name,
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
		excluded: false,
		pending: false,
		void: true,
	};
	render(
		<TransactionDetail
			transaction={transaction}
			savedTransaction={savedTransaction}
			accounts={financialModelFixture.accounts}
			transactions={[savedTransaction]}
			onClose={() => {}}
		/>,
	);
	expect(screen.getByText("Did not post")).toBeTruthy();
	expect(screen.getByText("bank hold that did not post")).toBeTruthy();
	expect(screen.queryByText("Posted")).toBeNull();
	expect(screen.queryByText("Pending")).toBeNull();
	expect(screen.queryByText("Excluded")).toBeNull();
});

it("marks a live hold as not yet posted", () => {
	const savedTransaction = {
		...financialModelFixture.transactions[0]!,
		id: "01900000-0000-7000-8000-000000000098",
		name: "Live hold",
		amount: 18.5,
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
		pending: true,
		void: false,
	};
	const transaction: AccountTransaction = {
		id: "recorded-01900000-0000-7000-8000-000000000098",
		transactionId: savedTransaction.id,
		date: "2026-10-20",
		name: savedTransaction.name,
		source: "historical",
		direction: "out",
		category: "expense",
		counterparty: "Unknown account",
		from: "Everyday checking",
		to: "External spending",
		amount: 18.5,
		requested: 18.5,
		shortfall: 0,
		constraint: null,
		excluded: false,
		pending: true,
		void: false,
	};
	render(
		<TransactionDetail
			transaction={transaction}
			savedTransaction={savedTransaction}
			accounts={financialModelFixture.accounts}
			transactions={[savedTransaction]}
			onClose={() => {}}
		/>,
	);
	expect(screen.getByText("Pending")).toBeTruthy();
	expect(screen.getByText("Not yet posted")).toBeTruthy();
	expect(screen.queryByText("Excluded")).toBeNull();
});

it("saves row edits through the posting endpoint and closes", async () => {
	// Raw row carries server shapes the display never shows: non-midnight
	// seconds that a date-unchanged save must keep verbatim.
	const model = fixtureModel(financialModelFixture);
	const day = Math.floor(Date.parse("2028-06-15T00:00:00Z") / 1000);
	const raw = model.postings.find((row) => row.id === "renovation")!;
	raw.postedTime = day + 45245;
	raw.transactionTime = day + 123;
	const server = stubTestServer(undefined, model);
	acceptTestResource();
	setServerModelFixture(financialModelFixture, { model });
	const savedTransaction = financialModelFixture.transactions.find(
		(item) => item.id === "renovation",
	)!;
	const baselinePostedDate = ruleTransaction({
		transaction: savedTransaction,
		accounts: financialModelFixture.accounts,
		startDate: financialModelFixture.startDate,
	}).date;
	expect(baselinePostedDate).toBe("2028-06-15");
	const onClose = vi.fn();
	render(
		<TransactionDetail
			transaction={occurrence(savedTransaction)}
			savedTransaction={savedTransaction}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			onClose={onClose}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Transaction name"), {
		target: { value: "Home renovation updated" },
	});
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy(),
	);
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) =>
					call.method === "PATCH" && call.url === "/v1/postings/renovation",
			),
		).toBe(true),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	const body = server.calls.find(
		(call) => call.method === "PATCH" && call.url === "/v1/postings/renovation",
	)?.body as Record<string, unknown>;
	expect(body.name).toBe("Home renovation updated");
	// Dates unchanged: exact stored seconds survive instead of midnight.
	expect(body.postedTime).toBe(day + 45245);
	expect(body.transactionTime).toBe(day + 123);
	// No wishlist link on this row, and the editor models none: the body
	// must not invent one.
	expect(body.purchase).toBeUndefined();
});

it("converts a subscription through row endpoints and preserves the source posting", async () => {
	const model = fixtureModel(financialModelFixture);
	const server = stubTestServer(undefined, model);
	acceptTestResource();
	setServerModelFixture(financialModelFixture, { model });
	const savedTransaction = financialModelFixture.transactions.find(
		(item) => item.id === "renovation",
	)!;
	const onClose = vi.fn();
	render(
		<TransactionDetail
			transaction={occurrence(savedTransaction)}
			savedTransaction={savedTransaction}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			onClose={onClose}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Mark as subscription" }));
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) => call.method === "POST" && call.url === "/v1/recurrence-rules",
			),
		).toBe(true),
	);
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) =>
					call.method === "PATCH" && call.url === "/v1/postings/renovation",
			),
		).toBe(true),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	// The source posting is claimed, never deleted.
	expect(
		server.calls.some(
			(call) =>
				call.method === "DELETE" && String(call.url).includes("renovation"),
		),
	).toBe(false);
});

it("retries a rejected claim without creating a second rule", async () => {
	// Raw source carries non-midnight times, a custom amount resolver with
	// extra inputs; the claim body must keep
	// all of them byte-identical.
	const model = fixtureModel(financialModelFixture);
	const day = Math.floor(Date.parse("2028-06-15T00:00:00Z") / 1000);
	const raw = model.postings.find((row) => row.id === "renovation")!;
	raw.postedTime = day + 45245;
	raw.transactionTime = day + 123;
	raw.amount = {
		resolver: "custom-split",
		config: { expression: "48000" },
		inputs: {
			extra: {
				source: "provider",
				provider: "fx-rate",
				arguments: { pair: "USD/EUR" },
			},
		},
	};
	const server = stubTestServer(undefined, model);
	acceptTestResource();
	setServerModelFixture(financialModelFixture, { model });
	// Reject the claim write once; the rule create still succeeds.
	server.writeOnce(
		(method, path) => method === "PATCH" && path === "/v1/postings/renovation",
		new Error("The claim could not be saved."),
	);
	const source = financialModelFixture.transactions.find(
		(item) => item.id === "renovation",
	)!;
	const onClose = vi.fn();
	render(
		<TransactionDetail
			transaction={occurrence(source)}
			savedTransaction={source}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			onClose={onClose}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Mark as subscription" }));
	await waitFor(() =>
		expect(screen.getByText(/could not be claimed/)).toBeTruthy(),
	);
	expect(onClose).not.toHaveBeenCalled();
	const ruleCreates = () =>
		server.calls.filter(
			(call) => call.method === "POST" && call.url === "/v1/recurrence-rules",
		);
	expect(ruleCreates()).toHaveLength(1);
	// Retry: the existing rule is reused, only the claim runs again.
	fireEvent.click(screen.getByRole("button", { name: "Mark as subscription" }));
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	expect(ruleCreates()).toHaveLength(1);
	const claims = server.calls.filter(
		(call) => call.method === "PATCH" && call.url === "/v1/postings/renovation",
	);
	expect(claims).toHaveLength(2);
	const claimBody = claims.at(-1)?.body as Record<string, unknown>;
	expect(claimBody.postedTime).toBe(day + 45245);
	expect(claimBody.transactionTime).toBe(day + 123);
	expect(claimBody.amount).toEqual(raw.amount);
	expect(claimBody.purchase).toBeUndefined();
	expect(claimBody.claim).toEqual({
		ruleId: ruleCreates().map((call) => call.body as { id: string })[0]?.id,
		occurrenceDate: "2028-06-15",
	});
});
