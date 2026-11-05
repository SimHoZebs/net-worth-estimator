import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dialogScope, runInteractions } from "../../mocks/interactions.ts";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { fixtureModel } from "../../mocks/model.ts";
import { acceptTestResource } from "../../mocks/resource.ts";
import { stubTestServer } from "../../mocks/waypointServer.ts";
import {
	setServerModelFixture,
	setServerModelOnly,
} from "../../mocks/workspace.ts";
import {
	resetServerQueryCache,
	serverQueryClient,
} from "../../state/serverQuery.ts";
import { userResourceKey } from "../../state/workspaceResources.ts";
import { getUserScope } from "../../auth/resourceScope.ts";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { scheduleTransaction } from "../../domain/accountActivity.ts";
import type { Transaction } from "../../domain/model.ts";
import { TransactionDetail } from "./TransactionDetail.tsx";

// Saved-row occurrence adapter for tests.
function occurrence(
	transaction: Transaction,
	resolved?: { amount: number; requested: number; date: string },
) {
	return scheduleTransaction({
		transaction,
		accounts: financialModelFixture.accounts,
		startDate: financialModelFixture.startDate,
		...(resolved ? { resolved } : {}),
	});
}

function settleCandidate(transaction: {
	id: string;
	name: string;
	amount: number;
	startDate: string;
	claimScheduleId?: string | null;
	claimOccurrenceDate?: string | null;
}) {
	return {
		postingId: transaction.id,
		name: transaction.name,
		amount: transaction.amount,
		date: transaction.startDate,
		dayGap: 1,
		amountDeltaCents: 800,
		descriptorChanged: false,
		recommended: true,
		claimScheduleId: transaction.claimScheduleId ?? undefined,
		claimOccurrenceDate: transaction.claimOccurrenceDate ?? undefined,
	};
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
		kind: "schedule" as const,
		startDate: "2026-10-31",
		endDate: null,
		annualIncrease: 0,
		enabled: true,
		readOnly: true,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
	};
}

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
	vi.unstubAllGlobals();
	// Collapse exit animations so any stray close settles inside the test
	// that starts it instead of firing into the next file.
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: /prefers-reduced-motion:\s*reduce/.test(query),
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	}));
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
		flow: "transfer",
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
	setServerModelFixture(financialModelFixture);
	const savedTransaction = {
		...financialModelFixture.transactions[0]!,
		id: "renovation-once",
		name: "Home renovation",
		kind: "posting" as const,
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
	fireEvent.click(screen.getByRole("button", { name: "More options" }));
	fireEvent.click(screen.getByRole("menuitem", { name: "Delete transaction" }));
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
					call.url === "/v1/transactions/renovation-once",
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
		kind: "posting" as const,
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
	};
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
	expect(screen.getByText(/vanished without posting/)).toBeTruthy();
	// The details grid keeps a "Posted" section label; only status badges
	// must stay absent. Labels carry the uppercase tracking class.
	expect(
		screen
			.queryAllByText("Posted")
			.filter((node) => !node.className.includes("uppercase")),
	).toHaveLength(0);
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
		kind: "posting" as const,
		startDate: "2026-10-20",
		endDate: null,
		annualIncrease: 0,
		enabled: false,
		readOnly: true,
		claimScheduleId: null,
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
		flow: "expense",
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

