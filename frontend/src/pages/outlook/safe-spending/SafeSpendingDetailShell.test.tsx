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
import { HouseholdBudgetSummary } from "./HouseholdBudgetSummary.tsx";
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
	cushionProvisional: false,
	checkingAmount: 5000,
	checkingObservedOn: "2026-09-24",
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
	recordedTotal: 800,
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
});

describe("HouseholdBudgetSummary", () => {
	it("allocates the settling paycheck to closed cards, not new-cycle charges", () => {
		render(
			<HouseholdBudgetSummary
				heroes={{
					...heroes,
					cycleStart: "2026-10-20",
					cycleEnd: "2026-11-19",
					closedCycle: {
						start: "2026-09-20",
						end: "2026-10-19",
						total: 2601.55,
						cards: [
							{
								id: "a",
								name: "Card A",
								amount: 1000,
								observedOn: "2026-10-19",
							},
							{
								id: "b",
								name: "Card B",
								amount: 1601.55,
								observedOn: "2026-10-19",
							},
						],
					},
					committedTotal: 500,
					recordedTotal: 125.25,
				}}
				reserve={725}
				funding={{
					paycheck: 7579.4,
					date: "2026-10-30",
					endDate: "2026-10-30",
					fixedBills: 4181.87,
				}}
			/>,
		);
		const summary = screen.getByRole("region", {
			name: labels.paycheckAllocation,
		});
		expect(within(summary).queryByRole("heading")).toBeNull();
		expect(
			within(summary).queryByText("Oct 20 – Nov 19", { exact: true }),
		).toBeNull();
		expect(within(summary).getByText("Oct 30").getAttribute("datetime")).toBe(
			"2026-10-30",
		);
		const amount = (label: string) =>
			within(summary).getByText(label).closest("div")!.querySelector("dd")!
				.textContent;
		expect(amount(labels.paycheckBeforeReserve)).toBe("$795.98");
		expect(amount(labels.unallocated)).toBe("$70.98");
		expect(within(summary).queryByText("Closed · Sep 20 – Oct 19")).toBeNull();
		expect(within(summary).queryByText("New · Oct 20 – Nov 19")).toBeNull();
		expect(within(summary).queryByText("$125.25")).toBeNull();
		const balances = within(summary).getByRole("list", {
			name: "Closed card balances",
		});
		expect(within(balances).getAllByRole("listitem")).toHaveLength(2);
		expect(within(balances).getByText("$1,601.55")).toBeTruthy();
		expect(within(summary).getByText("Saved balances at close")).toBeTruthy();
	});

	it("shows negative amounts and an unavailable paycheck date", () => {
		render(
			<HouseholdBudgetSummary
				heroes={heroes}
				reserve={200}
				funding={{
					paycheck: 1000,
					date: null,
					endDate: null,
					fixedBills: 1500,
				}}
			/>,
		);
		expect(screen.getByText("Date not available")).toBeTruthy();
		expect(screen.getByText("-$1,100.00")).toBeTruthy();
		expect(screen.getByText("-$1,300.00")).toBeTruthy();
		expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
			`${labels.paycheckBeforeReserve} -$1,100.00`,
		);
	});

	it("shows the paycheck date range for multiple income sources", () => {
		render(
			<HouseholdBudgetSummary
				heroes={heroes}
				reserve={allocation.reserve}
				funding={{
					...currentFunding,
					date: "2026-09-30",
					endDate: "2026-10-05",
				}}
			/>,
		);
		expect(screen.getByText("Sep 30").getAttribute("datetime")).toBe(
			"2026-09-30",
		);
		expect(screen.getByText("Oct 5").getAttribute("datetime")).toBe(
			"2026-10-05",
		);
	});

	it("does not show a spendable remainder when a card has no closing observation", () => {
		render(
			<HouseholdBudgetSummary
				heroes={{
					...heroes,
					closedCycle: {
						...heroes.closedCycle,
						total: null,
						cards: [
							{
								id: "missing",
								name: "Missing card",
								amount: null,
								observedOn: null,
							},
						],
					},
				}}
				reserve={allocation.reserve}
				funding={currentFunding}
			/>,
		);
		expect(screen.getByText("Saved balance unavailable")).toBeTruthy();
		expect(screen.getByText("No saved balance")).toBeTruthy();
		expect(
			screen.getByText(labels.unallocated).closest("div")!.textContent,
		).toBe(`${labels.unallocated}—`);
		expect(screen.queryByRole("img")).toBeNull();
	});

	it("labels an older observation without calling it a closing balance", () => {
		render(
			<HouseholdBudgetSummary
				heroes={{
					...heroes,
					closedCycle: {
						...heroes.closedCycle,
						cards: [
							{
								id: "card",
								name: "Household card",
								amount: 600,
								observedOn: "2026-09-18",
							},
						],
					},
				}}
				reserve={allocation.reserve}
				funding={currentFunding}
			/>,
		);
		expect(screen.getByText("Latest saved balances before close")).toBeTruthy();
		expect(screen.getByText("Saved Sep 18")).toBeTruthy();
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
			labels.paidBy,
			labels.fixedBills,
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
