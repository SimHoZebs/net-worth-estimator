import {
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { financialModelFixture } from "../../../mocks/financialModel.ts";
import type { AccountTransaction } from "../../../domain/accountActivity.ts";
import { safeSpendingTrend } from "../../../domain/safeSpendingTrend.ts";
import { SafeSpendingBillsPanel } from "./SafeSpendingBillsPanel.tsx";
import { SafeSpendingConfigurePanel } from "./SafeSpendingConfigurePanel.tsx";
import { SafeSpendingDetailShell } from "./SafeSpendingDetailShell.tsx";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
import type {
	CashNowDecomposition,
	CycleAllocation,
	SafeSpendingConfigHints,
	SafeSpendingHeroes,
	SafeSpendingMandatorySection,
	StatementFunding,
} from "./safeSpendingDetailModel.ts";

beforeEach(() => {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: false,
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
	vi.unstubAllGlobals();
});

const heroes: SafeSpendingHeroes = {
	cushion: 1200,
	checkingAmount: 5000,
	safe: 300,
	theoretical: 500,
	dailySafe: 30,
	dailyTheoretical: 40,
	fullDaysLeft: 10,
	cycleStart: "2026-09-20",
	cycleEnd: "2026-10-19",
	closedCycle: {
		start: "2026-08-20",
		end: "2026-09-19",
		total: 600,
		cards: [
			{
				id: "card",
				name: "Household card",
				amount: 600,
				observedOn: "2026-09-19",
			},
		],
	},
	committedTotal: 800,
	committedByCard: [],
};

// Fixture bundle for the open statement the panel shows.
const currentFunding: StatementFunding = {
	paycheck: 3000,
	date: "2026-09-30",
	endDate: "2026-09-30",
	fixedBills: 1500,
};
const cashNow: CashNowDecomposition = {
	checking: 5000,
	spentSinceStart: 0,
	bills: 1000,
	cushion: 1200,
	since: "2026-09-24",
	monthEnd: "2026-09-30",
	short: 0,
	firstShort: null,
};

const allocation: CycleAllocation = {
	reserve: 200,
	allowance: 300,
	available: true,
};

const section: SafeSpendingMandatorySection = {
	title: labels.scheduledBills,
	subtitle: "Scheduled amounts",
	total: 1000,
	transactions: [],
};

const config: SafeSpendingConfigHints = {
	statementDay: 20,
	reserve: 200,
	cards: [],
	trackedIds: [],
	spendingAccounts: [],
	trackedSpendingIds: [],
	incomeAccounts: [],
	trackedIncomeIds: [],
};

function charge(date: string, amount: number): AccountTransaction {
	return {
		id: `charge-${date}`,
		transactionId: `charge-${date}`,
		date,
		name: "Card purchase",
		source: "historical",
		direction: "out",
		flow: "expense",
		counterparty: "External spending",
		from: "Household card",
		to: "External spending",
		amount,
		requested: amount,
		shortfall: 0,
		constraint: null,
		excluded: false,
		pending: false,
		void: false,
	};
}

const noop = () => {};

describe("SafeSpendingDetailShell", () => {
	it.each(["cycle", "last-cycle", "configure"] as const)(
		"keeps the modal title on %s",
		(tab) => {
			render(
				<SafeSpendingDetailShell
					tab={tab}
					onTabChange={noop}
					cycleCounts={{}}
					onClose={noop}
				>
					Content
				</SafeSpendingDetailShell>,
			);
			expect(
				screen.getByRole("dialog", { name: "Safe card spending" }),
			).toBeTruthy();
			expect(
				screen.getByRole("heading", { name: "Safe card spending" }),
			).toBeTruthy();
		},
	);
	it("switches tabs through the shell", () => {
		const onTabChange = vi.fn();
		function show(tab: "cycle" | "last-cycle" | "configure") {
			return (
				<SafeSpendingDetailShell
					tab={tab}
					onTabChange={onTabChange}
					cycleCounts={{ cycle: 3, "last-cycle": 2 }}
					range={{ start: heroes.cycleStart, end: heroes.cycleEnd }}
					onClose={noop}
				>
					<SafeSpendingBillsPanel
						heroes={heroes}
						cashNow={cashNow}
						allocation={allocation}
						funding={currentFunding}
						section={section}
						accounts={financialModelFixture.accounts}
						transactions={financialModelFixture.transactions}
						readOnly={financialModelFixture.readOnly}
						transactionOrder="newest"
						onTransactionOrderChange={noop}
					/>
				</SafeSpendingDetailShell>
			);
		}
		const { rerender } = render(show("cycle"));
		expect(screen.getByText(labels.leftAtEndOfMonth)).toBeTruthy();
		expect(screen.getAllByText("Sep 20, 2026 – Oct 19, 2026")).toHaveLength(1);
		expect(screen.getAllByText("No bills due in this period.")).toHaveLength(1);
		expect(screen.queryByRole("toolbar", { name: "Bills window" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Calendar month" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "Bills" })).toBeNull();
		expect(
			screen
				.getByRole("tab", { name: /This cycle/ })
				.getAttribute("aria-selected"),
		).toBe("true");
		fireEvent.click(screen.getByRole("tab", { name: /Last cycle/ }));
		expect(onTabChange).toHaveBeenCalledWith("last-cycle");
		// A controlled parent applies the new tab before the next switch, so
		// the way back is a real value change the native primitive reports.
		rerender(show("last-cycle"));
		fireEvent.click(screen.getByRole("tab", { name: /This cycle/ }));
		expect(onTabChange).toHaveBeenCalledWith("cycle");
	});
});

describe("SafeSpendingBillsPanel decision rows", () => {
	function renderBills(funding: StatementFunding = currentFunding) {
		render(
			<SafeSpendingBillsPanel
				heroes={heroes}
				cashNow={cashNow}
				allocation={allocation}
				funding={funding}
				section={section}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				readOnly={financialModelFixture.readOnly}
				transactionOrder="newest"
				onTransactionOrderChange={noop}
			/>,
		);
	}

	it("reads month-end cash, spend-till, and per-day rows with the reserve meter", () => {
		renderBills();
		expect(screen.getByText("Left at end of month")).toBeTruthy();
		expect(screen.getByTestId("left-value")).toBeTruthy();
		expect(screen.getByText("$1,200")).toBeTruthy();
		expect(
			screen.getByText("After $1,000 bills · through Sep 30"),
		).toBeTruthy();
		expect(screen.getByText("Spend till Oct 19 closing")).toBeTruthy();
		expect(screen.getByTestId("spend-value")).toBeTruthy();
		expect(screen.getByText("$300")).toBeTruthy();
		expect(
			screen.getByRole("img", { name: "Spent $800 of $500 limit" }),
		).toBeTruthy();
		expect(screen.queryByText(/a day/)).toBeNull();
		expect(screen.getByText("Per day")).toBeTruthy();
		expect(screen.getByTestId("perday-value")).toBeTruthy();
		expect(screen.getByText("$30")).toBeTruthy();
		expect(screen.getByText("of $300")).toBeTruthy();
		expect(screen.getByText("The Sep 30 paycheck pays this statement"))
			.toBeTruthy();
	});

	it("names the bundle date range for several income sources", () => {
		renderBills({ ...currentFunding, endDate: "2026-10-05" });
		expect(
			screen.getByText("The Sep 30 – Oct 5 paychecks pay this statement"),
		).toBeTruthy();
	});

	it("says so when no paycheck settles this statement", () => {
		renderBills({ ...currentFunding, date: null, endDate: null, paycheck: 0 });
		expect(screen.getByText("No projected paycheck")).toBeTruthy();
	});

	it("shows the prod-shape into-reserve case across the three rows", () => {
		render(
			<SafeSpendingBillsPanel
				heroes={{ ...heroes, theoretical: 33 }}
				cashNow={{ ...cashNow, cushion: 147 }}
				allocation={{ ...allocation, allowance: -692, reserve: 725 }}
				funding={currentFunding}
				section={section}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				readOnly={financialModelFixture.readOnly}
				transactionOrder="newest"
				onTransactionOrderChange={noop}
			/>,
		);
		expect(screen.getByTestId("left-value")).toBeTruthy();
		expect(screen.getByText("$147")).toBeTruthy();
		expect(
			screen.getByText("After $1,000 bills · through Sep 30"),
		).toBeTruthy();
		expect(screen.getByTestId("spend-value")).toBeTruthy();
		expect(screen.getByText("$33")).toBeTruthy();
		expect(
			screen.getByText("$692 of $725 reserve in use"),
		).toBeTruthy();
		expect(
			screen.getByRole("img", { name: "Spent $800 of $33 limit" }),
		).toBeTruthy();
		expect(screen.getByTestId("perday-value")).toBeTruthy();
		expect(screen.getByText("$40")).toBeTruthy();
		expect(screen.getByText("of $33")).toBeTruthy();
	});

	it("reads the at-limit boundary as of $0, not over", () => {
		render(
			<SafeSpendingBillsPanel
				heroes={{ ...heroes, theoretical: 0 }}
				cashNow={cashNow}
				allocation={{ ...allocation, allowance: -725, reserve: 725 }}
				funding={currentFunding}
				section={section}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				readOnly={financialModelFixture.readOnly}
				transactionOrder="newest"
				onTransactionOrderChange={noop}
			/>,
		);
		expect(screen.getByTestId("spend-value")).toBeTruthy();
		expect(screen.getByText("$0")).toBeTruthy();
		expect(
			screen.getByText("$725 of $725 reserve in use"),
		).toBeTruthy();
		expect(screen.queryByRole("img", { name: /^Spent / })).toBeNull();
	});

	it("caps the spend-till row at zero and hides the meter once over the limit", () => {
		render(
			<SafeSpendingBillsPanel
				heroes={{ ...heroes, theoretical: -7250 }}
				cashNow={cashNow}
				allocation={{ ...allocation, allowance: -7975, reserve: 725 }}
				funding={currentFunding}
				section={section}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				readOnly={financialModelFixture.readOnly}
				transactionOrder="newest"
				onTransactionOrderChange={noop}
			/>,
		);
		expect(screen.getByTestId("spend-value")).toBeTruthy();
		expect(screen.getByText("Over limit by $7,250")).toBeTruthy();
		expect(screen.queryByRole("img", { name: /^Spent / })).toBeNull();
		expect(screen.getByTestId("perday-value")).toBeTruthy();
		expect(screen.getByText("$0")).toBeTruthy();
		expect(screen.queryByText("of $0 over 10 full days")).toBeNull();
	});

	it("names the empty bills window without an After $0 line", () => {
		render(
			<SafeSpendingBillsPanel
				heroes={heroes}
				cashNow={{ ...cashNow, bills: 0 }}
				allocation={allocation}
				funding={currentFunding}
				section={section}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				readOnly={financialModelFixture.readOnly}
				transactionOrder="newest"
				onTransactionOrderChange={noop}
			/>,
		);
		expect(screen.getByText("No bills through Sep 30")).toBeTruthy();
		expect(screen.queryByText(/After \$0/)).toBeNull();
	});

	it("keeps the shortfall flag on the empty bills window", () => {
		render(
			<SafeSpendingBillsPanel
				heroes={heroes}
				cashNow={{ ...cashNow, bills: 0, short: 500 }}
				allocation={allocation}
				funding={currentFunding}
				section={section}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				readOnly={financialModelFixture.readOnly}
				transactionOrder="newest"
				onTransactionOrderChange={noop}
			/>,
		);
		expect(
			screen.getByText("No bills through Sep 30 · $500 unfulfilled"),
		).toBeTruthy();
	});

	it("reads the closed overrun as a budget with the paid caption", () => {
		render(
			<SafeSpendingBillsPanel
				heroes={{ ...heroes, theoretical: -7250 }}
				cashNow={cashNow}
				allocation={{ ...allocation, allowance: -7975, reserve: 725 }}
				funding={currentFunding}
				section={section}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				readOnly={financialModelFixture.readOnly}
				transactionOrder="newest"
				onTransactionOrderChange={noop}
				closed
			/>,
		);
		expect(screen.getByTestId("spend-value")).toBeTruthy();
		expect(screen.getByText("Over budget by $7,250")).toBeTruthy();
		expect(screen.getByText("$0")).toBeTruthy();
		expect(screen.queryByText("of $0 across the cycle")).toBeNull();
		expect(screen.getByText("The Sep 30 paycheck paid this statement"))
			.toBeTruthy();
	});

	it("leads with the pace chart when a trend is present", async () => {
		// The panel lazy-loads the chart; preload the chunk so the Suspense
		// skeleton cannot outlast the query under full-suite parallel load.
		await import("./SafeSpendingTrendChart.tsx");
		const trend = safeSpendingTrend({
			transactions: [charge("2026-09-21", 100)],
			cycleStart: "2026-09-20",
			cycleEnd: "2026-10-19",
			todayIso: "2026-09-21",
			limit: 400,
			safetyNet: 300,
		});
		render(
			<SafeSpendingBillsPanel
				heroes={heroes}
				cashNow={cashNow}
				allocation={allocation}
				trend={trend}
				funding={currentFunding}
				section={section}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				readOnly={financialModelFixture.readOnly}
				transactionOrder="newest"
				onTransactionOrderChange={noop}
			/>,
		);
		const chart = await screen.findByRole(
			"img",
			{
				name: labels.spendingPace,
			},
			{ timeout: 5000 },
		);
		const rows = screen.getByText("Left at end of month");
		expect(
			Boolean(
				chart.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING,
			),
		).toBe(true);
	});

	it("drops the cash-based reserve-used figure", () => {
		render(
			<SafeSpendingBillsPanel
				heroes={heroes}
				cashNow={{ ...cashNow, cushion: 108 }}
				allocation={{ ...allocation, reserve: 725 }}
				funding={currentFunding}
				section={section}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				readOnly={financialModelFixture.readOnly}
				transactionOrder="newest"
				onTransactionOrderChange={noop}
				closed
			/>,
		);
		expect(screen.queryByText(/used$/)).toBeNull();
	});

	it("does not invent an allowance when a closed balance is missing", () => {
		render(
			<SafeSpendingBillsPanel
				heroes={{
					...heroes,
					committedTotal: null,
					committedByCard: [
						{ id: "card", name: "Household card", amount: null },
					],
				}}
				cashNow={{ ...cashNow, provisional: true }}
				allocation={{ ...allocation, allowance: 0, available: false }}
				funding={currentFunding}
				section={section}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				readOnly={financialModelFixture.readOnly}
				transactionOrder="newest"
				onTransactionOrderChange={noop}
				closed
			/>,
		);
		expect(screen.getAllByText("—").length).toBeGreaterThan(0);
		expect(screen.getByText("Closed card balance unavailable")).toBeTruthy();
		expect(screen.getByText("Latest balance, not at close")).toBeTruthy();
		expect(screen.queryByText("$0")).toBeNull();
		expect(screen.queryByRole("img", { name: /^Spent / })).toBeNull();
	});
});

describe("SafeSpendingConfigurePanel", () => {
	it("renders statement, reserve, and empty account states", () => {
		render(
			<SafeSpendingConfigurePanel
				config={config}
				income={{ candidates: [], selectedScheduleIds: [], paycheck: null }}
				billCandidates={[]}
				trackedBillIds={[]}
				accounts={financialModelFixture.accounts}
				onToggleBill={noop}
				onToggleAccount={noop}
				onToggleSpendingAccount={noop}
				onToggleIncomeAccount={noop}
				onUpdateConfig={noop}
			/>,
		);
		expect(screen.getByText(`${labels.cycleStart} (1–28)`)).toBeTruthy();
		expect(screen.getByText("Protected reserve ($)")).toBeTruthy();
		expect(screen.getByText("Tracked cards")).toBeTruthy();
		expect(
			screen.getByText(
				"No recurring bills found for the selected cash accounts.",
			),
		).toBeTruthy();
	});

	it("shows source selections without calculated-total fields or outputs", () => {
		render(
			<SafeSpendingConfigurePanel
				config={config}
				income={{ candidates: [], selectedScheduleIds: [], paycheck: null }}
				billCandidates={[]}
				trackedBillIds={[]}
				accounts={financialModelFixture.accounts}
				onToggleBill={noop}
				onToggleAccount={noop}
				onToggleSpendingAccount={noop}
				onToggleIncomeAccount={noop}
				onUpdateConfig={noop}
			/>,
		);
		for (const label of [
			labels.cashBalance,
			labels.remainingBills,
			"Card spending",
		]) {
			expect(screen.queryByLabelText(`${label} ($)`)).toBeNull();
			expect(screen.queryByText(label, { exact: true })).toBeNull();
		}
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByLabelText("Calculated budget values")).toBeNull();
		expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
		for (const name of [
			"Income accounts",
			"Income sources",
			labels.cashAccounts,
			"Tracked cards",
			"Included bills",
		]) {
			expect(screen.getByRole("group", { name })).toBeTruthy();
		}
		expect(screen.queryByRole("button", { name: /Use automatic/ })).toBeNull();
	});

	it("keeps cycle start and reserve as editable settings", () => {
		const update = vi.fn();
		render(
			<SafeSpendingConfigurePanel
				config={config}
				income={{ candidates: [], selectedScheduleIds: [], paycheck: null }}
				billCandidates={[]}
				trackedBillIds={[]}
				accounts={financialModelFixture.accounts}
				onToggleBill={noop}
				onToggleAccount={noop}
				onToggleSpendingAccount={noop}
				onToggleIncomeAccount={noop}
				onUpdateConfig={update}
			/>,
		);
		fireEvent.change(screen.getByLabelText(`${labels.cycleStart} (1–28)`), {
			target: { value: "15" },
		});
		expect(update).toHaveBeenLastCalledWith({
			statementDay: 15,
			statementDaySet: true,
		});
		fireEvent.change(screen.getByLabelText(`${labels.reserve} ($)`), {
			target: { value: "100" },
		});
		expect(update).toHaveBeenLastCalledWith({ reserve: 100 });
	});
});