it("lets a pending bank row record an occurrence while staying locked", async () => {
	stubTestServer();
	const savedTransaction = {
		...financialModelFixture.transactions[0]!,
		id: "01900000-0000-7000-8000-000000000095",
		name: "Pending rent",
		amount: 1200,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "posting" as const,
		startDate: "2026-10-20",
		endDate: null,
		annualIncrease: 0,
		enabled: false,
		readOnly: true,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		pending: true,
		void: false,
		syncOwned: true,
	};
	render(
		<TransactionDetail
			transaction={occurrence(savedTransaction)}
			savedTransaction={savedTransaction}
			accounts={financialModelFixture.accounts}
			// Narrowed list as passed by paged views: claim options still
			// come from the canonical saved query.
			transactions={[savedTransaction]}
			onClose={() => {}}
		/>,
	);
	// The row stays locked: the amount is not editable.
	expect(
		(screen.getByLabelText("Amount (USD)") as HTMLInputElement).readOnly,
	).toBe(true);
	// But the occurrence claim is editable, with rules from the saved query.
	const claim = screen.getByLabelText(
		"Records an occurrence of",
	) as HTMLSelectElement;
	expect(claim.disabled).toBe(false);
	await screen.findByRole("option", { name: "Salary" });
	fireEvent.change(claim, { target: { value: "salary" } });
	for (const control of screen.getAllByLabelText(
		"Records an occurrence of",
	) as HTMLSelectElement[]) {
		expect(control.value).toBe("salary");
		expect(control.disabled).toBe(false);
	}
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy(),
	);
	expect(
		(screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
});

it("asks before closing a touched edit and keeps the dialog responsive", async () => {
	stubTestServer();
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
	fireEvent.change(screen.getByLabelText("Transaction name"), {
		target: { value: "Home renovation updated" },
	});
	const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;
	await waitFor(() => expect(panel.style.opacity).toBe("1"));
	fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
	const prompt = screen
		.getByText("Discard the changes in this form?")
		.closest("[role='alert']") as HTMLElement;
	expect(prompt).toBeTruthy();
	expect(onClose).not.toHaveBeenCalled();
	// The veto runs before the exit animation, so the prompt stays visible.
	expect(panel.style.opacity).not.toBe("0");
	// Continue clears the prompt; the next close asks again instead of
	// being latched off by the first request.
	fireEvent.click(within(prompt).getByRole("button", { name: "Continue" }));
	await waitFor(() =>
		expect(screen.queryByText("Discard the changes in this form?")).toBeNull(),
	);
	fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
	const secondPrompt = await screen.findByText(
		"Discard the changes in this form?",
	);
	expect(onClose).not.toHaveBeenCalled();
	fireEvent.click(
		within(secondPrompt.closest("[role='alert']") as HTMLElement).getByRole(
			"button",
			{ name: "Discard changes" },
		),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("keeps the discard confirmation after a failed occurrence claim", async () => {
	stubTestServer();
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
	await screen.findByRole("option", { name: "Salary" });
	fireEvent.change(screen.getByLabelText("Records an occurrence of"), {
		target: { value: "salary" },
	});
	fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
	await screen.findByText("Choose which occurrence this replaces.");
	const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;
	fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
	await screen.findByText("Discard the changes in this form?");
	expect(onClose).not.toHaveBeenCalled();
	// A failed save must not make closing fade the panel and strand the user.
	expect(panel.style.opacity).not.toBe("0");
	// Close requests keep the prompt visible; only its Discard button closes.
	fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
	expect(onClose).not.toHaveBeenCalled();
	const prompt = screen
		.getByText("Discard the changes in this form?")
		.closest("[role='alert']") as HTMLElement;
	fireEvent.click(
		within(prompt).getByRole("button", { name: "Discard changes" }),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("toggles projections from the options menu and saves", async () => {
	const server = stubTestServer();
	setServerModelFixture(financialModelFixture);
	const savedTransaction = financialModelFixture.transactions.find(
		(item) => item.id === "renovation",
	)!;
	render(
		<TransactionDetail
			transaction={occurrence(savedTransaction)}
			savedTransaction={savedTransaction}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			onClose={() => {}}
		/>,
	);
	await runInteractions(
		[
			{ click: ["button", "More options"] },
			{ click: ["menuitemcheckbox", "Exclude from projections"] },
			{ expectPresent: ["button", "Save changes"] },
			{ click: ["button", "Save changes"] },
		],
		dialogScope(/Home renovation/),
	);
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) =>
					call.method === "POST" &&
					call.url === "/v1/transactions/renovation/amend",
			),
		).toBe(true),
	);
	const body = server.calls.find(
		(call) =>
			call.method === "POST" &&
			call.url === "/v1/transactions/renovation/amend",
	)?.body as Record<string, unknown>;
	expect(body.enabled).toBe(false);
});

it("opens and closes the sharing sheet without closing the detail", async () => {
	stubTestServer();
	const savedTransaction = financialModelFixture.transactions.find(
		(item) => item.id === "renovation",
	)!;
	render(
		<TransactionDetail
			transaction={occurrence(savedTransaction)}
			savedTransaction={savedTransaction}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			onClose={() => {}}
		/>,
	);
	await runInteractions(
		[{ click: ["button", /Sharing status: Private/] }],
		dialogScope(/Home renovation/),
	);
	expect(screen.getByRole("dialog", { name: "Sharing" })).toBeTruthy();
	await runInteractions(
		[{ click: ["button", "Close dialog"] }],
		dialogScope("Sharing"),
	);
	await waitFor(() =>
		expect(screen.queryByRole("dialog", { name: "Sharing" })).toBeNull(),
	);
	expect(screen.getByRole("dialog", { name: /Home renovation/ })).toBeTruthy();
});

it("lets the owner pick the posted charge and remove the vanished hold", async () => {
	const server = stubTestServer();
	setServerModelOnly();
	const scope = getUserScope();
	const listKey = [...userResourceKey("transactions", scope), "", "all"];
	const catalogKey = userResourceKey("catalog", scope);
	serverQueryClient().setQueryData(listKey, {
		transactions: [{ id: "01900000-0000-7000-8000-000000000096" } as never],
		revision: "seed",
	});
	serverQueryClient().setQueryData(catalogKey, {
		items: [
			{
				id: "01900000-0000-7000-8000-000000000096",
				kind: "posting",
				name: "Bistro",
			},
		],
		revision: "seed",
	});
	const settled = {
		...financialModelFixture.transactions[0]!,
		id: "01900000-0000-7000-8000-000000000097",
		name: "Bistro dinner",
		amount: 58,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "posting" as const,
		startDate: "2026-10-21",
		endDate: null,
		annualIncrease: 0,
		enabled: true,
		readOnly: false,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		postedDate: "2026-10-21",
		pending: false,
		void: false,
		syncOwned: true,
	};
	const voidHold = {
		...financialModelFixture.transactions[0]!,
		id: "01900000-0000-7000-8000-000000000096",
		name: "Bistro",
		amount: 50,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "posting" as const,
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
		syncOwned: true,
	};
	const onClose = vi.fn();
	server.setSettleCandidates(voidHold.id, [settleCandidate(settled)]);
	render(
		<TransactionDetail
			transaction={occurrence(voidHold)}
			savedTransaction={voidHold}
			accounts={financialModelFixture.accounts}
			transactions={[voidHold, settled]}
			onClose={onClose}
		/>,
	);
	const picker = screen.getByLabelText("Posted as");
	await waitFor(() => expect(picker.textContent).toContain("Bistro dinner"));
	fireEvent.change(picker, { target: { value: settled.id } });
	fireEvent.click(screen.getByRole("button", { name: "Remove vanished hold" }));
	await waitFor(() =>
		expect(
			serverQueryClient().isFetching({
				queryKey: userResourceKey("model", scope),
			}),
		).toBe(0),
	);
	const modelFetchesBeforeRemoval = server.modelFetches().length;
	const confirm = screen.getByRole("dialog", {
		name: "Remove Bistro?",
	});
	expect(confirm.textContent).toContain("Bistro dinner");
	fireEvent.click(within(confirm).getByRole("button", { name: "Remove hold" }));
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) =>
					call.method === "DELETE" &&
					call.url === "/v1/transactions/01900000-0000-7000-8000-000000000096",
			),
		).toBe(true),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	// The hold is inert: removal drops it from the narrow lists and leaves
	// the financial model and its projections untouched.
	expect(server.modelFetches()).toHaveLength(modelFetchesBeforeRemoval);
	expect(serverQueryClient().getQueryData(listKey)).toMatchObject({
		transactions: [],
	});
	expect(serverQueryClient().getQueryData(catalogKey)).toMatchObject({
		items: [],
	});
});

