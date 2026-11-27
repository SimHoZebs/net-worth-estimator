import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferLink } from "@/api/generated/model/transferLink.ts";
import type { Account, Transaction } from "@/domain/model.ts";
import type { TransactionOrder } from "@/domain/transactionSort.ts";
import { financialModelFixture } from "@/mocks/financialModel.ts";
import { summaryFixture } from "@/mocks/safeSpendingSummary.ts";
import { SafeSpendingCyclePanel } from "./SafeSpendingCyclePanel.tsx";
import { buildSafeSpendingActivity } from "./safeSpendingActivity.ts";

const queryState = vi.hoisted(() => ({
	links: [] as TransferLink[],
	analysisBatches: [] as string[][],
}));

vi.mock("@/state/analyses.ts", () => ({
	useTransferLinks: () => ({ data: { links: queryState.links } }),
}));
vi.mock("@/state/savedState.ts", () => ({
	useSavedAccounts: () => [],
	useSavedTransactions: () => [],
}));
vi.mock("../../../components/analysis/TransactionAnalysis.tsx", () => ({
	TransactionAnalysisProvider: ({
		transactionIds,
		children,
	}: {
		transactionIds: string[];
		children: ReactNode;
	}) => {
		queryState.analysisBatches.push(transactionIds);
		return children;
	},
	useTransactionBNPL: (transactionId: string) =>
		transactionId === "analyzed"
			? { review: { decision: "confirmed" } }
			: undefined,
}));
vi.mock("../../../components/activity/TransactionDetail.tsx", () => ({
	TransactionDetail: ({
		transaction,
		onClose,
	}: {
		transaction: { name: string };
		onClose: () => void;
	}) => (
		<div role="dialog" aria-label={transaction.name}>
			<button type="button" onClick={onClose}>
				Close detail
			</button>
		</div>
	),
}));

const checking: Account = financialModelFixture.accounts[0]!;
const card: Account = {
	...financialModelFixture.accounts[5]!,
	id: "card",
	name: "Test card",
	kind: "credit_card",
	maxBalance: null,
};
const accounts = [checking, card];
const summary = summaryFixture({
	cycleStart: "2026-10-20",
	cycleEnd: "2026-11-19",
	cashAsOf: "2026-11-30",
});

function transaction(
	id: string,
	overrides: Partial<Transaction> = {},
): Transaction {
	return {
		...financialModelFixture.transactions[0]!,
		id,
		name: id,
		kind: "transaction",
		amount: 10,
		amountKnown: true,
		fromId: card.id,
		toId: null,
		startDate: "2026-11-10",
		endDate: null,
		enabled: true,
		readOnly: false,
		void: false,
		pending: false,
		transactionTime: null,
		...overrides,
	};
}

function Panel({
	rows,
	onOrder,
}: {
	rows: Transaction[];
	onOrder: (order: TransactionOrder) => void;
}) {
	const [order, setOrder] = useState<TransactionOrder>("newest");
	const activity = buildSafeSpendingActivity({
		accounts,
		transactions: rows,
		trackedIds: [card.id],
		spendingIds: [checking.id],
		summary,
		transferLinks: queryState.links,
		order,
	});
	return (
		<SafeSpendingCyclePanel
			activity={activity}
			summary={summary}
			accounts={accounts}
			transactions={rows}
			readOnly={false}
			transactionOrder={order}
			onTransactionOrderChange={(next) => {
				setOrder(next);
				onOrder(next);
			}}
		/>
	);
}

function renderPanel(rows: Transaction[]) {
	const onOrder = vi.fn();
	return { ...render(<Panel rows={rows} onOrder={onOrder} />), onOrder };
}

beforeEach(() => {
	queryState.links = [];
	queryState.analysisBatches = [];
});

