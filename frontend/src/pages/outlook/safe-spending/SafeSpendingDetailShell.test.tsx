import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { financialModelFixture } from "../../../mocks/financialModel.ts";
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
	theoretical: 400,
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
		render(
			<SafeSpendingDetailShell
				tab="cycle"
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
			</SafeSpendingDetailShell>,
		);
		expect(screen.getByText(labels.cashAfterBills)).toBeTruthy();
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
		fireEvent.click(screen.getByRole("tab", { name: /This cycle/ }));
		expect(onTabChange).toHaveBeenCalledWith("cycle");
	});
});

describe("SafeSpendingBillsPanel funding foot", () => {
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

	it("names the paycheck that settles this statement", () => {
		renderBills();
		const region = screen.getByRole("region", {
			name: labels.cashAfterBills,
		});
		expect(
			within(region).getByText("The Sep 30 paycheck pays this statement"),
		).toBeTruthy();
	});

	it("names the bundle date range for several income sources", () => {
		renderBills({ ...currentFunding, endDate: "2026-10-05" });
		const region = screen.getByRole("region", {
			name: labels.cashAfterBills,
		});
		expect(
			within(region).getByText(
				"The Sep 30 – Oct 5 paychecks pay this statement",
			),
		).toBeTruthy();
	});

	it("says so when no paycheck settles this statement", () => {
		renderBills({ ...currentFunding, date: null, endDate: null, paycheck: 0 });
		const region = screen.getByRole("region", {
			name: labels.cashAfterBills,
		});
		expect(within(region).getByText("No projected paycheck")).toBeTruthy();
	});

	it("names the reserve amount used when cash is below the target", () => {
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
		expect(screen.getByText("$617 used")).toBeTruthy();
	});

	it("does not name reserve usage when cash covers the target", () => {
		render(
			<SafeSpendingBillsPanel
				heroes={heroes}
				cashNow={{ ...cashNow, cushion: 1200 }}
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
		expect(screen.getByText(labels.closedCardBalances)).toBeTruthy();
		expect(screen.getAllByText("—").length).toBeGreaterThan(0);
		expect(screen.getByText("Closed card balance unavailable")).toBeTruthy();
		expect(screen.getByText("Latest balance, not at close")).toBeTruthy();
		expect(screen.queryByText("$0")).toBeNull();
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
			labels.cardSpending,
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