it("keeps the vanished hold in the lists when the delete fails", async () => {
	const holdId = "01900000-0000-7000-8000-000000000094";
	const serverModel = fixtureModel(financialModelFixture);
	serverModel.postings.push({
		id: holdId,
		name: "Bistro",
		sourceAccountId: "checking",
		destinations: null,
		amount: {
			resolver: "expression",
			config: { expression: "50" },
			inputs: {},
		},
		postedTime: Math.floor(Date.parse("2026-10-20T00:00:00Z") / 1000),
		transactionTime: Math.floor(Date.parse("2026-10-20T00:00:00Z") / 1000),
		enabled: false,
		source: "simplefin",
		pending: false,
		void: true,
	});
	const server = stubTestServer(undefined, serverModel);
	setServerModelOnly();
	const scope = getUserScope();
	const listKey = [...userResourceKey("transactions", scope), "", "all"];
	serverQueryClient().setQueryData(listKey, {
		transactions: [{ id: holdId } as never],
		revision: "seed",
	});
	const voidHold = {
		...financialModelFixture.transactions[0]!,
		id: holdId,
		name: "Bistro",
		amount: 50,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "posting" as const,
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
		syncOwned: true,
	};
	const onClose = vi.fn();
	server.writeOnce(
		(method, path) =>
			method === "DELETE" && path === `/v1/transactions/${holdId}`,
		new Error("network down"),
	);
	render(
		<TransactionDetail
			transaction={occurrence(voidHold)}
			savedTransaction={voidHold}
			accounts={financialModelFixture.accounts}
			transactions={[voidHold]}
			onClose={onClose}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Remove vanished hold" }));
	fireEvent.click(
		within(screen.getByRole("dialog", { name: "Remove Bistro?" })).getByRole(
			"button",
			{ name: "Remove hold" },
		),
	);
	await waitFor(() =>
		expect(
			screen.getByText("The vanished hold could not be removed."),
		).toBeTruthy(),
	);
	expect(onClose).not.toHaveBeenCalled();
	await waitFor(() => {
		const cached = serverQueryClient().getQueryData(listKey) as
			| { transactions: { id: string }[] }
			| undefined;
		expect(cached?.transactions.some((row) => row.id === holdId)).toBe(true);
	});
});

it("lets the owner merge a vanished hold from the suggestions sheet", async () => {
	const server = stubTestServer();
	setServerModelOnly();
	const settled = {
		...financialModelFixture.transactions[0]!,
		id: "01900000-0000-7000-8000-000000000097",
		name: "Bistro dinner",
		amount: 58,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "posting" as const,
		startDate: "2026-10-21",
		endDate: null,
		annualIncrease: 0,
		enabled: true,
		readOnly: false,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		postedDate: "2026-10-21",
		pending: false,
		void: false,
		syncOwned: true,
	};
	const voidHold = {
		...financialModelFixture.transactions[0]!,
		id: "01900000-0000-7000-8000-000000000096",
		name: "Bistro",
		amount: 50,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "posting" as const,
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
		syncOwned: true,
	};
	const onClose = vi.fn();
	server.setSettleCandidates(voidHold.id, [settleCandidate(settled)]);
	render(
		<TransactionDetail
			transaction={occurrence(voidHold)}
			savedTransaction={voidHold}
			accounts={financialModelFixture.accounts}
			transactions={[voidHold, settled]}
			onClose={onClose}
		/>,
	);
	const trigger = await screen.findByRole("button", {
		name: "Review 1 suggestion",
	});
	await waitFor(() =>
		expect(
			serverQueryClient().isFetching({
				queryKey: userResourceKey("model", getUserScope()),
			}),
		).toBe(0),
	);
	const modelFetchesBeforeMerge = server.modelFetches().length;
	fireEvent.click(trigger);
	const sheet = screen.getByRole("dialog", { name: "Suggestions" });
	expect(within(sheet).getByText(/Did this hold post/)).toBeTruthy();
	fireEvent.click(
		within(sheet).getByRole("button", {
			name: "Merge and remove hold",
		}),
	);
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) =>
					call.method === "DELETE" &&
					call.url === "/v1/transactions/01900000-0000-7000-8000-000000000096",
			),
		).toBe(true),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	expect(server.modelFetches()).toHaveLength(modelFetchesBeforeMerge);
});