describe("safe spending transactions panel", () => {
	it("shows spent and per-card totals, sorted spending, and the recorded transfer section", () => {
		const { onOrder } = renderPanel([
			transaction("older-card", {
				amount: 50,
				startDate: "2026-11-05",
			}),
			transaction("newer-cash", {
				fromId: checking.id,
				amount: 25,
				startDate: "2026-11-15",
			}),
			transaction("payment", {
				fromId: checking.id,
				toId: card.id,
				amount: 80,
				startDate: "2026-11-19",
			}),
		]);
		expect(screen.getByText("Spent")).toBeTruthy();
		expect(screen.getByText("$75.00")).toBeTruthy();
		expect(screen.getByText("Test card")).toBeTruthy();
		expect(screen.getByText("$50.00")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Spending this cycle" }),
		).toBeTruthy();
		const spendingHeader = screen.getByRole("heading", {
			name: "Spending this cycle",
		}).parentElement!.parentElement!;
		expect(
			within(spendingHeader).getByRole("button", {
				name: /^Sort transactions: Newest first/,
			}),
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Cash payments this cycle" }),
		).toBeTruthy();
		expect(screen.getByText("Recorded amounts · Oct 20 – Nov 19")).toBeTruthy();
		expect(screen.getByText("$80.00")).toBeTruthy();
		const spendingTable = screen.getByRole("table", {
			name: "Spending this cycle, newest first",
		});
		expect(
			within(spendingTable)
				.getAllByRole("row")
				.map((row) => row.textContent),
		).toEqual([
			expect.stringContaining("newer-cash"),
			expect.stringContaining("older-card"),
		]);
		fireEvent.click(
			screen.getByRole("button", { name: /^Sort transactions: Newest first/ }),
		);
		expect(onOrder).toHaveBeenCalledWith("oldest");
		const oldestTable = screen.getByRole("table", {
			name: "Spending this cycle, oldest first",
		});
		expect(
			within(oldestTable)
				.getAllByRole("row")
				.map((row) => row.textContent),
		).toEqual([
			expect.stringContaining("older-card"),
			expect.stringContaining("newer-cash"),
		]);
	});

	it("renders the exact empty state and a proven zero summary", () => {
		renderPanel([]);
		expect(screen.getByText("No spending this cycle yet.")).toBeTruthy();
		expect(screen.getAllByText("$0.00")).toHaveLength(2);
		expect(
			screen.queryByRole("heading", { name: "Cash payments this cycle" }),
		).toBeNull();
	});

	it("keeps shared badges, signed amounts, transfer peers, batch analysis, and row click-through", () => {
		const rows = [
			transaction("pending", {
				name: "Pending charge",
				amount: 12.34,
				pending: true,
				enabled: false,
				syncOwned: true,
				receiptIds: ["receipt-1", "receipt-2"],
			}),
			transaction("analyzed", {
				name: "Analyzed charge",
				amount: 40,
				receiptIds: ["receipt-3"],
				recognizedBusinessKey: "spotify",
			}),
			transaction("refund", {
				name: "Card refund",
				fromId: null,
				toId: card.id,
				amount: 5,
				category: "FOOD_AND_DRINK",
			}),
			transaction("payment", {
				name: "Recorded card payment",
				fromId: checking.id,
				amount: 90,
			}),
			transaction("card-leg", {
				name: "Card payment leg",
				fromId: null,
				toId: card.id,
				amount: 90,
			}),
		];
		queryState.links = [
			{
				legA: "payment",
				legB: "card-leg",
				actor: "owner",
				createdAt: 1,
				findingId: "finding",
			},
		];
		renderPanel(rows);
		expect(screen.getByText("Pending", { exact: true })).toBeTruthy();
		expect(screen.getByText("2 receipts")).toBeTruthy();
		expect(screen.getByText("BNPL")).toBeTruthy();
		const analyzed = screen.getByRole("button", {
			name: /^View Analyzed charge /,
		});
		expect(analyzed.querySelector("img")?.getAttribute("src")).toBe(
			"/v1/assets/business-logos/spotify",
		);
		expect(screen.getByText("−$12.34")).toBeTruthy();
		expect(screen.getByText("+$5.00")).toBeTruthy();
		const payment = screen.getByRole("button", {
			name: /^View Recorded card payment /,
		});
		expect(within(payment).getByText("To Test card")).toBeTruthy();
		expect(queryState.analysisBatches.at(-1)).toEqual([
			"analyzed",
			"pending",
			"refund",
			"payment",
		]);
		fireEvent.click(payment);
		const detail = screen.getByRole("dialog", {
			name: "Recorded card payment",
		});
		expect(detail).toBeTruthy();
		fireEvent.click(
			within(detail).getByRole("button", { name: "Close detail" }),
		);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(payment).toBeTruthy();
	});
});
