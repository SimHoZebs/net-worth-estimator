import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testPlan } from "../../../test/plan.ts";
import { SafeSpendingBillsPanel } from "./SafeSpendingBillsPanel.tsx";
import { SafeSpendingConfigurePanel } from "./SafeSpendingConfigurePanel.tsx";
import { SafeSpendingCyclePanel } from "./SafeSpendingCyclePanel.tsx";
import { SafeSpendingDetailShell } from "./SafeSpendingDetailShell.tsx";
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
	committedTotal: 800,
	committedByCard: [],
	paycheckAmount: 3000,
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
	title: "Due before month-end",
	subtitle: "Sep 24 to Sep 30",
	total: 1000,
	groups: [],
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
				tab="mandatory"
				onTabChange={onTabChange}
				cycleCount={3}
				onClose={noop}
			>
				<SafeSpendingBillsPanel
					heroes={heroes}
					cashNow={cashNow}
					paycheck={paycheck}
					section={section}
					frame="calendar"
					onFrameChange={noop}
					plan={testPlan}
					transactionOrder="newest"
					onTransactionOrderChange={noop}
				/>
			</SafeSpendingDetailShell>,
		);
		expect(screen.getByText("Cash cushion")).toBeTruthy();
		// Empty groups render both the bill-grid note and the section note.
		expect(screen.getAllByText("No bills due in this period.")).toHaveLength(2);
		fireEvent.click(screen.getByRole("tab", { name: /cycle went/ }));
		expect(onTabChange).toHaveBeenCalledWith("cycle");
	});
});

describe("SafeSpendingCyclePanel", () => {
	it("renders the empty cycle state", () => {
		render(
			<SafeSpendingCyclePanel
				cycleStart="2026-09-20"
				cycleEnd="2026-10-19"
				transactions={[]}
				plan={testPlan}
				transactionOrder="newest"
				onTransactionOrderChange={noop}
			/>,
		);
		expect(screen.getByText("Card charges in this cycle")).toBeTruthy();
		expect(screen.getByText("No charges in this cycle yet.")).toBeTruthy();
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
		expect(screen.getByText("Statement starts on day (1–28)")).toBeTruthy();
		expect(screen.getByText("Protected reserve ($)")).toBeTruthy();
		expect(screen.getByText("Cards in cycle total")).toBeTruthy();
		expect(
			screen.getByText("No recurring checking outflows found in the plan."),
		).toBeTruthy();
	});
});