it("moves a recorded occurrence when merging a vanished hold", async () => {
	const server = stubTestServer();
	const settled = {
		...financialModelFixture.transactions.find(
			(row) => row.id === "renovation",
		)!,
		syncOwned: true,
		postedDate: "2028-06-15",
	};
	const voidHold = {
		...settled,
		id: "01900000-0000-7000-8000-000000000095",
		startDate: "2028-06-14",
		enabled: false,
		readOnly: true,
		claimScheduleId: "living",
		claimOccurrenceDate: "2026-10-01",
		postedDate: null,
		void: true,
	};
	setServerModelFixture({
		...financialModelFixture,
		transactions: [voidHold, settled],
	});
	const onClose = vi.fn();
	server.setSettleCandidates(voidHold.id, [settleCandidate(settled)]);
	render(
		<TransactionDetail
			transaction={occurrence(voidHold)}
			savedTransaction={voidHold}
			accounts={financialModelFixture.accounts}
			transactions={[voidHold, settled]}
			onClose={onClose}
		/>,
	);
	const trigger = await screen.findByRole("button", {
		name: "Review 1 suggestion",
	});
	fireEvent.click(trigger);
	const sheet = screen.getByRole("dialog", { name: "Suggestions" });
	fireEvent.click(
		within(sheet).getByRole("button", {
			name: "Merge and remove hold",
		}),
	);
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) =>
					call.method === "POST" &&
					call.url === "/v1/transactions/renovation/claim" &&
					(call.body as { scheduleId?: string })?.scheduleId === "living",
			),
		).toBe(true),
	);
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) =>
					call.method === "DELETE" &&
					call.url === "/v1/transactions/01900000-0000-7000-8000-000000000095",
			),
		).toBe(true),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("preselects the closest posted charge when several match", async () => {
	const server = stubTestServer();
	const base = financialModelFixture.transactions[0]!;
	const hold = {
		...base,
		id: "01900000-0000-7000-8000-0000000000a1",
		name: "LYFT *TEMP AUTH HOLD",
		amount: 74.94,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "posting" as const,
		startDate: "2026-10-31",
		endDate: null,
		annualIncrease: 0,
		enabled: false,
		readOnly: true,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		pending: false,
		void: true,
		syncOwned: true,
	};
	const closer = {
		...hold,
		id: "01900000-0000-7000-8000-0000000000a2",
		name: "LYFT *STANDARD 10-30",
		amount: 81.22,
		startDate: "2026-11-01",
		enabled: true,
		readOnly: false,
		void: false,
		postedDate: "2026-11-01",
	};
	const farther = {
		...hold,
		id: "01900000-0000-7000-8000-0000000000a3",
		name: "LYFT *AIRPORT 10-30",
		amount: 86.18,
		startDate: "2026-11-01",
		enabled: true,
		readOnly: false,
		void: false,
		postedDate: "2026-11-01",
	};
	server.setSettleCandidates(hold.id, [
		settleCandidate(closer),
		settleCandidate(farther),
	]);
	render(
		<TransactionDetail
			transaction={occurrence(hold)}
			savedTransaction={hold}
			accounts={financialModelFixture.accounts}
			transactions={[farther, closer, hold]}
			onClose={() => {}}
		/>,
	);
	const picker = screen.getByLabelText("Posted as") as HTMLSelectElement;
	await waitFor(() => expect(picker.value).toBe(closer.id));
	expect(picker.textContent).toContain("LYFT *STANDARD");
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
	const baselinePostedDate = scheduleTransaction({
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
					call.method === "POST" &&
					call.url === "/v1/transactions/renovation/amend",
			),
		).toBe(true),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	const body = server.calls.find(
		(call) =>
			call.method === "POST" &&
			call.url === "/v1/transactions/renovation/amend",
	)?.body as Record<string, unknown>;
	// A rename patches one member. The stored non-midnight instants are
	// never restated, so no edit can round them to midnight.
	expect(body).toEqual({ name: "Home renovation updated" });
});

