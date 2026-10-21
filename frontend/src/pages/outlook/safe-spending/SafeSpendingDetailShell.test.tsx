import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testPlan } from "../../../test/plan.ts";
import { SafeSpendingBillsPanel } from "./SafeSpendingBillsPanel.tsx";
import { SafeSpendingConfigurePanel } from "./SafeSpendingConfigurePanel.tsx";
import { SafeSpendingDetailShell } from "./SafeSpendingDetailShell.tsx";
import { HouseholdBudgetSummary } from "./HouseholdBudgetSummary.tsx";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
import type {
	CashNowDecomposition,
	PaycheckDecomposition,
	SafeSpendingConfigHints,
	SafeSpendingHeroes,
	SafeSpendingMandatorySection,
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
	paycheckAmount: 3000,
	paycheckDate: "2026-09-30",
	fixedAmount: 1500,
	reserveAmount: 200,
};

const cashNow: CashNowDecomposition = {
	checking: 5000,
	spentSinceStart: 0,
	bills: 1000,
	cushion: 1200,
	since: "2026-09-24",
	short: 0,
	firstShort: null,
};

const paycheck: PaycheckDecomposition = {
	paycheck: 3000,
	fixed: 1500,
	reserve: 200,
	spent: 800,
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
	spentOverride: null,
	paycheckOverride: null,
	fixedOverride: null,
	checkingOverride: null,
	remainingOverride: null,
	paycheckHint: null,
	fixedHint: { total: 1500, start: "2026-10-01", end: "2026-10-31" },
	checkingHint: 5000,
	remainingHint: { total: 1000, monthEnd: "2026-09-30" },
	spentHint: 800,
	cards: [],
	trackedIds: [],
	spendingAccounts: [],
	trackedSpendingIds: [],
};

const noop = () => {};

describe("SafeSpendingDetailShell", () => {
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
					paycheck={paycheck}
					section={section}
					plan={testPlan}
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

describe("HouseholdBudgetSummary", () => {
	it("allocates the next paycheck to closed cards, not new-cycle charges", () => {
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
					paycheckDate: "2026-10-30",
					committedTotal: 500,
					recordedTotal: 125.25,
				}}
				paycheck={{
					...paycheck,
					paycheck: 7579.4,
					fixed: 4181.87,
					reserve: 725,
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
				heroes={{ ...heroes, paycheckDate: null }}
				paycheck={{ ...paycheck, paycheck: 1000 }}
			/>,
		);
		expect(screen.getByText("Date not available")).toBeTruthy();
		expect(screen.getByText("-$1,100.00")).toBeTruthy();
		expect(screen.getByText("-$1,300.00")).toBeTruthy();
		expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
			`${labels.paycheckBeforeReserve} -$1,100.00`,
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
				paycheck={paycheck}
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
				paycheck={paycheck}
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
				billCandidates={[]}
				trackedBillIds={[]}
				accounts={testPlan.accounts}
				onToggleBill={noop}
				onToggleAccount={noop}
				onToggleSpendingAccount={noop}
				onUpdateConfig={noop}
				onResetConfig={noop}
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

	it.each([
		[labels.cashBalance, "checkingOverride", "checking"],
		[labels.remainingBills, "remainingOverride", "remaining"],
		[labels.nextPaycheck, "paycheckOverride", "paycheck"],
		[labels.fixedBills, "fixedOverride", "fixed"],
		[labels.cardSpending, "spentOverride", "spent"],
	] as const)(
		"connects %s to its override, explanation, and reset",
		(label, setting, reset) => {
			const update = vi.fn();
			const onReset = vi.fn();
			render(
				<SafeSpendingConfigurePanel
					config={{ ...config, [setting]: 50 }}
					billCandidates={[]}
					trackedBillIds={[]}
					accounts={testPlan.accounts}
					onToggleBill={noop}
					onToggleAccount={noop}
					onToggleSpendingAccount={noop}
					onUpdateConfig={update}
					onResetConfig={onReset}
				/>,
			);
			const input = screen.getByLabelText(`${label} ($)`);
			const hint = document.getElementById(
				input.getAttribute("aria-describedby")!,
			);
			expect(hint?.textContent).toContain("Override active.");
			expect(hint?.textContent).toContain("Automatic:");
			fireEvent.change(input, { target: { value: "123.45" } });
			expect(update).toHaveBeenLastCalledWith({ [setting]: 123.45 });
			fireEvent.change(input, { target: { value: "" } });
			expect(update).toHaveBeenLastCalledWith({ [setting]: null });
			fireEvent.click(
				screen.getByRole("button", {
					name: `Use automatic ${label}`,
				}),
			);
			expect(onReset).toHaveBeenCalledWith(reset);
		},
	);
});