it("stops a rejected amend before the claim leg and keeps the form", async () => {
	const server = stubTestServer();
	acceptTestResource();
	const base = financialModelFixture.transactions.find(
		(item) => item.id === "renovation",
	)!;
	const claimed = {
		...base,
		claimScheduleId: "salary",
		claimOccurrenceDate: "2026-02-01",
	};
	server.writeOnce(
		(method, path) =>
			method === "POST" && path === "/v1/transactions/renovation/amend",
		{
			value: {},
			issues: [
				{
					severity: "error",
					code: "posting.claim.duplicate",
					message: "That occurrence is already claimed.",
					path: [],
				},
			],
			saved: false,
			revision: "rejected",
		},
	);
	const onClose = vi.fn();
	render(
		<TransactionDetail
			transaction={occurrence(claimed)}
			savedTransaction={claimed}
			accounts={financialModelFixture.accounts}
			transactions={[claimed]}
			onClose={onClose}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Transaction name"), {
		target: { value: "Renovation rejected" },
	});
	fireEvent.change(
		screen.getAllByLabelText("Records an occurrence of").at(-1)!,
		{ target: { value: "" } },
	);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy(),
	);
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) =>
					call.method === "POST" &&
					call.url === "/v1/transactions/renovation/amend",
			),
		).toBe(true),
	);
	await waitFor(() =>
		expect(
			screen.getByText(
				"The transaction could not be saved. Review the workspace notice and try again.",
			),
		).toBeTruthy(),
	);
	expect(onClose).not.toHaveBeenCalled();
	expect(
		server.calls.some(
			(call) =>
				call.method === "POST" &&
				call.url === "/v1/transactions/renovation/release",
		),
	).toBe(false);
});

it("starts a subscription from a transaction in one action", async () => {
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
	fireEvent.click(screen.getByRole("button", { name: "More options" }));
	fireEvent.click(
		screen.getByRole("menuitem", { name: "Mark as subscription" }),
	);
	await waitFor(() =>
		expect(
			server.calls.some(
				(call) =>
					call.method === "POST" &&
					call.url === "/v1/transactions/renovation/schedule",
			),
		).toBe(true),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	const start = server.calls.find(
		(call) => call.url === "/v1/transactions/renovation/schedule",
	);
	expect(start?.body).toMatchObject({
		frequency: "monthly",
		startDate: savedTransaction.startDate,
	});
	// The start action claims the transaction atomically; the client never
	// deletes the source or patches a separate claim.
	expect(
		server.calls.some(
			(call) =>
				call.method === "DELETE" && String(call.url).includes("renovation"),
		),
	).toBe(false);
	expect(
		server.calls.some(
			(call) =>
				call.method === "POST" &&
				call.url === "/v1/transactions/renovation/claim",
		),
	).toBe(false);
});

it("retries a failed schedule start with the same identity", async () => {
	const model = fixtureModel(financialModelFixture);
	const server = stubTestServer(undefined, model);
	acceptTestResource();
	setServerModelFixture(financialModelFixture, { model });
	// Reject the atomic start once so the first attempt records nothing.
	server.writeOnce(
		(method, path) =>
			method === "POST" && path === "/v1/transactions/renovation/schedule",
		new Error("The schedule could not be saved."),
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
	fireEvent.click(screen.getByRole("button", { name: "More options" }));
	fireEvent.click(
		screen.getByRole("menuitem", { name: "Mark as subscription" }),
	);
	await waitFor(() =>
		expect(screen.getByText(/could not be created/)).toBeTruthy(),
	);
	expect(onClose).not.toHaveBeenCalled();
	const starts = () =>
		server.calls.filter(
			(call) =>
				call.method === "POST" &&
				call.url === "/v1/transactions/renovation/schedule",
		);
	expect(starts()).toHaveLength(1);
	// Retry reuses the pinned identity; the failed attempt saved nothing.
	fireEvent.click(screen.getByRole("button", { name: "More options" }));
	fireEvent.click(
		screen.getByRole("menuitem", { name: "Mark as subscription" }),
	);
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	expect(starts()).toHaveLength(2);
	const firstId = (starts()[0]?.body as { id?: string })?.id;
	const secondId = (starts()[1]?.body as { id?: string })?.id;
	expect(firstId).toBeTruthy();
	expect(secondId).toBe(firstId);
});

it("shows the category control on recordings but not on rules or void holds", () => {
	stubTestServer();
	const posting = financialModelFixture.transactions.find(
		(item) => item.id === "renovation",
	)!;
	render(
		<TransactionDetail
			transaction={occurrence(posting)}
			savedTransaction={posting}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			onClose={() => {}}
		/>,
	);
	expect(screen.getByRole("button", { name: /Category/ })).toBeTruthy();
	cleanup();
	const rule = { ...posting, id: "renovation-rule", kind: "schedule" as const };
	render(
		<TransactionDetail
			transaction={occurrence(rule)}
			savedTransaction={rule}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			onClose={() => {}}
		/>,
	);
	expect(screen.queryByRole("button", { name: /Category/ })).toBeNull();
	cleanup();
	const voided = { ...posting, id: "vanished", void: true };
	render(
		<TransactionDetail
			transaction={occurrence(voided)}
			savedTransaction={voided}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			onClose={() => {}}
		/>,
	);
	expect(screen.queryByRole("button", { name: /Category/ })).toBeNull();
});

it("keeps category edits enabled on a pending bank row", () => {
	stubTestServer();
	const posting = financialModelFixture.transactions.find(
		(item) => item.id === "renovation",
	)!;
	const pending = {
		...posting,
		id: "pending-charge",
		pending: true,
		readOnly: true,
	};
	render(
		<TransactionDetail
			transaction={occurrence(pending)}
			savedTransaction={pending}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			onClose={() => {}}
		/>,
	);
	expect(
		(screen.getByRole("button", { name: /Category/ }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
});

it("offers frequency conversion and keeps growth on recurrence rules", () => {
	const posting = financialModelFixture.transactions.find(
		(item) => item.id === "renovation",
	)!;
	render(
		<TransactionDetail
			transaction={occurrence(posting)}
			savedTransaction={posting}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			onClose={() => {}}
		/>,
	);
	// A posting can become a rule through Frequency. Growth applies only
	// once the draft is recurring; the claim controls stay on one-time rows.
	expect(screen.getByLabelText("Frequency")).toBeTruthy();
	expect(screen.queryByLabelText("Annual amount increase (%)")).toBeNull();
	expect(screen.getByLabelText("Records an occurrence of")).toBeTruthy();
	fireEvent.change(screen.getByLabelText("Frequency"), {
		target: { value: "monthly" },
	});
	expect(screen.getByLabelText("Annual amount increase (%)")).toBeTruthy();
	expect(screen.queryByLabelText("Records an occurrence of")).toBeNull();
	expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
	cleanup();
	const rule = {
		...posting,
		id: "renovation-rule",
		kind: "schedule" as const,
	};
	render(
		<TransactionDetail
			transaction={occurrence(rule)}
			savedTransaction={rule}
			accounts={financialModelFixture.accounts}
			transactions={financialModelFixture.transactions}
			onClose={() => {}}
		/>,
	);
	expect(screen.getByLabelText("Frequency")).toBeTruthy();
	expect(screen.getByLabelText("Annual amount increase (%)")).toBeTruthy();
	expect(screen.queryByLabelText("Records an occurrence of")).toBeNull();
});
